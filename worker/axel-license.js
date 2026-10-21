/**
 * AXEL 序列号在线核验 / 后台停用 / 发号
 * KV binding: AXEL_LICENSE（未绑定时退回 AXEL_PRESENCE，键前缀不同不会冲突）
 * Secrets: AXEL_ADMIN_TOKEN（后台口令）、AXEL_LICENSE_SECRET（与软件内置授权密钥相同，仅存于服务器环境变量）
 *
 * POST /api/axel-license        软件报到 {serial, serialHash, machineCode, version} → {status:'ok'|'locked', msg}
 * GET  /api/axel-license        后台列表（Bearer AXEL_ADMIN_TOKEN）
 * POST /api/axel-license/admin  后台操作（Bearer）{action:'lock'|'unlock', serialHash, msg?} | {action:'issue', machineCode, note?}
 */
import { isAdmin, kvMeta, listRecords } from "./util.js";

const KEY_PREFIX = "axel:license:";
// 同一序列号、同一台机器、版本没变时，这段时间内的重复报到不再写 KV（省写入额度）
const MIN_WRITE_GAP_MS = 10 * 60 * 1000;
// 从没发过、也没人手动处理过的伪造号，记录 30 天后自动清掉，防止被刷爆
const FORGED_TTL = 60 * 60 * 24 * 30;
const MAX_BODY = 4096;
const LOCK_MSG = "此序列号已被停用，请联系天进广告 13201200112";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SERIAL_RE = /^AXEL-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})$/;

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
  "Cache-Control": "no-store",
});
const json = (data, status, origin) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) } });

const kv = (env) => env.AXEL_LICENSE || env.AXEL_PRESENCE;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
// 与 src/lib/license.js 相同：前 12 位载荷 + 4 位 HMAC 校验
async function checkDigits(secret, payload12) {
  const d = await hmacBytes(secret, "AXEL|SERIAL|" + payload12);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[d[i] % ALPHABET.length];
  return out;
}
export function normalizeSerial(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (SERIAL_RE.test(s)) return s;
  const c = s.replace(/-/g, "");
  if (/^AXEL[A-Z2-9]{16}$/.test(c)) { const b = c.slice(4); return `AXEL-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`; }
  return s;
}
export async function validSerial(secret, serial) {
  const m = SERIAL_RE.exec(serial);
  if (!m) return false;
  return (await checkDigits(secret, m[1] + m[2] + m[3])) === m[4];
}
export async function makeSerial(secret) {
  const r = crypto.getRandomValues(new Uint8Array(12));
  let p = "";
  for (const b of r) p += ALPHABET[b % ALPHABET.length];
  return `AXEL-${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(8, 12)}-${await checkDigits(secret, p)}`;
}
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-F-]/g, "").slice(0, 19);
const cleanVer = (v) => String(v || "").replace(/[^0-9A-Za-z.\-+_]/g, "").slice(0, 32);
const cleanText = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

async function saveRec(store, key, rec, ttl) {
  const opts = { metadata: kvMeta(rec) };
  if (ttl) opts.expirationTtl = ttl;
  await store.put(key, JSON.stringify(rec), opts);
}
async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("载荷过大");
  return JSON.parse(raw || "{}");
}

async function handleReport(request, env, origin) {
  const store = kv(env);
  if (!store) return json({ ok: false, error: "未配置 KV" }, 500, origin);
  let b;
  try { b = await readBody(request); } catch { return json({ ok: false, error: "请求无效" }, 400, origin); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "请求无效" }, 400, origin);
  const serial = normalizeSerial(b.serial);
  const machineCode = cleanCode(b.machineCode);
  if (!SERIAL_RE.test(serial) || !machineCode) return json({ ok: false, error: "参数无效" }, 400, origin);
  const serialHash = await sha256Hex(serial);
  if (b.serialHash && String(b.serialHash).toLowerCase() !== serialHash) return json({ ok: false, error: "参数无效" }, 400, origin);
  const key = KEY_PREFIX + serialHash;
  const prev = (await store.get(key, { type: "json" })) || null;
  const secret = (env.AXEL_LICENSE_SECRET || "").trim();
  // 未配置密钥时不做真伪判断（只记录 + 停用名单），避免误锁；后台手动「解锁」过的号（allowed）也不再判伪
  const forged = secret && !(prev && prev.allowed) ? !(await validSerial(secret, serial)) : false;
  const version = cleanVer(b.version) || (prev && prev.version) || "";
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 重复报到且没有任何变化：直接按已有状态回复，不写 KV
  if (
    prev && !!prev.forged === forged &&
    Array.isArray(prev.machines) && prev.machines.includes(machineCode) &&
    prev.lastMachine === machineCode && (prev.version || "") === version &&
    now - Date.parse(prev.lastSeenAt || 0) < MIN_WRITE_GAP_MS
  ) {
    return prev.locked
      ? json({ status: "locked", msg: prev.lockMsg || LOCK_MSG }, 200, origin)
      : json({ status: "ok", msg: "" }, 200, origin);
  }

  const machines = Array.isArray(prev && prev.machines) ? prev.machines.slice() : [];
  if (!machines.includes(machineCode)) machines.push(machineCode);
  const rec = Object.assign({}, prev || {}, {
    serialHash, serialLast6: serial.replace(/-/g, "").slice(-6),
    machines: machines.slice(-10), lastMachine: machineCode,
    version,
    firstSeenAt: (prev && prev.firstSeenAt) || nowIso, lastSeenAt: nowIso,
    country: (request.cf && request.cf.country) || (prev && prev.country) || "",
  });
  if (forged) {
    rec.locked = true; rec.lockMsg = "序列号无效，请联系天进广告 13201200112"; rec.forged = true;
  } else if (rec.forged && secret) {
    // 以前判成伪造（例如服务器密钥一度配错），现在密钥在、校验通过：自动恢复，不必人工解锁
    // （没配密钥时不自动恢复，免得临时删掉密钥就把真伪造号放出去）
    rec.locked = false; rec.lockMsg = ""; delete rec.forged; rec.lockChangedAt = nowIso;
  }
  // 伪造号且从没发过 / 没人管过：30 天自动过期
  const ttl = forged && !rec.issuedAt && !rec.lockChangedAt ? FORGED_TTL : undefined;
  await saveRec(store, key, rec, ttl);
  if (rec.locked) return json({ status: "locked", msg: rec.lockMsg || LOCK_MSG }, 200, origin);
  return json({ status: "ok", msg: "" }, 200, origin);
}

async function handleList(request, env, origin) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "未授权" }, 401, origin);
  const store = kv(env);
  if (!store) return json({ ok: false, error: "未配置 KV" }, 500, origin);
  const list = (await listRecords(store, KEY_PREFIX)).filter((r) => r && r.serialHash);
  list.sort((a, b) => String(b.lastSeenAt || b.issuedAt || "").localeCompare(String(a.lastSeenAt || a.issuedAt || "")));
  return json({ ok: true, secretConfigured: !!(env.AXEL_LICENSE_SECRET || "").trim(), total: list.length, licenses: list }, 200, origin);
}

async function handleAdmin(request, env, origin) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "未授权" }, 401, origin);
  const store = kv(env);
  if (!store) return json({ ok: false, error: "未配置 KV" }, 500, origin);
  let b;
  try { b = await readBody(request); } catch { return json({ ok: false, error: "请求无效" }, 400, origin); }
  const now = new Date().toISOString();
  if (b.action === "lock" || b.action === "unlock") {
    const sh = String(b.serialHash || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sh)) return json({ ok: false, error: "serialHash 无效" }, 400, origin);
    const key = KEY_PREFIX + sh;
    const rec = (await store.get(key, { type: "json" })) || { serialHash: sh, firstSeenAt: now };
    rec.locked = b.action === "lock";
    rec.lockMsg = rec.locked ? (cleanText(b.msg, 120) || LOCK_MSG) : "";
    rec.lockChangedAt = now;
    delete rec.forged;
    // 手动解锁 = 认可这个号（以后不再因判伪被自动锁）；手动锁定则取消认可
    if (rec.locked) delete rec.allowed; else rec.allowed = true;
    await saveRec(store, key, rec);
    return json({ ok: true, record: rec }, 200, origin);
  }
  if (b.action === "issue") {
    const secret = (env.AXEL_LICENSE_SECRET || "").trim();
    if (!secret) return json({ ok: false, error: "服务器未配置 AXEL_LICENSE_SECRET" }, 500, origin);
    const machineCode = cleanCode(b.machineCode);
    if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machineCode)) return json({ ok: false, error: "本机码格式应为 XXXX-XXXX-XXXX-XXXX" }, 400, origin);
    const serial = await makeSerial(secret);
    const serialHash = await sha256Hex(serial);
    const rec = { serialHash, serialLast6: serial.replace(/-/g, "").slice(-6), issuedFor: machineCode, issuedAt: now, note: cleanText(b.note, 60), machines: [], locked: false };
    await saveRec(store, KEY_PREFIX + serialHash, rec);
    return json({ ok: true, serial, record: rec }, 200, origin);
  }
  return json({ ok: false, error: "未知操作" }, 400, origin);
}

export async function handleAxelLicense(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (url.pathname === "/api/axel-license/admin" && request.method === "POST") return handleAdmin(request, env, origin);
  if (url.pathname === "/api/axel-license" && request.method === "POST") return handleReport(request, env, origin);
  if (url.pathname === "/api/axel-license" && request.method === "GET") return handleList(request, env, origin);
  return json({ ok: false, error: "Method Not Allowed" }, 405, origin);
}

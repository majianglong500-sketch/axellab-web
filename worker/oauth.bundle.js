// worker/util.js
var enc = new TextEncoder();
function safeEqual(a, b) {
  const x = enc.encode(String(a || ""));
  const y = enc.encode(String(b || ""));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function readAdminToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return (request.headers.get("X-Admin-Token") || "").trim();
}
function isAdmin(request, env) {
  const want = String(env.AXEL_ADMIN_TOKEN || "").trim();
  if (!want) return false;
  const got = readAdminToken(request);
  return !!got && safeEqual(got, want);
}
function kvMeta(rec) {
  const s = JSON.stringify(rec);
  return enc.encode(s).length <= 1e3 ? rec : void 0;
}
async function listRecords(store, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix, cursor, limit: 1e3 });
    for (const k of page.keys || []) {
      let rec = k.metadata;
      if (!rec || typeof rec !== "object") {
        try {
          rec = await store.get(k.name, { type: "json" });
        } catch {
          rec = null;
        }
      }
      if (rec) out.push(rec);
    }
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return out;
}
function jsLiteral(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// worker/axel-presence.js
var KEY_PREFIX = "axel:presence:";
var ONLINE_MIN = 12;
var ONLINE_MS = ONLINE_MIN * 60 * 1e3;
var MAX_BODY = 4096;
var TTL = 60 * 60 * 24 * 90;
var MIN_WRITE_GAP_MS = 60 * 1e3;
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) }
  });
}
function text(msg, status, origin) {
  return new Response(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(origin) }
  });
}
function sanitizeHash(h) {
  const s = String(h || "").trim().toLowerCase().replace(/[^a-f0-9]/g, "");
  return s.length >= 16 && s.length <= 64 ? s : "";
}
function sanitizeShort(s, max = 40) {
  return String(s || "").replace(/[\u0000-\u001f<>"'&]/g, "").trim().slice(0, max);
}
function sanitizeVersion(v) {
  return String(v || "").trim().replace(/[^0-9A-Za-z.\-+_]/g, "").slice(0, 32);
}
function sanitizeTz(tz) {
  const s = String(tz || "").trim().slice(0, 64);
  if (!/^[A-Za-z0-9_+\-\/]+$/.test(s)) return "";
  return s;
}
function sanitizeClientTime(v, now) {
  const t = Date.parse(String(v || "").slice(0, 40));
  if (!Number.isFinite(t) || t > now + 60 * 1e3 || t < now - 365 * 86400 * 1e3) return "";
  return new Date(t).toISOString();
}
function isOnline(lastSeenAt, now) {
  const t = Date.parse(lastSeenAt || "");
  return Number.isFinite(t) && now - t <= ONLINE_MS;
}
var SAME_FIELDS = ["version", "activated", "companyShort", "timezone", "country"];
async function handlePost(request, env, origin) {
  if (!env.AXEL_PRESENCE) {
    return text("\u672A\u914D\u7F6E KV \u7ED1\u5B9A AXEL_PRESENCE\u3002\u89C1 scripts/axel-presence.md", 500, origin);
  }
  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: false, error: "\u65E0\u6CD5\u8BFB\u53D6\u8BF7\u6C42\u4F53" }, 400, origin);
  }
  if (raw.length > MAX_BODY) {
    return json({ ok: false, error: "\u8F7D\u8377\u8FC7\u5927" }, 413, origin);
  }
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false, error: "JSON \u65E0\u6548" }, 400, origin);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "JSON \u65E0\u6548" }, 400, origin);
  const machineHash = sanitizeHash(body.machineHash);
  if (!machineHash) {
    return json({ ok: false, error: "machineHash \u65E0\u6548" }, 400, origin);
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const key = KEY_PREFIX + machineHash;
  let prev = null;
  try {
    prev = await env.AXEL_PRESENCE.get(key, { type: "json" });
  } catch {
    prev = null;
  }
  const country = request.cf && request.cf.country || request.headers.get("CF-IPCountry") || prev && prev.country || "";
  const record = {
    machineHash,
    version: sanitizeVersion(body.version) || prev && prev.version || "",
    activated: body.activated === true || body.activated === "true",
    companyShort: sanitizeShort(body.companyShort || body.company || ""),
    timezone: sanitizeTz(body.timezone) || prev && prev.timezone || "",
    lastSeenAt: nowIso,
    lastActiveAt: sanitizeClientTime(body.lastActiveAt || body.lastSeenAt, now) || prev && prev.lastActiveAt || "",
    firstSeenAt: prev && prev.firstSeenAt || nowIso,
    country: String(country || "").slice(0, 8),
    updatedAt: nowIso
  };
  const unchanged = prev && SAME_FIELDS.every((k) => prev[k] === record[k]) && now - Date.parse(prev.updatedAt || prev.lastSeenAt || 0) < MIN_WRITE_GAP_MS;
  if (!unchanged) {
    await env.AXEL_PRESENCE.put(key, JSON.stringify(record), { expirationTtl: TTL, metadata: kvMeta(record) });
  }
  return json({ ok: true }, 200, origin);
}
async function handleGet(request, env, origin) {
  if (!String(env.AXEL_ADMIN_TOKEN || "").trim()) {
    return text("\u672A\u914D\u7F6E AXEL_ADMIN_TOKEN\u3002\u8BF7\u5728 Cloudflare Secrets / .dev.vars \u4E2D\u8BBE\u7F6E\u3002", 500, origin);
  }
  if (!isAdmin(request, env)) {
    return json({ ok: false, error: "\u672A\u6388\u6743" }, 401, origin);
  }
  if (!env.AXEL_PRESENCE) {
    return text("\u672A\u914D\u7F6E KV \u7ED1\u5B9A AXEL_PRESENCE\u3002\u89C1 scripts/axel-presence.md", 500, origin);
  }
  const now = Date.now();
  const list = (await listRecords(env.AXEL_PRESENCE, KEY_PREFIX)).filter((rec) => rec && rec.machineHash).map((rec) => ({
    machineHash: rec.machineHash,
    machineHashShort: String(rec.machineHash).slice(0, 8),
    version: rec.version || "",
    activated: !!rec.activated,
    companyShort: rec.companyShort || "",
    timezone: rec.timezone || "",
    lastSeenAt: rec.lastSeenAt || "",
    lastActiveAt: rec.lastActiveAt || "",
    firstSeenAt: rec.firstSeenAt || "",
    country: rec.country || "",
    online: isOnline(rec.lastSeenAt, now)
  }));
  list.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(b.lastSeenAt).localeCompare(String(a.lastSeenAt));
  });
  const onlineCount = list.filter((x) => x.online).length;
  return json(
    {
      ok: true,
      onlineWindowMinutes: ONLINE_MIN,
      onlineCount,
      totalReported: list.length,
      generatedAt: new Date(now).toISOString(),
      clients: list
    },
    200,
    origin
  );
}
async function handleAxelPresence(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method === "POST") return handlePost(request, env, origin);
  if (request.method === "GET") return handleGet(request, env, origin);
  return text("Method Not Allowed", 405, origin);
}

// worker/axel-license.js
var KEY_PREFIX2 = "axel:license:";
var MIN_WRITE_GAP_MS2 = 10 * 60 * 1e3;
var FORGED_TTL = 60 * 60 * 24 * 30;
var MAX_BODY2 = 4096;
var LOCK_MSG = "\u6B64\u5E8F\u5217\u53F7\u5DF2\u88AB\u505C\u7528\uFF0C\u8BF7\u8054\u7CFB\u5929\u8FDB\u5E7F\u544A 13201200112";
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var SERIAL_RE = /^AXEL-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})$/;
var cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
  "Cache-Control": "no-store"
});
var json2 = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) } });
var kv = (env) => env.AXEL_LICENSE || env.AXEL_PRESENCE;
var enc2 = new TextEncoder();
var hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc2.encode(s)));
}
async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc2.encode(msg)));
}
async function checkDigits(secret, payload12) {
  const d = await hmacBytes(secret, "AXEL|SERIAL|" + payload12);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[d[i] % ALPHABET.length];
  return out;
}
function normalizeSerial(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (SERIAL_RE.test(s)) return s;
  const c = s.replace(/-/g, "");
  if (/^AXEL[A-Z2-9]{16}$/.test(c)) {
    const b = c.slice(4);
    return `AXEL-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`;
  }
  return s;
}
async function validSerial(secret, serial) {
  const m = SERIAL_RE.exec(serial);
  if (!m) return false;
  return await checkDigits(secret, m[1] + m[2] + m[3]) === m[4];
}
async function makeSerial(secret) {
  const r = crypto.getRandomValues(new Uint8Array(12));
  let p = "";
  for (const b of r) p += ALPHABET[b % ALPHABET.length];
  return `AXEL-${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(8, 12)}-${await checkDigits(secret, p)}`;
}
var cleanCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-F-]/g, "").slice(0, 19);
var cleanVer = (v) => String(v || "").replace(/[^0-9A-Za-z.\-+_]/g, "").slice(0, 32);
var cleanText = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
var MC_RE = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;
var MACHINE_PREFIX = "axel:machine:";
var REG_IP_PREFIX = "axel:regip:";
var REG_PER_IP_DAY = 20;
var b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function signToken(env, payload) {
  const raw = String(env.AXEL_LICENSE_SIGN_KEY || "").trim();
  if (!raw) throw new Error("\u670D\u52A1\u5668\u672A\u914D\u7F6E\u7B7E\u540D\u79C1\u94A5 AXEL_LICENSE_SIGN_KEY");
  const der = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const body = b64u(enc2.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, enc2.encode(body)));
  return body + "." + b64u(sig);
}
var tokenPayload = (serial, machineCode, company) => ({ v: 1, kid: "k1", s: serial, mc: machineCode, co: cleanText(company, 20), iat: (/* @__PURE__ */ new Date()).toISOString() });
function normPhone(p) {
  const s = String(p || "").replace(/[\s\-()（）]/g, "");
  if (/^1[3-9]\d{9}$/.test(s) || /^0\d{9,11}$/.test(s)) return s;
  return "";
}
async function saveRec(store, key, rec, ttl) {
  const opts = { metadata: kvMeta(rec) };
  if (ttl) opts.expirationTtl = ttl;
  await store.put(key, JSON.stringify(rec), opts);
}
async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY2) throw new Error("\u8F7D\u8377\u8FC7\u5927");
  return JSON.parse(raw || "{}");
}
async function handleReport(request, env, origin) {
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  let b;
  try {
    b = await readBody(request);
  } catch {
    return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  }
  if (!b || typeof b !== "object") return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  const serial = normalizeSerial(b.serial);
  const machineCode = cleanCode(b.machineCode);
  if (!SERIAL_RE.test(serial) || !machineCode) return json2({ ok: false, error: "\u53C2\u6570\u65E0\u6548" }, 400, origin);
  const serialHash = await sha256Hex(serial);
  if (b.serialHash && String(b.serialHash).toLowerCase() !== serialHash) return json2({ ok: false, error: "\u53C2\u6570\u65E0\u6548" }, 400, origin);
  const key = KEY_PREFIX2 + serialHash;
  const prev = await store.get(key, { type: "json" }) || null;
  const secret = (env.AXEL_LICENSE_SECRET || "").trim();
  const forged = secret && !(prev && prev.allowed) ? !await validSerial(secret, serial) : false;
  const version = cleanVer(b.version) || prev && prev.version || "";
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  if (prev && !!prev.forged === forged && Array.isArray(prev.machines) && prev.machines.includes(machineCode) && prev.lastMachine === machineCode && (prev.version || "") === version && now - Date.parse(prev.lastSeenAt || 0) < MIN_WRITE_GAP_MS2) {
    return prev.locked ? json2({ status: "locked", msg: prev.lockMsg || LOCK_MSG }, 200, origin) : json2({ status: "ok", msg: "" }, 200, origin);
  }
  const machines = Array.isArray(prev && prev.machines) ? prev.machines.slice() : [];
  if (!machines.includes(machineCode)) machines.push(machineCode);
  const rec = Object.assign({}, prev || {}, {
    serialHash,
    serialLast6: serial.replace(/-/g, "").slice(-6),
    machines: machines.slice(-10),
    lastMachine: machineCode,
    version,
    firstSeenAt: prev && prev.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    country: request.cf && request.cf.country || prev && prev.country || ""
  });
  if (forged) {
    rec.locked = true;
    rec.lockMsg = "\u5E8F\u5217\u53F7\u65E0\u6548\uFF0C\u8BF7\u8054\u7CFB\u5929\u8FDB\u5E7F\u544A 13201200112";
    rec.forged = true;
  } else if (rec.forged && secret) {
    rec.locked = false;
    rec.lockMsg = "";
    delete rec.forged;
    rec.lockChangedAt = nowIso;
  }
  const ttl = forged && !rec.issuedAt && !rec.lockChangedAt ? FORGED_TTL : void 0;
  await saveRec(store, key, rec, ttl);
  if (rec.locked) return json2({ status: "locked", msg: rec.lockMsg || LOCK_MSG }, 200, origin);
  return json2({ status: "ok", msg: "" }, 200, origin);
}
async function handleList(request, env, origin) {
  if (!isAdmin(request, env)) return json2({ ok: false, error: "\u672A\u6388\u6743" }, 401, origin);
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  const list = (await listRecords(store, KEY_PREFIX2)).filter((r) => r && r.serialHash);
  list.sort((a, b) => String(b.lastSeenAt || b.issuedAt || "").localeCompare(String(a.lastSeenAt || a.issuedAt || "")));
  return json2({ ok: true, secretConfigured: !!(env.AXEL_LICENSE_SECRET || "").trim(), total: list.length, licenses: list }, 200, origin);
}
async function handleAdmin(request, env, origin) {
  if (!isAdmin(request, env)) return json2({ ok: false, error: "\u672A\u6388\u6743" }, 401, origin);
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  let b;
  try {
    b = await readBody(request);
  } catch {
    return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (b.action === "lock" || b.action === "unlock") {
    const sh = String(b.serialHash || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sh)) return json2({ ok: false, error: "serialHash \u65E0\u6548" }, 400, origin);
    const key = KEY_PREFIX2 + sh;
    const rec = await store.get(key, { type: "json" }) || { serialHash: sh, firstSeenAt: now };
    rec.locked = b.action === "lock";
    rec.lockMsg = rec.locked ? cleanText(b.msg, 120) || LOCK_MSG : "";
    rec.lockChangedAt = now;
    delete rec.forged;
    if (rec.locked) delete rec.allowed;
    else rec.allowed = true;
    await saveRec(store, key, rec);
    return json2({ ok: true, record: rec }, 200, origin);
  }
  if (b.action === "issue") {
    const secret = (env.AXEL_LICENSE_SECRET || "").trim();
    if (!secret) return json2({ ok: false, error: "\u670D\u52A1\u5668\u672A\u914D\u7F6E AXEL_LICENSE_SECRET" }, 500, origin);
    const machineCode = cleanCode(b.machineCode);
    if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machineCode)) return json2({ ok: false, error: "\u672C\u673A\u7801\u683C\u5F0F\u5E94\u4E3A XXXX-XXXX-XXXX-XXXX" }, 400, origin);
    const serial = await makeSerial(secret);
    const serialHash = await sha256Hex(serial);
    const note = cleanText(b.note, 60);
    const rec = { serialHash, serialLast6: serial.replace(/-/g, "").slice(-6), issuedFor: machineCode, issuedAt: now, note, machines: [], locked: false };
    await saveRec(store, KEY_PREFIX2 + serialHash, rec);
    let token = "";
    try {
      if ((env.AXEL_LICENSE_SIGN_KEY || "").trim()) token = await signToken(env, tokenPayload(serial, machineCode, note));
    } catch {
      token = "";
    }
    return json2({ ok: true, serial, token, record: rec }, 200, origin);
  }
  return json2({ ok: false, error: "\u672A\u77E5\u64CD\u4F5C" }, 400, origin);
}
async function handleRegister(request, env, origin) {
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  const secret = (env.AXEL_LICENSE_SECRET || "").trim();
  if (!secret) return json2({ ok: false, error: "\u670D\u52A1\u5668\u672A\u914D\u7F6E AXEL_LICENSE_SECRET" }, 500, origin);
  let b;
  try {
    b = await readBody(request);
  } catch {
    return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  }
  if (!b || typeof b !== "object") return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  const machineCode = cleanCode(b.machineCode);
  if (!MC_RE.test(machineCode)) return json2({ ok: false, error: "\u672C\u673A\u7801\u65E0\u6548" }, 400, origin);
  const company = cleanText(b.company, 60);
  if (company.length < 2) return json2({ ok: false, error: "\u8BF7\u586B\u5199\u516C\u53F8\u540D\u79F0" }, 400, origin);
  const phone = normPhone(b.phone);
  if (!phone) return json2({ ok: false, error: "\u8BF7\u586B\u5199\u6B63\u786E\u7684\u624B\u673A\u53F7\uFF08\u6216\u5E26\u533A\u53F7\u7684\u5EA7\u673A\uFF09" }, 400, origin);
  if (b.agree !== true) return json2({ ok: false, error: "\u9700\u8981\u540C\u610F\u9690\u79C1\u8BF4\u660E\u624D\u80FD\u9886\u53D6" }, 400, origin);
  const profile = {
    company,
    phone,
    contact: cleanText(b.contact, 20),
    region: cleanText(b.region, 20),
    mode: ["project", "shop", "both"].includes(b.mode) ? b.mode : "project"
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const mkey = MACHINE_PREFIX + machineCode;
  const had = await store.get(mkey, { type: "json" });
  if (had && had.serial && SERIAL_RE.test(had.serial)) {
    const sh = await sha256Hex(had.serial);
    const rec2 = await store.get(KEY_PREFIX2 + sh, { type: "json" }) || null;
    if (rec2 && rec2.locked) return json2({ ok: false, status: "locked", error: rec2.lockMsg || LOCK_MSG }, 403, origin);
    if (rec2) {
      rec2.profile = profile;
      rec2.note = rec2.note || company;
      rec2.reRegisteredAt = now;
      await saveRec(store, KEY_PREFIX2 + sh, rec2);
    }
    return json2({ ok: true, serial: had.serial, token: await signToken(env, tokenPayload(had.serial, machineCode, company)), again: true }, 200, origin);
  }
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
  const day = now.slice(0, 10).replace(/-/g, "");
  const ipKey = REG_IP_PREFIX + ip + ":" + day;
  const cnt = Number(await store.get(ipKey)) || 0;
  if (cnt >= REG_PER_IP_DAY) return json2({ ok: false, error: "\u4ECA\u5929\u9886\u53D6\u6B21\u6570\u592A\u591A\u4E86\uFF0C\u8BF7\u660E\u5929\u518D\u8BD5\u6216\u8054\u7CFB\u6211\u4EEC" }, 429, origin);
  await store.put(ipKey, String(cnt + 1), { expirationTtl: 60 * 60 * 48 });
  const serial = await makeSerial(secret);
  const serialHash = await sha256Hex(serial);
  const rec = {
    serialHash,
    serialLast6: serial.replace(/-/g, "").slice(-6),
    issuedFor: machineCode,
    issuedAt: now,
    note: company,
    profile,
    source: "self",
    machines: [machineCode],
    lastMachine: machineCode,
    version: cleanVer(b.version),
    firstSeenAt: now,
    lastSeenAt: now,
    locked: false,
    country: request.cf && request.cf.country || ""
  };
  await saveRec(store, KEY_PREFIX2 + serialHash, rec);
  await store.put(mkey, JSON.stringify({ serial, at: now }));
  return json2({ ok: true, serial, token: await signToken(env, tokenPayload(serial, machineCode, company)) }, 200, origin);
}
async function handleToken(request, env, origin) {
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  const secret = (env.AXEL_LICENSE_SECRET || "").trim();
  if (!secret) return json2({ ok: false, error: "\u670D\u52A1\u5668\u672A\u914D\u7F6E AXEL_LICENSE_SECRET" }, 500, origin);
  let b;
  try {
    b = await readBody(request);
  } catch {
    return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  }
  if (!b || typeof b !== "object") return json2({ ok: false, error: "\u8BF7\u6C42\u65E0\u6548" }, 400, origin);
  const serial = normalizeSerial(b.serial);
  const machineCode = cleanCode(b.machineCode);
  if (!SERIAL_RE.test(serial) || !MC_RE.test(machineCode)) return json2({ ok: false, error: "\u53C2\u6570\u65E0\u6548" }, 400, origin);
  const serialHash = await sha256Hex(serial);
  const key = KEY_PREFIX2 + serialHash;
  const prev = await store.get(key, { type: "json" }) || null;
  if (!(prev && prev.allowed) && !await validSerial(secret, serial)) return json2({ ok: false, status: "invalid", error: "\u5E8F\u5217\u53F7\u4E0D\u6B63\u786E\uFF0C\u8BF7\u6838\u5BF9\u540E\u91CD\u65B0\u8F93\u5165" }, 400, origin);
  if (prev && prev.locked && !prev.forged) return json2({ ok: false, status: "locked", error: prev.lockMsg || LOCK_MSG }, 403, origin);
  const machines = Array.isArray(prev && prev.machines) ? prev.machines.slice() : [];
  const max = Number(env.AXEL_MAX_MACHINES) || 0;
  if (max > 0 && !machines.includes(machineCode) && machines.length >= max) {
    return json2({ ok: false, status: "tooMany", error: `\u8FD9\u4E2A\u5E8F\u5217\u53F7\u5DF2\u7ECF\u5728 ${machines.length} \u53F0\u7535\u8111\u4E0A\u7528\u8FC7\u4E86\uFF0C\u8BF7\u8054\u7CFB\u6211\u4EEC\u89E3\u7ED1\u6216\u53E6\u9886\u4E00\u4E2A` }, 403, origin);
  }
  if (!machines.includes(machineCode)) machines.push(machineCode);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rec = Object.assign({}, prev || {}, {
    serialHash,
    serialLast6: serial.replace(/-/g, "").slice(-6),
    machines: machines.slice(-10),
    lastMachine: machineCode,
    version: cleanVer(b.version) || prev && prev.version || "",
    firstSeenAt: prev && prev.firstSeenAt || now,
    lastSeenAt: now,
    tokenAt: now,
    country: request.cf && request.cf.country || prev && prev.country || ""
  });
  if (rec.forged) {
    rec.locked = false;
    rec.lockMsg = "";
    delete rec.forged;
  }
  await saveRec(store, key, rec);
  const company = rec.profile && rec.profile.company || rec.note || "";
  return json2({ ok: true, token: await signToken(env, tokenPayload(serial, machineCode, company)) }, 200, origin);
}
async function handleAxelLicense(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (url.pathname === "/api/axel-license/admin" && request.method === "POST") return handleAdmin(request, env, origin);
  if (url.pathname === "/api/axel-license/register" && request.method === "POST") return handleRegister(request, env, origin).catch((e) => json2({ ok: false, error: e.message || String(e) }, 500, origin));
  if (url.pathname === "/api/axel-license/token" && request.method === "POST") return handleToken(request, env, origin).catch((e) => json2({ ok: false, error: e.message || String(e) }, 500, origin));
  if (url.pathname === "/api/axel-license" && request.method === "POST") return handleReport(request, env, origin);
  if (url.pathname === "/api/axel-license" && request.method === "GET") return handleList(request, env, origin);
  return json2({ ok: false, error: "Method Not Allowed" }, 405, origin);
}

// worker/oauth.js
var DEFAULT_REPO = "majianglong500-sketch/axellab-web";
var STATE_COOKIE = "ax_oauth_state";
var textRes = (msg, status, extra) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra || {} } });
function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
function renderBody(status, content, origin) {
  const payload = JSON.stringify({ token: content.token, provider: content.provider });
  const msg = status === "success" ? `authorization:github:success:${payload}` : `authorization:github:error:${JSON.stringify(content)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body><script>
(function() {
  var ORIGIN = ${jsLiteral(origin)};
  var MSG = ${jsLiteral(msg)};
  function recv(e) {
    if (e.origin !== ORIGIN) return;
    if (e.data === "authorizing:github" && e.source) {
      e.source.postMessage(MSG, ORIGIN);
      window.removeEventListener("message", recv, false);
      setTimeout(function () { try { window.close(); } catch (x) {} }, 400);
    }
  }
  window.addEventListener("message", recv, false);
  if (window.opener) window.opener.postMessage("authorizing:github", ORIGIN);
})();
</script><p style="font-family:system-ui;padding:2rem">\u6B63\u5728\u5B8C\u6210 GitHub \u767B\u5F55\u2026\u53EF\u5173\u95ED\u6B64\u7A97\u53E3\u3002</p></body></html>`;
}
function allowedGitHubPath(pathname, repo) {
  const p = pathname.toLowerCase();
  if (p === "/user" || p === "/rate_limit") return true;
  const base = "/repos/" + String(repo || DEFAULT_REPO).toLowerCase();
  return p === base || p.startsWith(base + "/");
}
async function proxyGitHub(request, url, env) {
  const prefix = "/api/github";
  let rest = url.pathname.slice(prefix.length);
  if (!rest.startsWith("/")) rest = "/" + rest;
  const target = new URL("https://api.github.com" + rest);
  target.search = url.search;
  if (target.origin !== "https://api.github.com" || !allowedGitHubPath(target.pathname, env.GITHUB_REPO)) {
    return textRes("\u6B64\u4EE3\u7406\u53EA\u7528\u4E8E\u672C\u7AD9\u540E\u53F0", 403);
  }
  const headers = new Headers();
  const auth = request.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);
  const accept = request.headers.get("Accept");
  headers.set("Accept", accept || "application/vnd.github+json");
  headers.set("User-Agent", "axellab-decap-proxy");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const init = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const upstream = await fetch(target.href, init);
  const outHeaders = new Headers();
  const pass = ["content-type", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-oauth-scopes", "link"];
  for (const k of pass) {
    const v = upstream.headers.get(k);
    if (v) outHeaders.set(k, v);
  }
  outHeaders.set("Access-Control-Allow-Origin", url.origin);
  outHeaders.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-GitHub-Api-Version");
  outHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  outHeaders.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}
function handleAuth(url, env) {
  const client_id = env.GITHUB_CLIENT_ID;
  if (!client_id) {
    return textRes(
      "\u672A\u914D\u7F6E GITHUB_CLIENT_ID\u3002\u8BF7\u5728 Cloudflare \u9879\u76EE Secrets \u4E2D\u8BBE\u7F6E\uFF0C\u5E76\u521B\u5EFA GitHub OAuth App\u3002\u89C1\u300A\u600E\u4E48\u7528\u540E\u53F0.md\u300B\u3002",
      500
    );
  }
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const redirectUrl = new URL("https://github.com/login/oauth/authorize");
  redirectUrl.searchParams.set("client_id", client_id);
  redirectUrl.searchParams.set("redirect_uri", `${url.origin}/api/callback`);
  redirectUrl.searchParams.set("scope", String(env.GITHUB_OAUTH_SCOPE || "repo").trim() || "repo");
  redirectUrl.searchParams.set("state", state);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl.href,
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/api/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
      "Cache-Control": "no-store"
    }
  });
}
async function handleCallback(request, url, env) {
  const client_id = env.GITHUB_CLIENT_ID;
  const client_secret = env.GITHUB_CLIENT_SECRET;
  const clearCookie = { "Set-Cookie": `${STATE_COOKIE}=; Path=/api/callback; HttpOnly; SameSite=Lax; Max-Age=0` };
  const html = (body, status) => new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...clearCookie }
  });
  if (!client_id || !client_secret) return textRes("\u7F3A\u5C11 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", 500);
  const code = url.searchParams.get("code");
  if (!code) return html(renderBody("error", { error: "missing code" }, url.origin), 400);
  const state = url.searchParams.get("state") || "";
  const want = readCookie(request, STATE_COOKIE);
  if (!state || !want || !safeEqual(state, want)) {
    return html(renderBody("error", { error: "state mismatch", hint: "\u767B\u5F55\u8D85\u65F6\u6216\u6765\u6E90\u4E0D\u5BF9\uFF0C\u8BF7\u56DE\u5230\u540E\u53F0\u91CD\u65B0\u70B9\u767B\u5F55" }, url.origin), 400);
  }
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "axellab-decap-oauth" },
      body: JSON.stringify({ client_id, client_secret, code, redirect_uri: `${url.origin}/api/callback` })
    });
    const result = await tokenRes.json();
    if (result.error || !result.access_token) {
      return html(renderBody("error", { error: result.error || "no token", error_description: result.error_description || "" }, url.origin), 401);
    }
    return html(renderBody("success", { token: result.access_token, provider: "github" }, url.origin), 200);
  } catch (err) {
    return textRes(String(err && err.message ? err.message : err), 500);
  }
}
var oauth_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === "/api/axel-license" || path.startsWith("/api/axel-license/")) {
      return handleAxelLicense(request, env);
    }
    if (path === "/api/axel-presence") {
      return handleAxelPresence(request, env);
    }
    if (request.method === "OPTIONS" && path.startsWith("/api/github")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": url.origin,
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-GitHub-Api-Version",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    if (path.startsWith("/api/github")) {
      try {
        return await proxyGitHub(request, url, env);
      } catch (err) {
        return textRes(String(err && err.message ? err.message : err), 502);
      }
    }
    if (path === "/api/auth") return handleAuth(url, env);
    if (path === "/api/callback") return handleCallback(request, url, env);
    if ((path === "/axel/latest.json" || path === "/axel/latest") && env.AXEL_LICENSE) {
      try {
        const cached = await env.AXEL_LICENSE.get("axel:latest.json");
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=60, must-revalidate"
            }
          });
        }
      } catch (_) {
      }
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  }
};
export {
  allowedGitHubPath,
  oauth_default as default,
  renderBody
};

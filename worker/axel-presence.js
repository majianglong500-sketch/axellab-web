/**
 * AXEL 在线心跳 / 管理列表
 * KV binding: AXEL_PRESENCE
 * Secret: AXEL_ADMIN_TOKEN
 *
 * POST /api/axel-presence  — 软件心跳 upsert（无需口令）
 * GET  /api/axel-presence  — 管理列表（需 Authorization: Bearer <AXEL_ADMIN_TOKEN>）
 *
 * 「在线」：服务器收到最后一次心跳的时间在最近 12 分钟内。
 * lastSeenAt 一律用服务器时间（以前用客户端上报的时间，电脑时钟不准或伪造时会一直显示在线）。
 */
import { isAdmin, kvMeta, listRecords } from "./util.js";

const KEY_PREFIX = "axel:presence:";
const ONLINE_MIN = 12;
const ONLINE_MS = ONLINE_MIN * 60 * 1000;
const MAX_BODY = 4096;
const TTL = 60 * 60 * 24 * 90; // 90 天无心跳则过期
// 同一台机器重复上报、内容没变时，这段时间内不重复写 KV（省写入额度，免费版每天只有 1000 次）
const MIN_WRITE_GAP_MS = 60 * 1000;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

function text(msg, status, origin) {
  return new Response(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
  });
}

function sanitizeHash(h) {
  const s = String(h || "").trim().toLowerCase().replace(/[^a-f0-9]/g, "");
  return s.length >= 16 && s.length <= 64 ? s : "";
}

function sanitizeShort(s, max = 40) {
  return String(s || "")
    .replace(/[\u0000-\u001f<>"'&]/g, "")
    .trim()
    .slice(0, max);
}

function sanitizeVersion(v) {
  return String(v || "")
    .trim()
    .replace(/[^0-9A-Za-z.\-+_]/g, "")
    .slice(0, 32);
}

function sanitizeTz(tz) {
  const s = String(tz || "").trim().slice(0, 64);
  if (!/^[A-Za-z0-9_+\-\/]+$/.test(s)) return "";
  return s;
}

/** 客户端自报的「最后活跃时间」只作参考：无效或比服务器时间还晚就丢掉 */
function sanitizeClientTime(v, now) {
  const t = Date.parse(String(v || "").slice(0, 40));
  if (!Number.isFinite(t) || t > now + 60 * 1000 || t < now - 365 * 86400 * 1000) return "";
  return new Date(t).toISOString();
}

function isOnline(lastSeenAt, now) {
  const t = Date.parse(lastSeenAt || "");
  return Number.isFinite(t) && now - t <= ONLINE_MS;
}

const SAME_FIELDS = ["version", "activated", "companyShort", "timezone", "country"];

async function handlePost(request, env, origin) {
  if (!env.AXEL_PRESENCE) {
    return text("未配置 KV 绑定 AXEL_PRESENCE。见 scripts/axel-presence.md", 500, origin);
  }
  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: false, error: "无法读取请求体" }, 400, origin);
  }
  if (raw.length > MAX_BODY) {
    return json({ ok: false, error: "载荷过大" }, 413, origin);
  }
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false, error: "JSON 无效" }, 400, origin);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "JSON 无效" }, 400, origin);
  const machineHash = sanitizeHash(body.machineHash);
  if (!machineHash) {
    return json({ ok: false, error: "machineHash 无效" }, 400, origin);
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
  const country =
    (request.cf && request.cf.country) ||
    request.headers.get("CF-IPCountry") ||
    (prev && prev.country) ||
    "";
  const record = {
    machineHash,
    version: sanitizeVersion(body.version) || (prev && prev.version) || "",
    activated: body.activated === true || body.activated === "true",
    companyShort: sanitizeShort(body.companyShort || body.company || ""),
    timezone: sanitizeTz(body.timezone) || (prev && prev.timezone) || "",
    lastSeenAt: nowIso,
    lastActiveAt: sanitizeClientTime(body.lastActiveAt || body.lastSeenAt, now) || (prev && prev.lastActiveAt) || "",
    firstSeenAt: (prev && prev.firstSeenAt) || nowIso,
    country: String(country || "").slice(0, 8),
    updatedAt: nowIso,
  };
  const unchanged =
    prev &&
    SAME_FIELDS.every((k) => prev[k] === record[k]) &&
    now - Date.parse(prev.updatedAt || prev.lastSeenAt || 0) < MIN_WRITE_GAP_MS;
  if (!unchanged) {
    await env.AXEL_PRESENCE.put(key, JSON.stringify(record), { expirationTtl: TTL, metadata: kvMeta(record) });
  }
  return json({ ok: true }, 200, origin);
}

async function handleGet(request, env, origin) {
  if (!String(env.AXEL_ADMIN_TOKEN || "").trim()) {
    return text("未配置 AXEL_ADMIN_TOKEN。请在 Cloudflare Secrets / .dev.vars 中设置。", 500, origin);
  }
  if (!isAdmin(request, env)) {
    return json({ ok: false, error: "未授权" }, 401, origin);
  }
  if (!env.AXEL_PRESENCE) {
    return text("未配置 KV 绑定 AXEL_PRESENCE。见 scripts/axel-presence.md", 500, origin);
  }
  const now = Date.now();
  const list = (await listRecords(env.AXEL_PRESENCE, KEY_PREFIX))
    .filter((rec) => rec && rec.machineHash)
    .map((rec) => ({
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
      online: isOnline(rec.lastSeenAt, now),
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
      clients: list,
    },
    200,
    origin
  );
}

export async function handleAxelPresence(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method === "POST") return handlePost(request, env, origin);
  if (request.method === "GET") return handleGet(request, env, origin);
  return text("Method Not Allowed", 405, origin);
}

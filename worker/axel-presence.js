/**
 * AXEL 在线心跳 / 管理列表
 * KV binding: AXEL_PRESENCE
 * Secret: AXEL_ADMIN_TOKEN
 *
 * POST /api/axel-presence  — 软件心跳 upsert（无需口令）
 * GET  /api/axel-presence  — 管理列表（需 Authorization: Bearer <AXEL_ADMIN_TOKEN>）
 *
 * 「在线」：lastSeenAt 在最近 12 分钟内
 */
const KEY_PREFIX = "axel:presence:";
const ONLINE_MS = 12 * 60 * 1000;
const MAX_BODY = 4096;

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
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
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
    .replace(/[\u0000-\u001f<>]/g, "")
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

function readAdminToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const x = request.headers.get("X-Admin-Token");
  if (x) return x.trim();
  return "";
}

function isOnline(lastSeenAt, now) {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= ONLINE_MS;
}

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
  const machineHash = sanitizeHash(body.machineHash);
  if (!machineHash) {
    return json({ ok: false, error: "machineHash 无效" }, 400, origin);
  }
  const nowIso = new Date().toISOString();
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
    lastSeenAt: sanitizeShort(body.lastActiveAt || body.lastSeenAt, 40) || nowIso,
    firstSeenAt: (prev && prev.firstSeenAt) || nowIso,
    country: String(country || "").slice(0, 8),
    updatedAt: nowIso,
  };
  // 校验 lastSeenAt 为合理时间，否则用服务器时间
  if (!Number.isFinite(Date.parse(record.lastSeenAt))) {
    record.lastSeenAt = nowIso;
  }
  await env.AXEL_PRESENCE.put(key, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 90, // 90 天无心跳则过期
  });
  return json({ ok: true }, 200, origin);
}

async function handleGet(request, env, origin) {
  const want = (env.AXEL_ADMIN_TOKEN || "").trim();
  if (!want) {
    return text("未配置 AXEL_ADMIN_TOKEN。请在 Cloudflare Secrets / .dev.vars 中设置。", 500, origin);
  }
  const got = readAdminToken(request);
  if (!got || got !== want) {
    return json({ ok: false, error: "未授权" }, 401, origin);
  }
  if (!env.AXEL_PRESENCE) {
    return text("未配置 KV 绑定 AXEL_PRESENCE。见 scripts/axel-presence.md", 500, origin);
  }
  const now = Date.now();
  const list = [];
  let cursor;
  do {
    const page = await env.AXEL_PRESENCE.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
    for (const k of page.keys || []) {
      const rec = await env.AXEL_PRESENCE.get(k.name, { type: "json" });
      if (!rec || !rec.machineHash) continue;
      list.push({
        machineHash: rec.machineHash,
        machineHashShort: String(rec.machineHash).slice(0, 8),
        version: rec.version || "",
        activated: !!rec.activated,
        companyShort: rec.companyShort || "",
        timezone: rec.timezone || "",
        lastSeenAt: rec.lastSeenAt || "",
        firstSeenAt: rec.firstSeenAt || "",
        country: rec.country || "",
        online: isOnline(rec.lastSeenAt, now),
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  list.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(b.lastSeenAt).localeCompare(String(a.lastSeenAt));
  });

  const onlineCount = list.filter((x) => x.online).length;
  return json(
    {
      ok: true,
      onlineWindowMinutes: 12,
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

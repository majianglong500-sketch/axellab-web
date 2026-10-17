// worker/axel-presence.js
var KEY_PREFIX = "axel:presence:";
var ONLINE_MS = 12 * 60 * 1e3;
var MAX_BODY = 4096;
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
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
  return String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
}
function sanitizeVersion(v) {
  return String(v || "").trim().replace(/[^0-9A-Za-z.\-+_]/g, "").slice(0, 32);
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
  const machineHash = sanitizeHash(body.machineHash);
  if (!machineHash) {
    return json({ ok: false, error: "machineHash \u65E0\u6548" }, 400, origin);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
    lastSeenAt: sanitizeShort(body.lastActiveAt || body.lastSeenAt, 40) || nowIso,
    firstSeenAt: prev && prev.firstSeenAt || nowIso,
    country: String(country || "").slice(0, 8),
    updatedAt: nowIso
  };
  if (!Number.isFinite(Date.parse(record.lastSeenAt))) {
    record.lastSeenAt = nowIso;
  }
  await env.AXEL_PRESENCE.put(key, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 90
    // 90 天无心跳则过期
  });
  return json({ ok: true }, 200, origin);
}
async function handleGet(request, env, origin) {
  const want = (env.AXEL_ADMIN_TOKEN || "").trim();
  if (!want) {
    return text("\u672A\u914D\u7F6E AXEL_ADMIN_TOKEN\u3002\u8BF7\u5728 Cloudflare Secrets / .dev.vars \u4E2D\u8BBE\u7F6E\u3002", 500, origin);
  }
  const got = readAdminToken(request);
  if (!got || got !== want) {
    return json({ ok: false, error: "\u672A\u6388\u6743" }, 401, origin);
  }
  if (!env.AXEL_PRESENCE) {
    return text("\u672A\u914D\u7F6E KV \u7ED1\u5B9A AXEL_PRESENCE\u3002\u89C1 scripts/axel-presence.md", 500, origin);
  }
  const now = Date.now();
  const list = [];
  let cursor;
  do {
    const page = await env.AXEL_PRESENCE.list({ prefix: KEY_PREFIX, cursor, limit: 1e3 });
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
        online: isOnline(rec.lastSeenAt, now)
      });
    }
    cursor = page.list_complete ? void 0 : page.cursor;
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
var enc = new TextEncoder();
var hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
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
function isAdmin(request, env) {
  const want = (env.AXEL_ADMIN_TOKEN || "").trim();
  if (!want) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const got = m ? m[1].trim() : (request.headers.get("X-Admin-Token") || "").trim();
  return !!got && got === want;
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
  const serial = normalizeSerial(b.serial);
  const machineCode = cleanCode(b.machineCode);
  if (!SERIAL_RE.test(serial) || !machineCode) return json2({ ok: false, error: "\u53C2\u6570\u65E0\u6548" }, 400, origin);
  const serialHash = await sha256Hex(serial);
  if (b.serialHash && String(b.serialHash).toLowerCase() !== serialHash) return json2({ ok: false, error: "\u53C2\u6570\u65E0\u6548" }, 400, origin);
  const secret = (env.AXEL_LICENSE_SECRET || "").trim();
  const forged = secret ? !await validSerial(secret, serial) : false;
  const key = KEY_PREFIX2 + serialHash;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const prev = await store.get(key, { type: "json" }) || {};
  const machines = Array.isArray(prev.machines) ? prev.machines : [];
  if (!machines.includes(machineCode)) machines.push(machineCode);
  const rec = Object.assign({}, prev, {
    serialHash,
    serialLast6: serial.replace(/-/g, "").slice(-6),
    machines: machines.slice(-10),
    lastMachine: machineCode,
    version: cleanVer(b.version) || prev.version || "",
    firstSeenAt: prev.firstSeenAt || now,
    lastSeenAt: now,
    country: request.cf && request.cf.country || prev.country || ""
  });
  if (forged) {
    rec.locked = true;
    rec.lockMsg = "\u5E8F\u5217\u53F7\u65E0\u6548\uFF0C\u8BF7\u8054\u7CFB\u5929\u8FDB\u5E7F\u544A 13201200112";
    rec.forged = true;
  }
  await store.put(key, JSON.stringify(rec));
  if (rec.locked) return json2({ status: "locked", msg: rec.lockMsg || LOCK_MSG }, 200, origin);
  return json2({ status: "ok", msg: "" }, 200, origin);
}
async function handleList(request, env, origin) {
  if (!isAdmin(request, env)) return json2({ ok: false, error: "\u672A\u6388\u6743" }, 401, origin);
  const store = kv(env);
  if (!store) return json2({ ok: false, error: "\u672A\u914D\u7F6E KV" }, 500, origin);
  const list = [];
  let cursor;
  do {
    const page = await store.list({ prefix: KEY_PREFIX2, cursor, limit: 1e3 });
    for (const k of page.keys || []) {
      const r = await store.get(k.name, { type: "json" });
      if (r && r.serialHash) list.push(r);
    }
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
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
    if (!rec.locked) delete rec.forged;
    await store.put(key, JSON.stringify(rec));
    return json2({ ok: true, record: rec }, 200, origin);
  }
  if (b.action === "issue") {
    const secret = (env.AXEL_LICENSE_SECRET || "").trim();
    if (!secret) return json2({ ok: false, error: "\u670D\u52A1\u5668\u672A\u914D\u7F6E AXEL_LICENSE_SECRET" }, 500, origin);
    const machineCode = cleanCode(b.machineCode);
    if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machineCode)) return json2({ ok: false, error: "\u672C\u673A\u7801\u683C\u5F0F\u5E94\u4E3A XXXX-XXXX-XXXX-XXXX" }, 400, origin);
    const serial = await makeSerial(secret);
    const serialHash = await sha256Hex(serial);
    const rec = { serialHash, serialLast6: serial.replace(/-/g, "").slice(-6), issuedFor: machineCode, issuedAt: now, note: cleanText(b.note, 60), machines: [], locked: false };
    await store.put(KEY_PREFIX2 + serialHash, JSON.stringify(rec));
    return json2({ ok: true, serial, record: rec }, 200, origin);
  }
  return json2({ ok: false, error: "\u672A\u77E5\u64CD\u4F5C" }, 400, origin);
}
async function handleAxelLicense(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (url.pathname === "/api/axel-license/admin" && request.method === "POST") return handleAdmin(request, env, origin);
  if (url.pathname === "/api/axel-license" && request.method === "POST") return handleReport(request, env, origin);
  if (url.pathname === "/api/axel-license" && request.method === "GET") return handleList(request, env, origin);
  return json2({ ok: false, error: "Method Not Allowed" }, 405, origin);
}

// worker/oauth.js
function renderBody(status, content) {
  const payload = JSON.stringify({ token: content.token, provider: content.provider });
  const msg = status === "success" ? `authorization:github:success:${payload}` : `authorization:github:error:${JSON.stringify(content)}`;
  return `<!doctype html><html><body><script>
(function() {
  function recv(e) {
    if (e.data === "authorizing:github") {
      e.source && e.source.postMessage(${JSON.stringify(msg)}, e.origin);
    }
  }
  window.addEventListener("message", recv, false);
  window.opener && window.opener.postMessage("authorizing:github", "*");
})();
<\/script><p style="font-family:system-ui;padding:2rem">\u6B63\u5728\u5B8C\u6210 GitHub \u767B\u5F55\u2026\u53EF\u5173\u95ED\u6B64\u7A97\u53E3\u3002</p></body></html>`;
}
async function proxyGitHub(request, url) {
  const prefix = "/api/github";
  let rest = url.pathname.slice(prefix.length);
  if (!rest.startsWith("/")) rest = "/" + rest;
  const target = new URL("https://api.github.com" + rest);
  target.search = url.search;
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
var oauth_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === "/api/axel-license" || path === "/api/axel-license/admin") {
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
        return await proxyGitHub(request, url);
      } catch (err) {
        return new Response(String(err && err.message ? err.message : err), {
          status: 502,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
    }
    if (path === "/api/auth") {
      const client_id = env.GITHUB_CLIENT_ID;
      if (!client_id) {
        return new Response(
          "\u672A\u914D\u7F6E GITHUB_CLIENT_ID\u3002\u8BF7\u5728 Cloudflare \u9879\u76EE Secrets \u4E2D\u8BBE\u7F6E\uFF0C\u5E76\u521B\u5EFA GitHub OAuth App\u3002\u89C1\u300A\u600E\u4E48\u7528\u540E\u53F0.md\u300B\u3002",
          { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
        );
      }
      const redirectUrl = new URL("https://github.com/login/oauth/authorize");
      redirectUrl.searchParams.set("client_id", client_id);
      redirectUrl.searchParams.set("redirect_uri", `${url.origin}/api/callback`);
      redirectUrl.searchParams.set("scope", "public_repo repo");
      redirectUrl.searchParams.set(
        "state",
        [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")
      );
      return Response.redirect(redirectUrl.href, 302);
    }
    if (path === "/api/callback") {
      const client_id = env.GITHUB_CLIENT_ID;
      const client_secret = env.GITHUB_CLIENT_SECRET;
      if (!client_id || !client_secret) {
        return new Response("\u7F3A\u5C11 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response(renderBody("error", { error: "missing code" }), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "axellab-decap-oauth"
          },
          body: JSON.stringify({ client_id, client_secret, code })
        });
        const result = await tokenRes.json();
        if (result.error) {
          return new Response(renderBody("error", result), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" }
          });
        }
        return new Response(
          renderBody("success", { token: result.access_token, provider: "github" }),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      } catch (err) {
        return new Response(String(err && err.message ? err.message : err), {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
    }
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
  oauth_default as default
};

/**
 * GitHub OAuth + API proxy for Decap CMS / 可视化编辑器 (Cloudflare Workers + Assets).
 * + AXEL presence heartbeat (/api/axel-presence)
 * + AXEL license (/api/axel-license)
 *
 * Secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, AXEL_ADMIN_TOKEN, AXEL_LICENSE_SECRET, AXEL_LICENSE_SIGN_KEY
 * 可选变量（[vars] 或 Dashboard）：
 *   GITHUB_REPO         允许代理访问的仓库，默认 majianglong500-sketch/axellab-web
 *   GITHUB_OAUTH_SCOPE  登录申请的权限，默认 "repo"；仓库是公开的话建议改成 "public_repo"
 * KV: AXEL_PRESENCE, AXEL_LICENSE
 *
 * Routes:
 *   /api/auth      → redirect to GitHub OAuth（带 state，写入 HttpOnly cookie）
 *   /api/callback  → 校验 state，换 token，只把 token 交给本站页面
 *   /api/github/*  → 代理 api.github.com（只放行 /user 和本仓库；国内浏览器可走本站）
 *   /api/axel-presence → AXEL 在线心跳 / 管理列表
 *   /api/axel-license  → AXEL 序列号在线核验 / 停用 / 发号
 */
import { handleAxelPresence } from "./axel-presence.js";
import { handleAxelLicense } from "./axel-license.js";
import { jsLiteral, safeEqual } from "./util.js";

const DEFAULT_REPO = "majianglong500-sketch/axellab-web";
const STATE_COOKIE = "ax_oauth_state";

const textRes = (msg, status, extra) =>
  new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", ...(extra || {}) } });

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/**
 * 登录弹窗页面。安全要点：
 * - 只和「本站」窗口握手（e.origin 必须等于本站），token 也只发给本站；
 *   否则任何网站都能 window.open("/api/auth") 然后把已授权用户的 token 骗走。
 * - 数据用 jsLiteral 转义，避免 GitHub 返回的错误文字里含 </script> 造成注入。
 */
export function renderBody(status, content, origin) {
  const payload = JSON.stringify({ token: content.token, provider: content.provider });
  const msg =
    status === "success"
      ? `authorization:github:success:${payload}`
      : `authorization:github:error:${JSON.stringify(content)}`;
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
</script><p style="font-family:system-ui;padding:2rem">正在完成 GitHub 登录…可关闭此窗口。</p></body></html>`;
}

/** 只放行编辑器 / Decap 需要的 GitHub 接口：/user、/rate_limit、本仓库 */
export function allowedGitHubPath(pathname, repo) {
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
    return textRes("此代理只用于本站后台", 403);
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
      "未配置 GITHUB_CLIENT_ID。请在 Cloudflare 项目 Secrets 中设置，并创建 GitHub OAuth App。见《怎么用后台.md》。",
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
      "Cache-Control": "no-store",
    },
  });
}

async function handleCallback(request, url, env) {
  const client_id = env.GITHUB_CLIENT_ID;
  const client_secret = env.GITHUB_CLIENT_SECRET;
  const clearCookie = { "Set-Cookie": `${STATE_COOKIE}=; Path=/api/callback; HttpOnly; SameSite=Lax; Max-Age=0` };
  const html = (body, status) =>
    new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...clearCookie },
    });
  if (!client_id || !client_secret) return textRes("缺少 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", 500);

  const code = url.searchParams.get("code");
  if (!code) return html(renderBody("error", { error: "missing code" }, url.origin), 400);

  const state = url.searchParams.get("state") || "";
  const want = readCookie(request, STATE_COOKIE);
  if (!state || !want || !safeEqual(state, want)) {
    return html(renderBody("error", { error: "state mismatch", hint: "登录超时或来源不对，请回到后台重新点登录" }, url.origin), 400);
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "axellab-decap-oauth" },
      body: JSON.stringify({ client_id, client_secret, code, redirect_uri: `${url.origin}/api/callback` }),
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

export default {
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
          "Access-Control-Max-Age": "86400",
        },
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

    // AXEL 更新清单：优先读 KV（便于发版后立刻生效，无需重传整站静态资源）
    if ((path === "/axel/latest.json" || path === "/axel/latest") && env.AXEL_LICENSE) {
      try {
        const cached = await env.AXEL_LICENSE.get("axel:latest.json");
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=60, must-revalidate",
            },
          });
        }
      } catch (_) { /* fall through to ASSETS */ }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

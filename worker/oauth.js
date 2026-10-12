/**
 * GitHub OAuth + API proxy for Decap CMS (Cloudflare Workers + Assets).
 * Secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * Routes:
 *   /api/auth      → redirect to GitHub OAuth
 *   /api/callback  → exchange code, postMessage to CMS popup
 *   /api/github/*  → proxy to api.github.com (国内浏览器可走本站)
 */
function renderBody(status, content) {
  const payload = JSON.stringify({ token: content.token, provider: content.provider });
  const msg =
    status === "success"
      ? `authorization:github:success:${payload}`
      : `authorization:github:error:${JSON.stringify(content)}`;
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
</script><p style="font-family:system-ui;padding:2rem">正在完成 GitHub 登录…可关闭此窗口。</p></body></html>`;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

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
        return await proxyGitHub(request, url);
      } catch (err) {
        return new Response(String(err && err.message ? err.message : err), {
          status: 502,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    }

    if (path === "/api/auth") {
      const client_id = env.GITHUB_CLIENT_ID;
      if (!client_id) {
        return new Response(
          "未配置 GITHUB_CLIENT_ID。请在 Cloudflare 项目 Secrets 中设置，并创建 GitHub OAuth App。见《怎么用后台.md》。",
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
        return new Response("缺少 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response(renderBody("error", { error: "missing code" }), {
          status: 400,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "axellab-decap-oauth",
          },
          body: JSON.stringify({ client_id, client_secret, code }),
        });
        const result = await tokenRes.json();
        if (result.error) {
          return new Response(renderBody("error", result), {
            status: 401,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response(
          renderBody("success", { token: result.access_token, provider: "github" }),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      } catch (err) {
        return new Response(String(err && err.message ? err.message : err), {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

/**
 * GitHub OAuth proxy for Decap CMS (Cloudflare Workers + Assets).
 * Secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * Routes: /api/auth  → redirect to GitHub
 *         /api/callback → exchange code, postMessage to CMS popup
 */
function renderBody(status, content) {
  const payload = JSON.stringify({ token: content.token, provider: content.provider });
  // Decap listens for authorization:github:success:<json>
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

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

    // Static assets: let the ASSETS binding serve (when Worker is invoked)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

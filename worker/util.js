/**
 * Worker 公共小工具（oauth / axel-license / axel-presence 共用）
 */
const enc = new TextEncoder();

/** 常量时间比较两个字符串，避免通过响应时间逐位猜口令 */
export function safeEqual(a, b) {
  const x = enc.encode(String(a || ""));
  const y = enc.encode(String(b || ""));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** 从 Authorization: Bearer xxx 或 X-Admin-Token 读后台口令 */
export function readAdminToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return (request.headers.get("X-Admin-Token") || "").trim();
}

/** 口令已配置且与请求一致 */
export function isAdmin(request, env) {
  const want = String(env.AXEL_ADMIN_TOKEN || "").trim();
  if (!want) return false;
  const got = readAdminToken(request);
  return !!got && safeEqual(got, want);
}

/**
 * KV 元数据上限 1024 字节。把记录里列表页要用的字段放进 metadata，
 * 这样后台列表只需一次 list() 就拿到所有数据，不必逐条 get()（单次请求最多 1000 次 KV 操作）。
 * 超长时返回 undefined，列表页会退回逐条读取。
 */
export function kvMeta(rec) {
  const s = JSON.stringify(rec);
  return enc.encode(s).length <= 1000 ? rec : undefined;
}

/**
 * 读取某前缀下全部记录：优先用 list() 带回的 metadata，没有 metadata 的旧记录再单独 get()。
 * @returns {Promise<object[]>}
 */
export async function listRecords(store, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys || []) {
      let rec = k.metadata;
      if (!rec || typeof rec !== "object") {
        try { rec = await store.get(k.name, { type: "json" }); } catch { rec = null; }
      }
      if (rec) out.push(rec);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** 把任意值安全地放进 <script> 里的 JS 字面量（防止 </script> 截断注入） */
export function jsLiteral(v) {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

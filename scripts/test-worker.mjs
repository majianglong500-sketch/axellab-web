// node scripts/test-worker.mjs —— 本地模拟 KV / GitHub，测试整个 Worker（不联网）
// 覆盖：GitHub 登录（state 校验、只发给本站）、代理白名单、在线心跳、序列号核验与后台操作
import worker, { renderBody, allowedGitHubPath } from "../worker/oauth.js";
import { makeSerial } from "../worker/axel-license.js";
import { safeEqual, jsLiteral } from "../worker/util.js";
import { generateKeyPairSync, verify as edVerify } from "node:crypto";

// 测试用的一次性签名密钥（正式私钥只放在 Cloudflare Secret 里）
const kp = generateKeyPairSync("ed25519");
const SIGN_KEY = kp.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
function checkToken(tok) {
  const [body, sig] = String(tok || "").split(".");
  if (!body || !sig) return null;
  const good = edVerify(null, Buffer.from(body), kp.publicKey, Buffer.from(sig, "base64url"));
  return good ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")) : null;
}

let failed = 0;
const ok = (n, c, d) => { console.log(c ? "  ✓" : "  ✗", n, d === undefined ? "" : d); if (!c) failed++; };
const section = (t) => console.log("\n" + t);

function makeKV() {
  const mem = new Map();
  const stats = { get: 0, put: 0, list: 0 };
  return {
    mem, stats,
    async get(k, o) { stats.get++; const r = mem.get(k); if (!r) return null; return o && o.type === "json" ? JSON.parse(r.value) : r.value; },
    async put(k, v, o) { stats.put++; mem.set(k, { value: v, metadata: o && o.metadata, ttl: o && o.expirationTtl }); },
    async list({ prefix }) { stats.list++; return { keys: [...mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, r]) => ({ name, metadata: r.metadata })), list_complete: true }; },
  };
}

const ORIGIN = "https://axellab.org";
const SECRET = "test-secret-123";
const presence = makeKV(), license = makeKV();
const env = {
  GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret",
  AXEL_ADMIN_TOKEN: "tok", AXEL_LICENSE_SECRET: SECRET, AXEL_LICENSE_SIGN_KEY: SIGN_KEY,
  AXEL_PRESENCE: presence, AXEL_LICENSE: license,
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
};
const req = (path, init) => worker.fetch(new Request(ORIGIN + path, init), env);
const jreq = async (path, method, body, token, headers) => {
  const r = await req(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};

// 假的 GitHub：记录收到的请求
const realFetch = globalThis.fetch;
const ghCalls = [];
globalThis.fetch = async (url, init) => {
  ghCalls.push({ url: String(url), init });
  if (String(url).startsWith("https://github.com/login/oauth/access_token")) {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(b.code === "good" ? { access_token: "gho_TEST" } : { error: "bad_verification_code" }), { headers: { "content-type": "application/json" } });
  }
  if (String(url).startsWith("https://api.github.com/")) return new Response('{"ok":1}', { headers: { "content-type": "application/json" } });
  return realFetch(url, init);
};

/* ---------------- 工具 ---------------- */
section("工具函数");
ok("safeEqual 相同", safeEqual("abc", "abc"));
ok("safeEqual 不同", !safeEqual("abc", "abd") && !safeEqual("abc", "abcd") && !safeEqual("", "x"));
ok("jsLiteral 转义 </script>", !/<\/script>/i.test(jsLiteral("</script><script>alert(1)</script>")));

/* ---------------- 登录 ---------------- */
section("GitHub 登录");
let r = await req("/api/auth");
const loc = new URL(r.headers.get("Location"));
const state = loc.searchParams.get("state");
const cookie = r.headers.get("Set-Cookie") || "";
ok("/api/auth 302 跳转 GitHub", r.status === 302 && loc.host === "github.com");
ok("带 32 位随机 state", /^[0-9a-f]{32}$/.test(state || ""), state);
ok("state 写进 HttpOnly cookie", cookie.includes("ax_oauth_state=" + state) && /HttpOnly/.test(cookie) && /Secure/.test(cookie));
ok("默认权限 repo", loc.searchParams.get("scope") === "repo");
env.GITHUB_OAUTH_SCOPE = "public_repo";
ok("可改成 public_repo", new URL((await req("/api/auth")).headers.get("Location")).searchParams.get("scope") === "public_repo");
delete env.GITHUB_OAUTH_SCOPE;

r = await req(`/api/callback?code=good&state=${state}`);
let body = await r.text();
ok("没有 cookie（别的网站发起的登录）→ 拒绝", r.status === 400 && /state mismatch/.test(body) && !/gho_TEST/.test(body));
r = await req(`/api/callback?code=good&state=wrong`, { headers: { Cookie: "ax_oauth_state=" + state } });
ok("state 不一致 → 拒绝", r.status === 400);
r = await req(`/api/callback?code=good&state=${state}`, { headers: { Cookie: "foo=1; ax_oauth_state=" + state } });
body = await r.text();
ok("state 正确 → 拿到 token", r.status === 200 && body.includes("gho_TEST"));
ok("回调页只和本站握手", body.includes('var ORIGIN = "https://axellab.org"') && body.includes("e.origin !== ORIGIN") && !/postMessage\([^)]*"\*"\)/.test(body));
ok("用后清掉 state cookie", /Max-Age=0/.test(r.headers.get("Set-Cookie") || ""));
r = await req(`/api/callback?code=bad&state=${state}`, { headers: { Cookie: "ax_oauth_state=" + state } });
ok("GitHub 报错 → 401", r.status === 401);
const evil = renderBody("error", { error: "</script><script>alert(1)</script>" }, ORIGIN);
ok("错误文字不能注入脚本", (evil.match(/<\/script>/g) || []).length === 1);

/* ---------------- 代理 ---------------- */
section("GitHub 代理白名单");
ok("允许 /user", allowedGitHubPath("/user"));
ok("允许本仓库", allowedGitHubPath("/repos/majianglong500-sketch/axellab-web/git/trees/abc") && allowedGitHubPath("/repos/Majianglong500-Sketch/AXELLAB-WEB"));
ok("拒绝别的仓库", !allowedGitHubPath("/repos/majianglong500-sketch/xj-quote-app/contents/x"));
ok("拒绝前缀相似的仓库", !allowedGitHubPath("/repos/majianglong500-sketch/axellab-web-private"));
ok("拒绝其它接口", !allowedGitHubPath("/user/repos") && !allowedGitHubPath("/gists"));
ghCalls.length = 0;
r = await req("/api/github/repos/majianglong500-sketch/xj-quote-app", { headers: { Authorization: "token x" } });
ok("请求别的仓库 → 403 且不转发", r.status === 403 && ghCalls.length === 0);
r = await req("/api/github/repos/majianglong500-sketch/axellab-web/../xj-quote-app", { headers: { Authorization: "token x" } });
ok("路径里带 .. 绕不过去", r.status === 403 && ghCalls.length === 0);
r = await req("/api/github/repos/majianglong500-sketch/axellab-web/git/ref/heads/main", { headers: { Authorization: "token x" } });
ok("本仓库正常转发", r.status === 200 && ghCalls.length === 1 && ghCalls[0].url === "https://api.github.com/repos/majianglong500-sketch/axellab-web/git/ref/heads/main" && ghCalls[0].init.headers.get("Authorization") === "token x");
ok("其它路径交给静态资源", (await (await req("/index.html")).text()) === "asset");

/* ---------------- 在线心跳 ---------------- */
section("在线心跳");
const mh = "a".repeat(64);
const future = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
r = await jreq("/api/axel-presence", "POST", { machineHash: mh, version: "1.0.34", activated: true, companyShort: 'ACME"<b>', timezone: "Asia/Shanghai", lastActiveAt: future });
ok("心跳 ok", r.status === 200 && r.data.ok);
let rec = JSON.parse(presence.mem.get("axel:presence:" + mh).value);
ok("lastSeenAt 用服务器时间（客户端报未来时间无效）", Math.abs(Date.parse(rec.lastSeenAt) - Date.now()) < 5000 && rec.lastActiveAt === "");
ok("公司简称去掉引号和尖括号", rec.companyShort === "ACMEb");
ok("写入了 metadata（列表免逐条读取）", !!presence.mem.get("axel:presence:" + mh).metadata);
const puts = presence.stats.put;
await jreq("/api/axel-presence", "POST", { machineHash: mh, version: "1.0.34", activated: true, companyShort: 'ACME"<b>', timezone: "Asia/Shanghai" });
ok("1 分钟内重复同样心跳不再写 KV", presence.stats.put === puts);
await jreq("/api/axel-presence", "POST", { machineHash: mh, version: "1.0.35", activated: true, timezone: "Asia/Shanghai" });
ok("版本变了立刻写", presence.stats.put === puts + 1);
ok("坏 machineHash → 400", (await jreq("/api/axel-presence", "POST", { machineHash: "zz" })).status === 400);
ok("列表要口令", (await jreq("/api/axel-presence", "GET")).status === 401);
ok("错口令 → 401", (await jreq("/api/axel-presence", "GET", null, "tok2")).status === 401);
presence.stats.get = 0;
r = await jreq("/api/axel-presence", "GET", null, "tok");
ok("列表 ok 且在线 1 台", r.data.ok && r.data.onlineCount === 1 && r.data.clients[0].version === "1.0.35", r.data.onlineCount);
ok("列表只用 1 次 list，不逐条 get", presence.stats.get === 0, presence.stats.get);
presence.mem.set("axel:presence:" + "b".repeat(64), { value: JSON.stringify({ machineHash: "b".repeat(64), lastSeenAt: "2020-01-01T00:00:00Z" }) });
r = await jreq("/api/axel-presence", "GET", null, "tok");
ok("没有 metadata 的旧记录仍能显示（离线）", r.data.totalReported === 2 && r.data.onlineCount === 1);

/* ---------------- 序列号 ---------------- */
section("序列号");
r = await jreq("/api/axel-license/admin", "POST", { action: "issue", machineCode: "5D70-99B4-1ACF-D5A5", note: "测试" }, "tok");
const serial = r.data && r.data.serial;
ok("发号", r.data.ok && /^AXEL-/.test(serial), serial);
ok("发号同时给离线授权码（绑定本机码）", (() => { const p = checkToken(r.data.token); return p && p.s === serial && p.mc === "5D70-99B4-1ACF-D5A5"; })());
ok("无口令发号被拒", (await jreq("/api/axel-license/admin", "POST", { action: "issue", machineCode: "5D70-99B4-1ACF-D5A5" })).status === 401);
r = await jreq("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5", version: "1.0.34" });
ok("报到 ok", r.data.status === "ok");
const lputs = license.stats.put;
r = await jreq("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5", version: "1.0.34" });
ok("10 分钟内重复报到不写 KV", r.data.status === "ok" && license.stats.put === lputs);
r = await jreq("/api/axel-license", "POST", { serial, machineCode: "AAAA-BBBB-CCCC-DDDD", version: "1.0.34" });
ok("换机器会记录", r.data.status === "ok" && license.stats.put === lputs + 1);

const fake = "AXEL-AAAA-BBBB-CCCC-DDDD";
r = await jreq("/api/axel-license", "POST", { serial: fake, machineCode: "AAAA-BBBB-CCCC-DDDD" });
ok("伪造号 → locked", r.data.status === "locked");
const fakeKey = [...license.mem.keys()].find((k) => JSON.parse(license.mem.get(k).value).forged);
ok("伪造号记录 30 天自动过期", license.mem.get(fakeKey).ttl === 60 * 60 * 24 * 30);

// 模拟「服务器密钥一度配错」：先用错密钥判成伪造，改对后应自动恢复
const good2 = await makeSerial(SECRET);
env.AXEL_LICENSE_SECRET = "wrong-secret";
r = await jreq("/api/axel-license", "POST", { serial: good2, machineCode: "1111-2222-3333-4444" });
ok("密钥配错时被误判伪造", r.data.status === "locked");
env.AXEL_LICENSE_SECRET = SECRET;
r = await jreq("/api/axel-license", "POST", { serial: good2, machineCode: "1111-2222-3333-4444" });
ok("密钥改对后自动恢复，不用人工解锁", r.data.status === "ok");

const fake3 = "AXEL-ZZZZ-YYYY-XXXX-WWWW";
await jreq("/api/axel-license", "POST", { serial: fake3, machineCode: "2222-3333-4444-5555" });
delete env.AXEL_LICENSE_SECRET;
r = await jreq("/api/axel-license", "POST", { serial: fake3, machineCode: "2222-3333-4444-6666" });
ok("临时删掉密钥时伪造号不会被放出去", r.data.status === "locked");
env.AXEL_LICENSE_SECRET = SECRET;

license.stats.get = 0;
r = await jreq("/api/axel-license", "GET", null, "tok");
ok("列表", r.data.ok && r.data.total === 4, r.data.total);
ok("列表不逐条 get", license.stats.get === 0, license.stats.get);
const issued = r.data.licenses.find((x) => x.serialLast6 === serial.replace(/-/g, "").slice(-6));
ok("记录含两台机器", issued && issued.machines.length === 2 && issued.version === "1.0.34");
ok("列表需口令", (await jreq("/api/axel-license", "GET")).status === 401);

await jreq("/api/axel-license/admin", "POST", { action: "lock", serialHash: issued.serialHash }, "tok");
r = await jreq("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5" });
ok("锁定后报到 → locked + 中文", r.data.status === "locked" && /已被停用/.test(r.data.msg), r.data.msg);
await jreq("/api/axel-license/admin", "POST", { action: "unlock", serialHash: issued.serialHash }, "tok");
ok("解锁后 ok", (await jreq("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5" })).data.status === "ok");

const fakeHash = JSON.parse(license.mem.get(fakeKey).value).serialHash;
await jreq("/api/axel-license/admin", "POST", { action: "unlock", serialHash: fakeHash }, "tok");
r = await jreq("/api/axel-license", "POST", { serial: fake, machineCode: "AAAA-BBBB-CCCC-DDDD", version: "9" });
ok("手动解锁的「伪造」号不会被再次自动锁", r.data.status === "ok");
await jreq("/api/axel-license/admin", "POST", { action: "lock", serialHash: fakeHash }, "tok");
ok("再手动锁定 → locked", (await jreq("/api/axel-license", "POST", { serial: fake, machineCode: "AAAA-BBBB-CCCC-DDDD", version: "10" })).data.status === "locked");

ok("坏参数 400", (await jreq("/api/axel-license", "POST", { serial: "x", machineCode: "" })).status === 400);
ok("非对象 JSON → 400", (await req("/api/axel-license", { method: "POST", body: "null" })).status === 400);

/* ---------------- 自助领号 / 签名授权 ---------------- */
section("自助领号与签名授权");
const MC = "ABCD-1234-ABCD-5678";
const regBody = { company: "乌鲁木齐某某广告有限公司", contact: "张三", phone: "138 0000 0000", region: "乌鲁木齐", mode: "both", machineCode: MC, version: "1.0.35", agree: true };
r = await jreq("/api/axel-license/register", "POST", regBody, null, { "CF-Connecting-IP": "1.1.1.1" });
ok("领号成功", r.status === 200 && r.data.ok && /^AXEL-/.test(r.data.serial), JSON.stringify(r.data).slice(0, 80));
const regSerial = r.data.serial;
let tk = checkToken(r.data.token);
ok("token 签名有效、绑定本机码", tk && tk.s === regSerial && tk.mc === MC && tk.v === 1);
ok("token 带公司名（截短）", tk && tk.co && tk.co.length <= 20);
r = await jreq("/api/axel-license", "POST", { serial: regSerial, machineCode: MC, version: "1.0.34" });
ok("领到的号旧版软件也认", r.data.status === "ok");
r = await jreq("/api/axel-license/register", "POST", regBody, null, { "CF-Connecting-IP": "1.1.1.1" });
ok("同一台电脑再领 → 同一个号", r.data.ok && r.data.serial === regSerial && r.data.again === true);
r = await jreq("/api/axel-license", "GET", null, "tok");
const regRec = r.data.licenses.find((x) => x.serialLast6 === regSerial.replace(/-/g, "").slice(-6));
ok("后台能看到公司 / 电话 / 地区", regRec && regRec.profile && regRec.profile.phone === "13800000000" && regRec.profile.region === "乌鲁木齐" && regRec.source === "self");
ok("缺手机号被拒", (await jreq("/api/axel-license/register", "POST", { ...regBody, phone: "123", machineCode: "ABCD-1234-ABCD-0001" })).status === 400);
ok("没勾同意被拒", (await jreq("/api/axel-license/register", "POST", { ...regBody, agree: false, machineCode: "ABCD-1234-ABCD-0002" })).status === 400);
ok("本机码无效被拒", (await jreq("/api/axel-license/register", "POST", { ...regBody, machineCode: "XYZ" })).status === 400);
ok("公司名过短被拒", (await jreq("/api/axel-license/register", "POST", { ...regBody, company: "a", machineCode: "ABCD-1234-ABCD-0003" })).status === 400);
let limited = 0;
for (let i = 0; i < 22; i++) {
  const mc = "EEEE-0000-0000-" + String(i).padStart(4, "0");
  const x = await jreq("/api/axel-license/register", "POST", { ...regBody, machineCode: mc }, null, { "CF-Connecting-IP": "9.9.9.9" });
  if (x.status === 429) limited++;
}
ok("同一 IP 一天最多 20 个", limited === 2, limited);

// 换签名授权
r = await jreq("/api/axel-license/token", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5", version: "1.0.35" });
tk = r.data && checkToken(r.data.token);
ok("手工发的号能换签名授权", r.status === 200 && tk && tk.s === serial && tk.mc === "5D70-99B4-1ACF-D5A5");
ok("伪造号不能换授权", (await jreq("/api/axel-license/token", "POST", { serial: "AXEL-AAAA-BBBB-CCCC-DDDD", machineCode: MC })).status === 400);
await jreq("/api/axel-license/admin", "POST", { action: "lock", serialHash: issued.serialHash }, "tok");
r = await jreq("/api/axel-license/token", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5" });
ok("停用的号不能换授权", r.status === 403 && r.data.status === "locked");
await jreq("/api/axel-license/admin", "POST", { action: "unlock", serialHash: issued.serialHash }, "tok");
await jreq("/api/axel-license/admin", "POST", { action: "lock", serialHash: regRec.serialHash }, "tok");
r = await jreq("/api/axel-license/register", "POST", regBody, null, { "CF-Connecting-IP": "1.1.1.1" });
ok("号被停用后，同一台电脑重新领也不给", r.status === 403 && r.data.status === "locked");
await jreq("/api/axel-license/admin", "POST", { action: "unlock", serialHash: regRec.serialHash }, "tok");
env.AXEL_MAX_MACHINES = "2";
await jreq("/api/axel-license/token", "POST", { serial: regSerial, machineCode: "FFFF-0000-0000-0001" });
r = await jreq("/api/axel-license/token", "POST", { serial: regSerial, machineCode: "FFFF-0000-0000-0002" });
ok("限制台数时第 3 台被拒", r.status === 403 && r.data.status === "tooMany", r.data && r.data.error);
delete env.AXEL_MAX_MACHINES;
const noKey = { ...env, AXEL_LICENSE_SIGN_KEY: "" };
r = await worker.fetch(new Request(ORIGIN + "/api/axel-license/token", { method: "POST", body: JSON.stringify({ serial, machineCode: MC }) }), noKey);
ok("未配置私钥时明确报错", r.status === 500 && /AXEL_LICENSE_SIGN_KEY/.test((await r.json()).error));


globalThis.fetch = realFetch;
if (failed) { console.error("\nFAILED", failed); process.exit(1); }
console.log("\nALL PASS");

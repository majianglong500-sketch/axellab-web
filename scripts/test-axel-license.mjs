// node scripts/test-axel-license.mjs  —— 本地模拟 KV 测试序列号核验/停用/发号（不联网）
import { createRequire } from "module";
import { handleAxelLicense } from "../worker/axel-license.js";
const require = createRequire(import.meta.url);
let failed = 0;
const ok = (n, c, d) => { console.log(c ? "  ✓" : "  ✗", n, d || ""); if (!c) failed++; };
const mem = new Map();
const KV = { get: async (k, o) => (mem.has(k) ? (o && o.type === "json" ? JSON.parse(mem.get(k)) : mem.get(k)) : null), put: async (k, v) => mem.set(k, v),
  list: async ({ prefix }) => ({ keys: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const SECRET = "test-secret-123";
const env = { AXEL_LICENSE: KV, AXEL_ADMIN_TOKEN: "tok", AXEL_LICENSE_SECRET: SECRET };
const call = async (path, method, body, token) => {
  const res = await handleAxelLicense(new Request("https://axellab.org" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json() };
};
// 使用软件同一套 HMAC 逻辑生成序列号，验证两端一致
let appLic = null;
try { appLic = require("../../xj-quote-app/src/lib/license.js"); } catch { /* 仓库不在旁边则跳过 */ }

let r = await call("/api/axel-license/admin", "POST", { action: "issue", machineCode: "5D70-99B4-1ACF-D5A5", note: "测试" }, "tok");
ok("发号", r.data.ok && /^AXEL-/.test(r.data.serial), r.data.serial);
const serial = r.data.serial;
if (appLic) ok("软件端校验服务器发的号", appLic.validateSerial(SECRET, serial).ok);
ok("无口令发号被拒", (await call("/api/axel-license/admin", "POST", { action: "issue", machineCode: "5D70-99B4-1ACF-D5A5" })).status === 401);
r = await call("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5", version: "1.0.10" });
ok("报到 ok", r.data.status === "ok");
if (appLic) {
  const s2 = appLic.makeSerial(SECRET, "ABCDEFGHJKLM");
  ok("离线工具生成的号也能通过", (await call("/api/axel-license", "POST", { serial: s2, machineCode: "AAAA-BBBB-CCCC-DDDD" })).data.status === "ok");
}
ok("伪造号 → locked", (await call("/api/axel-license", "POST", { serial: "AXEL-AAAA-BBBB-CCCC-DDDD", machineCode: "AAAA-BBBB-CCCC-DDDD" })).data.status === "locked");
r = await call("/api/axel-license", "GET", null, "tok");
ok("列表", r.data.ok && r.data.total === (appLic ? 3 : 2), r.data.total);
const rec = r.data.licenses.find((x) => x.serialLast6 === serial.replace(/-/g, "").slice(-6));
ok("记录含机器码/版本", rec && rec.machines[0] === "5D70-99B4-1ACF-D5A5" && rec.version === "1.0.10" && rec.firstSeenAt);
ok("列表需口令", (await call("/api/axel-license", "GET")).status === 401);
await call("/api/axel-license/admin", "POST", { action: "lock", serialHash: rec.serialHash }, "tok");
r = await call("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5" });
ok("锁定后报到 → locked + 中文", r.data.status === "locked" && /已被停用/.test(r.data.msg), r.data.msg);
await call("/api/axel-license/admin", "POST", { action: "unlock", serialHash: rec.serialHash }, "tok");
ok("解锁后 ok", (await call("/api/axel-license", "POST", { serial, machineCode: "5D70-99B4-1ACF-D5A5" })).data.status === "ok");
ok("坏参数 400", (await call("/api/axel-license", "POST", { serial: "x", machineCode: "" })).status === 400);
if (failed) { console.error("\nFAILED", failed); process.exit(1); }
console.log("\nALL PASS");

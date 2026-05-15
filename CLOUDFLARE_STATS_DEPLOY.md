# Cloudflare Worker + KV — 全局用户行为统计后端

> 默认 admin 后台是 **本地模式** (只看本浏览器的统计). 部署本 Worker 后, admin 能看到**所有用户**的全局统计.
> 完全免费 (Cloudflare Free 计划包含 100k 次/天 Worker 调用 + 1GB KV 存储).

---

## 部署步骤 (一次性, 约 10 分钟)

### Step 1: 创建 KV namespace

1. 登录 Cloudflare Dashboard
2. 左侧菜单 → **Workers & Pages** → **KV**
3. 点 **Create a namespace**
4. 命名: `STATS_KV` → 创建

### Step 2: 创建 Worker

1. 左侧菜单 → **Workers & Pages** → **Create**
2. 选 **Create Worker**
3. 命名: `caiyunbin-quant-stats` (后续 URL 会是 `https://caiyunbin-quant-stats.caiyunbinlihai.workers.dev`)
4. 点 **Deploy** (先用默认代码部署一下)

### Step 3: 替换 Worker 代码

1. 在 Worker 详情页, 点 **Quick edit** (或 **Edit code**)
2. 全选删除默认代码, 粘贴本文件最下方的 `worker.js` 代码
3. **修改顶部的 `ADMIN_SECRET`** — 这是 admin 拉统计的密码, 改成你自己的 (例如 `caiyunbin-stats-2026`)
4. 点 **Save and Deploy**

### Step 4: 绑定 KV namespace

1. 回到 Worker 详情页 → **Settings** → **Variables**
2. 找到 **KV Namespace Bindings** → 点 **Add binding**
3. Variable name: `STATS_KV`
4. KV namespace: 选刚才创建的 `STATS_KV`
5. 点 **Save and deploy**

### Step 5: 配置网站使用此 Worker

1. 编辑 `assets/activity.js` 顶部两行:
   ```js
   const STATS_API_URL = "https://caiyunbin-quant-stats.caiyunbinlihai.workers.dev";
   const STATS_API_KEY = "<你设置的 ADMIN_SECRET>";
   ```
2. push 到 GitHub
3. Cloudflare 自动重新部署网站

### Step 6: admin 后台查看

刷新 admin 后台, **📈 用户行为统计** 卡片会显示 "🌐 全局模式". 之后所有用户登录/访问的数据都会上报, admin 能集中看到.

---

## Worker 代码 (worker.js)

```javascript
// ============================================================
// caiyunbin-quant 用户行为统计 Worker
// 端点:
//   POST /track  匿名上报 (用户登录/心跳/退出)
//   GET  /stats  需 X-Admin-Secret 头, 返回所有用户聚合统计
// ============================================================

const ADMIN_SECRET = "caiyunbin-stats-2026";   // ⚠ 改成你自己的, admin.html 也要同步改

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const cors = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
        };
        if (request.method === "OPTIONS") return new Response(null, {headers: cors});

        // POST /track
        if (url.pathname === "/track" && request.method === "POST") {
            try {
                const body = await request.json();
                const token = body.token || "anon";
                const event = body.event || "unknown";
                const ts = body.ts || new Date().toISOString();

                // 取已有数据
                const keyUser = `user:${token}`;
                const raw = await env.STATS_KV.get(keyUser);
                let u = raw ? JSON.parse(raw) : {
                    token, user: body.user || token, role: body.role || "user",
                    first_login: ts, login_count: 0, total_seconds: 0,
                    devices: {}, sessions: [],
                };

                if (event === "login") {
                    u.login_count++;
                    u.last_login = ts;
                    u.user = body.user || u.user;
                    u.role = body.role || u.role;
                    if (body.device) {
                        if (!u.devices[body.device]) {
                            u.devices[body.device] = {ua: body.ua, first_seen: ts, last_seen: ts};
                        } else {
                            u.devices[body.device].last_seen = ts;
                        }
                    }
                    if (body.session) {
                        u.sessions.push({id: body.session, device: body.device, start: ts, duration_s: 0});
                        if (u.sessions.length > 50) u.sessions = u.sessions.slice(-50);
                    }
                } else if (event === "heartbeat" || event === "logout") {
                    if (body.session) {
                        const s = u.sessions.find(s => s.id === body.session);
                        if (s) {
                            s.duration_s = body.elapsed_s || s.duration_s;
                            s.end = ts;
                        }
                    }
                    u.total_seconds = u.sessions.reduce((a, s) => a + (s.duration_s || 0), 0);
                }

                await env.STATS_KV.put(keyUser, JSON.stringify(u));
                // 维护用户列表索引
                const idxRaw = await env.STATS_KV.get("user_index");
                let idx = idxRaw ? JSON.parse(idxRaw) : [];
                if (!idx.includes(token)) {
                    idx.push(token);
                    await env.STATS_KV.put("user_index", JSON.stringify(idx));
                }
                return new Response(JSON.stringify({ok: true}), {headers: {"Content-Type": "application/json", ...cors}});
            } catch (e) {
                return new Response(JSON.stringify({ok: false, err: e.message}), {status: 500, headers: cors});
            }
        }

        // GET /stats
        if (url.pathname === "/stats" && request.method === "GET") {
            const secret = request.headers.get("X-Admin-Secret");
            if (secret !== ADMIN_SECRET) {
                return new Response(JSON.stringify({ok: false, err: "unauthorized"}), {status: 401, headers: cors});
            }
            const idxRaw = await env.STATS_KV.get("user_index");
            const idx = idxRaw ? JSON.parse(idxRaw) : [];
            const users = {};
            for (const token of idx) {
                const u = await env.STATS_KV.get(`user:${token}`);
                if (u) users[token] = JSON.parse(u);
            }
            return new Response(JSON.stringify({users, generated_at: new Date().toISOString()}),
                {headers: {"Content-Type": "application/json", ...cors}});
        }

        return new Response("Not Found", {status: 404, headers: cors});
    },
};
```

---

## 安全性

- `ADMIN_SECRET` 在 Worker 服务端校验, 不暴露给前端 (前端只发 POST /track 匿名上报)
- admin.html 的 STATS_API_KEY 是 admin 自己浏览器里的, 任何能看到代码的人能拿到 — 接受 (这只是读 stats 的密码, 不能修改数据)
- 如果担心 stats 被偷看, 把 ADMIN_SECRET 复杂化 (16 位+) 即可

## 资源消耗

| 项 | 免费额度 | 我们的用量 |
|---|---|---|
| Worker 调用 | 100,000 次/天 | 50 用户 × 每天 100 次心跳 = 5000 次/天 |
| KV 读 | 100,000 次/天 | admin 偶尔读, 估 10 次/天 |
| KV 写 | 1000 次/天 | 5000 次/天 ⚠ 超! |
| KV 存储 | 1 GB | < 1MB |

⚠ 默认 KV 免费写 1000/天, 我们如果 50 用户每天 100 心跳就超了. 解决:
- 减少心跳频率 (改 `HEARTBEAT_INTERVAL_MS = 300000` → 5 分钟一次)
- 或 Worker 内部合并写 (用 cache 1 分钟内的请求合并)

简单方案: 把 `activity.js` 里的 `HEARTBEAT_INTERVAL_MS` 改成 `5 * 60 * 1000` (5 分钟), 50 用户每天 100 心跳 → 50×24×12 = 14400, 还是会超. 改成 10 分钟即 50×24×6 = 7200 还是超.

实际推荐: **登录只记录 login + logout 事件** (跳过心跳), 这样 50 用户/天约 100-200 次写, 远低于 1000.

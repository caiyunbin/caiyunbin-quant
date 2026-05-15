// ============================================================
// 用户行为统计 (客户端 LocalStorage + 可选 Cloudflare Worker 后端)
// ============================================================
// - 默认: 仅本浏览器 LocalStorage 记录, 用户能看到自己的统计
// - 可选: 配置 STATS_API_URL (Cloudflare Worker) 让所有用户上报, admin 集中读
// ============================================================

// 改成你的 Cloudflare Worker URL 后, 开启集中统计.
// 留空 = 仅本浏览器存
const STATS_API_URL = "";   // 例: "https://caiyunbin-stats.caiyunbinlihai.workers.dev"
const STATS_API_KEY = "";   // 上报匿名免 key; admin 读取需 key 校验

const ACT_KEY = "caiman_activity_2026";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;   // 每 60 秒心跳一次, 更新停留时长

let __session_start = Date.now();
let __session_id = null;
let __heartbeat_timer = null;

function _now() { return new Date().toISOString(); }

function loadLocalActivity() {
    try { return JSON.parse(localStorage.getItem(ACT_KEY) || '{"users": {}}'); }
    catch (e) { return {users: {}}; }
}
function saveLocalActivity(d) { localStorage.setItem(ACT_KEY, JSON.stringify(d)); }

// 记录登录事件
function trackLogin(user, role, tokenPrefix, deviceId) {
    __session_id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    __session_start = Date.now();
    const act = loadLocalActivity();
    const u = act.users[tokenPrefix] || {
        user: user,
        role: role,
        first_login: _now(),
        login_count: 0,
        total_seconds: 0,
        devices: [],
        sessions: [],
        last_login: null,
    };
    u.login_count += 1;
    u.last_login = _now();
    u.user = user;
    u.role = role;
    // 设备登记
    if (!u.devices.some(d => d.id === deviceId)) {
        u.devices.push({
            id: deviceId,
            ua: navigator.userAgent.slice(0, 200),
            first_seen: _now(),
            last_seen: _now(),
        });
    } else {
        const d = u.devices.find(d => d.id === deviceId);
        d.last_seen = _now();
    }
    // 新 session
    u.sessions.push({
        id: __session_id, device: deviceId,
        start: _now(), end: null, duration_s: 0,
    });
    // 只保留最近 50 个 session
    if (u.sessions.length > 50) u.sessions = u.sessions.slice(-50);
    act.users[tokenPrefix] = u;
    saveLocalActivity(act);

    // 远程上报 (如配置)
    _postRemote({
        event: "login", user, role, token: tokenPrefix,
        device: deviceId, ua: navigator.userAgent.slice(0, 200),
        ts: _now(), session: __session_id,
    });

    _startHeartbeat(tokenPrefix);
}

function _startHeartbeat(tokenPrefix) {
    if (__heartbeat_timer) clearInterval(__heartbeat_timer);
    __heartbeat_timer = setInterval(() => {
        const elapsed_s = Math.round((Date.now() - __session_start) / 1000);
        const act = loadLocalActivity();
        const u = act.users[tokenPrefix];
        if (!u) return;
        const sess = u.sessions.find(s => s.id === __session_id);
        if (sess) {
            sess.duration_s = elapsed_s;
            sess.end = _now();
        }
        // 总时长 = 所有 session.duration_s 之和
        u.total_seconds = u.sessions.reduce((a, s) => a + (s.duration_s || 0), 0);
        act.users[tokenPrefix] = u;
        saveLocalActivity(act);

        _postRemote({event: "heartbeat", token: tokenPrefix, session: __session_id, ts: _now(), elapsed_s});
    }, HEARTBEAT_INTERVAL_MS);
}

function trackLogout(tokenPrefix) {
    if (__heartbeat_timer) clearInterval(__heartbeat_timer);
    const elapsed_s = Math.round((Date.now() - __session_start) / 1000);
    const act = loadLocalActivity();
    const u = act.users[tokenPrefix];
    if (u) {
        const sess = u.sessions.find(s => s.id === __session_id);
        if (sess) {
            sess.duration_s = elapsed_s;
            sess.end = _now();
        }
        u.total_seconds = u.sessions.reduce((a, s) => a + (s.duration_s || 0), 0);
        act.users[tokenPrefix] = u;
        saveLocalActivity(act);
    }
    _postRemote({event: "logout", token: tokenPrefix, session: __session_id, ts: _now(), elapsed_s});
}

// 浏览器关闭时上报 (best effort)
window.addEventListener("beforeunload", () => {
    const auth = getAuthInfo();
    if (auth) trackLogout(auth.token);
});
// 页面隐藏时也心跳一次
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const auth = getAuthInfo();
        if (auth) {
            const elapsed_s = Math.round((Date.now() - __session_start) / 1000);
            const act = loadLocalActivity();
            const u = act.users[auth.token];
            if (u) {
                const sess = u.sessions.find(s => s.id === __session_id);
                if (sess) { sess.duration_s = elapsed_s; sess.end = _now(); }
                u.total_seconds = u.sessions.reduce((a, s) => a + (s.duration_s || 0), 0);
                saveLocalActivity(act);
            }
        }
    }
});

// 远程上报
async function _postRemote(payload) {
    if (!STATS_API_URL) return;
    try {
        await fetch(STATS_API_URL + "/track", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
            keepalive: true,   // 让 beforeunload 时也能发出
        });
    } catch (e) {}
}

// admin 拉取远程统计
async function fetchRemoteStats(adminSecret) {
    if (!STATS_API_URL) return null;
    try {
        const r = await fetch(STATS_API_URL + "/stats", {
            headers: {"X-Admin-Secret": adminSecret || STATS_API_KEY},
        });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { return null; }
}

// 当前页心跳触发 (每次访问任意页面都更新一次设备 last_seen)
function trackPageView() {
    const auth = getAuthInfo();
    if (!auth) return;
    if (!__session_id) {
        // 已登录但本 tab 没初始化 (例如刷新): 用现有 token, 模拟登录
        trackLogin(auth.user, auth.role, auth.token, auth.device || "unknown");
    }
}

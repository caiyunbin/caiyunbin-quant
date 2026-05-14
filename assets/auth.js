// ============================================================
// 多子策略决策引擎 — 账号池登录 (前端 sha256 校验)
// ============================================================
// 设计:
//   - 由本地 manage_accounts.py CLI 生成/撤销账号
//   - 账号池 = data/auth_pool.json (仅 sha256 hash 公开)
//   - 登录: sha256(user + ":" + password) 在池子里 且 expire > today → ok
//   - 凭证 LocalStorage 保存, 但每次跳转都重新校验 auth_pool (即可远程撤销)

const __AUTH_KEY = "caiman_auth_2026";

async function _sha256(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function _loadAuthPool() {
    // 子目录 vs 根目录
    const isSub = window.location.pathname.includes('/strategies/');
    const path = (isSub ? "../" : "") + "data/auth_pool.json";
    try {
        const r = await fetch(path + "?t=" + Date.now(), {cache: "no-store"});
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        console.error("auth_pool load fail:", e);
        return null;
    }
}

async function tryLogin(user, password) {
    if (!user || !password) {
        return { ok: false, msg: "请输入账号和密码" };
    }
    const pool = await _loadAuthPool();
    if (!pool || !pool.tokens) {
        return { ok: false, msg: "账号池未加载, 请稍后重试或联系管理员" };
    }
    const token = await _sha256(user + ":" + password);
    const expire = pool.tokens[token];
    if (!expire) {
        return { ok: false, msg: "账号或密码错误" };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (expire < today) {
        return { ok: false, msg: "该账号已过期 (到期 " + expire + "), 请联系管理员续期" };
    }
    localStorage.setItem(__AUTH_KEY, JSON.stringify({
        ts: Date.now(),
        token: token.slice(0, 12),
        user: user,
        expire: expire,
    }));
    return { ok: true, expire: expire };
}

function logout() {
    localStorage.removeItem(__AUTH_KEY);
    const isSub = window.location.pathname.includes('/strategies/');
    window.location.href = isSub ? "../login.html" : "login.html";
}

function getAuthInfo() {
    try {
        const raw = localStorage.getItem(__AUTH_KEY);
        if (!raw) return null;
        const t = JSON.parse(raw);
        if (!t.ts || !t.token || !t.user) return null;
        // 检查过期日 (相对本地时间)
        const today = new Date().toISOString().slice(0, 10);
        if (t.expire && t.expire < today) return null;
        return t;
    } catch (e) { return null; }
}

// 受保护页面调用: 校验本地凭证 + 远程 auth_pool (账号被撤销时也能即时拒绝)
async function requireAuthAsync() {
    const local = getAuthInfo();
    if (!local) {
        _gotoLogin();
        return;
    }
    // 远程校验: 看 token 还在 auth_pool 中且未过期
    const pool = await _loadAuthPool();
    if (!pool || !pool.tokens) {
        // 加载失败暂时放行 (避免网络抖动让用户登出)
        return;
    }
    // local.token 只是前 12 位; 完整 token 我们没存. 我们用 prefix 匹配
    const matched = Object.keys(pool.tokens).find(k => k.startsWith(local.token));
    if (!matched) {
        // 账号已撤销
        localStorage.removeItem(__AUTH_KEY);
        _gotoLogin("您的账号已被管理员撤销, 请重新登录");
        return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (pool.tokens[matched] < today) {
        localStorage.removeItem(__AUTH_KEY);
        _gotoLogin("您的账号已过期, 请联系管理员续期");
        return;
    }
}
function _gotoLogin(reason) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    const isSub = window.location.pathname.includes('/strategies/');
    let url = (isSub ? "../login.html" : "login.html") + "?back=" + back;
    if (reason) url += "&reason=" + encodeURIComponent(reason);
    window.location.href = url;
}

// 同步版本 (兼容旧调用): 只查本地, 不查远程
function requireAuth() {
    if (!getAuthInfo()) _gotoLogin();
    // 后台异步再做远程校验 (避免 race)
    setTimeout(requireAuthAsync, 100);
}

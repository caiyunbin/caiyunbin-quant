// ============================================================
// 多子策略决策引擎 — 账号池登录 V3 (admin/user 角色 + 2 设备限制 + 合规)
// ============================================================
const __AUTH_KEY = "caiman_auth_2026";
const __DEVICE_KEY = "caiman_device_2026";
const __COMPLIANCE_KEY = "caiman_compliance_2026";
const __DEVICE_REGISTRY_KEY = "caiman_devices_pool";   // 同浏览器跨账号设备登记

const MAX_DEVICES_PER_ACCOUNT = 2;

async function _sha256(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _getOrCreateDeviceId() {
    let did = localStorage.getItem(__DEVICE_KEY);
    if (!did) {
        // 简单生成: timestamp + random
        did = "d" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(__DEVICE_KEY, did);
    }
    return did;
}

async function _loadAuthPool() {
    const isSub = window.location.pathname.includes('/strategies/');
    const path = (isSub ? "../" : "") + "data/auth_pool.json";
    try {
        const r = await fetch(path + "?t=" + Date.now(), {cache: "no-store"});
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { return null; }
}

async function loadSiteConfig() {
    const isSub = window.location.pathname.includes('/strategies/');
    const path = (isSub ? "../" : "") + "data/site_config.json";
    try {
        const r = await fetch(path + "?t=" + Date.now(), {cache: "no-store"});
        if (!r.ok) return {etf_visible_to_users: true};
        return await r.json();
    } catch (e) { return {etf_visible_to_users: true}; }
}

// 2 设备绑定: 每个账号最多 2 个 device_id (LocalStorage 记录, 客户端自管)
function _getAccountDevices(tokenPrefix) {
    try {
        const raw = localStorage.getItem(__DEVICE_REGISTRY_KEY) || "{}";
        const reg = JSON.parse(raw);
        return reg[tokenPrefix] || [];
    } catch (e) { return []; }
}

function _addAccountDevice(tokenPrefix, deviceId) {
    try {
        const raw = localStorage.getItem(__DEVICE_REGISTRY_KEY) || "{}";
        const reg = JSON.parse(raw);
        if (!reg[tokenPrefix]) reg[tokenPrefix] = [];
        if (!reg[tokenPrefix].some(d => d.id === deviceId)) {
            reg[tokenPrefix].push({id: deviceId, last_seen: new Date().toISOString()});
        } else {
            // 更新 last_seen
            reg[tokenPrefix].find(d => d.id === deviceId).last_seen = new Date().toISOString();
        }
        localStorage.setItem(__DEVICE_REGISTRY_KEY, JSON.stringify(reg));
    } catch (e) {}
}

async function tryLogin(user, password) {
    if (!user || !password) return { ok: false, msg: "请输入账号和密码" };
    const pool = await _loadAuthPool();
    if (!pool || !pool.tokens) return { ok: false, msg: "账号池未加载, 请稍后重试" };

    const token = await _sha256(user + ":" + password);
    const expire = pool.tokens[token];
    if (!expire) return { ok: false, msg: "账号或密码错误" };

    const today = new Date().toISOString().slice(0, 10);
    if (expire < today) return { ok: false, msg: `该账号已过期 (到期 ${expire}), 请联系管理员续期` };

    const role = (pool.roles && pool.roles[token]) || "user";
    const tokenPrefix = token.slice(0, 12);
    const did = _getOrCreateDeviceId();

    // 2 设备限制 (仅 user, admin 不限)
    if (role === "user") {
        const devices = _getAccountDevices(tokenPrefix);
        // 清掉超过 30 天未活跃的设备
        const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
        const fresh = devices.filter(d => Date.parse(d.last_seen) > cutoff);
        const hasMe = fresh.some(d => d.id === did);
        if (!hasMe && fresh.length >= MAX_DEVICES_PER_ACCOUNT) {
            return {
                ok: false,
                msg: `该账号已绑定 ${MAX_DEVICES_PER_ACCOUNT} 个设备, 请先在其他设备退出后重试 (或联系管理员重置)`
            };
        }
    }

    _addAccountDevice(tokenPrefix, did);

    localStorage.setItem(__AUTH_KEY, JSON.stringify({
        ts: Date.now(),
        token: tokenPrefix,
        user: user,
        role: role,
        expire: expire,
        device: did,
    }));
    return { ok: true, expire: expire, role: role };
}

function logout() {
    // 仅清登录态, 保留 device_id 和 compliance (用户身份保留)
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
        const today = new Date().toISOString().slice(0, 10);
        if (t.expire && t.expire < today) return null;
        return t;
    } catch (e) { return null; }
}

function isAdmin() {
    const info = getAuthInfo();
    return info && info.role === "admin";
}

function _gotoLogin(reason) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    const isSub = window.location.pathname.includes('/strategies/');
    let url = (isSub ? "../login.html" : "login.html") + "?back=" + back;
    if (reason) url += "&reason=" + encodeURIComponent(reason);
    window.location.href = url;
}

async function requireAuthAsync() {
    const local = getAuthInfo();
    if (!local) { _gotoLogin(); return; }
    const pool = await _loadAuthPool();
    if (!pool || !pool.tokens) return;   // 网络抖动放行
    const matched = Object.keys(pool.tokens).find(k => k.startsWith(local.token));
    if (!matched) {
        localStorage.removeItem(__AUTH_KEY);
        _gotoLogin("您的账号已被管理员撤销, 请重新登录");
        return;
    }
    if (pool.tokens[matched] < new Date().toISOString().slice(0, 10)) {
        localStorage.removeItem(__AUTH_KEY);
        _gotoLogin("您的账号已过期");
        return;
    }
    // 更新 device 心跳
    _addAccountDevice(local.token, local.device || _getOrCreateDeviceId());
}

function requireAuth() {
    if (!getAuthInfo()) _gotoLogin();
    setTimeout(requireAuthAsync, 100);
}

function requireAdmin() {
    requireAuth();
    setTimeout(() => {
        if (!isAdmin()) {
            const isSub = window.location.pathname.includes('/strategies/');
            window.location.href = isSub ? "../index.html" : "index.html";
        }
    }, 200);
}

// 合规接受状态
function hasAcceptedCompliance() {
    return localStorage.getItem(__COMPLIANCE_KEY) === "1";
}
function acceptCompliance() {
    localStorage.setItem(__COMPLIANCE_KEY, "1");
    localStorage.setItem(__COMPLIANCE_KEY + "_at", new Date().toISOString());
}

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

    // ⭐ 2 设备限制: 仅 user 受限, admin 完全不限 (任意多设备, 不记账号设备 registry)
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
        _addAccountDevice(tokenPrefix, did);   // 仅 user 记录设备
    }
    // admin 完全不进 device registry, 即使在 5 个设备登录也不会被算

    localStorage.setItem(__AUTH_KEY, JSON.stringify({
        ts: Date.now(),
        token: tokenPrefix,
        user: user,
        role: role,
        expire: expire,
        device: did,
    }));

    // ⭐ admin 角色: 立即用密码解密 admin_creds.enc.json → sessionStorage
    if (role === "admin") {
        try { await _maybeDecryptAdminCreds(password); } catch (e) {}
    }

    // 用户行为统计
    if (typeof trackLogin === "function") {
        try { trackLogin(user, role, tokenPrefix, did); } catch (e) {}
    }

    return { ok: true, expire: expire, role: role };
}

function logout() {
    // 上报 logout (优先, 在清 LocalStorage 之前)
    const a = getAuthInfo();
    if (a && typeof trackLogout === "function") {
        try { trackLogout(a.token); } catch (e) {}
    }
    // 仅清登录态, 保留 device_id 和 compliance (用户身份保留)
    localStorage.removeItem(__AUTH_KEY);
    // admin 的解密明文清单一并清除
    localStorage.removeItem(__CREDS_LOCAL_KEY);
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

// ============================================================
// admin 专属: 用密码解密 admin_creds.enc.json → localStorage
// (改用 localStorage 是因为 sessionStorage 关浏览器就清空, 用户体验差)
// ============================================================
const __CREDS_LOCAL_KEY = "caiman_creds_decrypted_2026";

async function _decryptAesGcm(blob, password) {
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(blob.salt), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(blob.iv), c => c.charCodeAt(0));
    const cipher = Uint8Array.from(atob(blob.cipher), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), {name: "PBKDF2"}, false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
        {name: "PBKDF2", salt, iterations: blob.iterations || 100000, hash: "SHA-256"},
        keyMaterial, {name: "AES-GCM", length: 256}, false, ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv}, key, cipher
    );
    return dec.decode(plain);
}

async function _loadCredsEnc() {
    const isSub = window.location.pathname.includes('/strategies/');
    const path = (isSub ? "../" : "") + "data/admin_creds.enc.json";
    try {
        const r = await fetch(path + "?t=" + Date.now(), {cache: "no-store"});
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { return null; }
}

// 登录成功后调用, 或 admin 手动重新解密时调用
// 返回 {ok: true, n: N} 或 {ok: false, msg: ...}
async function decryptAdminCreds(password) {
    try {
        const blob = await _loadCredsEnc();
        if (!blob) return { ok: false, msg: "admin_creds.enc.json 不存在或无法访问" };
        const plain = await _decryptAesGcm(blob, password);
        localStorage.setItem(__CREDS_LOCAL_KEY, plain);
        const obj = JSON.parse(plain);
        return { ok: true, n: (obj.accounts || []).length };
    } catch (e) {
        localStorage.removeItem(__CREDS_LOCAL_KEY);
        return { ok: false, msg: "解密失败 (密码可能与加密时不一致): " + e.message };
    }
}

// 兼容旧接口名 (不抛错)
async function _maybeDecryptAdminCreds(password) {
    await decryptAdminCreds(password);
}

function getDecryptedAccounts() {
    const raw = localStorage.getItem(__CREDS_LOCAL_KEY);
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        return obj.accounts || null;
    } catch (e) { return null; }
}

function clearDecryptedCreds() {
    localStorage.removeItem(__CREDS_LOCAL_KEY);
}

// 查当前登录用户的 ETF 可见性 (从 auth_pool.etf_prefs[token] 读)
async function isEtfVisibleForCurrentUser() {
    const info = getAuthInfo();
    if (!info) return false;
    if (info.role === "admin") return true;  // admin 总是能看到
    const pool = await _loadAuthPool();
    if (!pool || !pool.etf_prefs) return true;  // 默认 true
    const matched = Object.keys(pool.etf_prefs).find(k => k.startsWith(info.token));
    if (!matched) return true;
    return pool.etf_prefs[matched] !== false;
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
    // 更新 device 心跳 (仅 user 角色, admin 不进 device registry)
    if (local.role === "user") {
        _addAccountDevice(local.token, local.device || _getOrCreateDeviceId());
    }
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

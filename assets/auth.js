// ============================================================
// 多子策略决策引擎 — 手机号 + 验证码 登录 (前端 sha256 校验)
// ============================================================
// 安全说明:
//   - 前端校验, 仅挡爬虫和无关访客, 不是高强度安全
//   - 验证码统一是 "caiman" (固定密码, 静态站无后端发短信)
//   - 手机号: 默认任意 11 位手机号都通过; 若 PHONE_WHITELIST 非空, 则只允许白名单
//   - 凭证 LocalStorage 保存 7 天

// caiman 的 sha256
const __CODE_HASH = "04c092601015157c6b24f7f458ad3bbee478d4b25930ab6ef305e9d79727b7eb";

// 手机号白名单 (sha256 hash). 留空数组 = 任意 11 位手机号都通过.
// 想限制, 把允许的手机号 hash 加进来 (python: hashlib.sha256(b'13800138000').hexdigest())
const __PHONE_WHITELIST = [
    // "abcdef..."   // 示例: 张三 138xxxx
];

const __AUTH_KEY = "caiman_auth_2026";
const __AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 天

async function _sha256(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function _isPhoneValid(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
}

async function _phoneAllowed(phone) {
    if (__PHONE_WHITELIST.length === 0) return true;   // 默认放行
    const h = await _sha256(phone);
    return __PHONE_WHITELIST.includes(h);
}

async function tryLogin(phone, code) {
    if (!_isPhoneValid(phone)) {
        return { ok: false, msg: "手机号格式不正确, 请输入 11 位有效手机号" };
    }
    if (!(await _phoneAllowed(phone))) {
        return { ok: false, msg: "该手机号未授权访问, 请联系管理员" };
    }
    const codeHash = await _sha256(code || "");
    if (codeHash !== __CODE_HASH) {
        return { ok: false, msg: "验证码错误, 请重新输入" };
    }
    const token = {
        ts: Date.now(),
        h: __CODE_HASH.slice(0, 8),
        phone: phone.slice(0, 3) + "****" + phone.slice(-4),   // 仅保存脱敏号
    };
    localStorage.setItem(__AUTH_KEY, JSON.stringify(token));
    return { ok: true, token };
}

function logout() {
    localStorage.removeItem(__AUTH_KEY);
    // 跳回 login (根 / 还是子目录都能正确处理)
    const isSub = window.location.pathname.includes('/strategies/');
    window.location.href = isSub ? "../login.html" : "login.html";
}

function getAuthInfo() {
    try {
        const raw = localStorage.getItem(__AUTH_KEY);
        if (!raw) return null;
        const t = JSON.parse(raw);
        if (!t.ts || !t.h) return null;
        if (Date.now() - t.ts > __AUTH_TTL_MS) return null;
        if (t.h !== __CODE_HASH.slice(0, 8)) return null;
        return t;
    } catch (e) { return null; }
}

function requireAuth() {
    if (!getAuthInfo()) {
        const back = encodeURIComponent(window.location.pathname + window.location.search);
        const isSub = window.location.pathname.includes('/strategies/');
        window.location.href = (isSub ? "../login.html" : "login.html") + "?back=" + back;
    }
}

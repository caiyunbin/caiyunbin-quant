// 前端简单密码锁 (sha256 校验, 仅挡爬虫不是高强度安全)
// 用法:
//   protected pages 顶部加: <script src="assets/auth.js"></script><script>requireAuth();</script>
//   login.html 调用: tryLogin(input)

// caiman 的 sha256
const __PWD_HASH = "04c092601015157c6b24f7f458ad3bbee478d4b25930ab6ef305e9d79727b7eb";

// LocalStorage key
const __AUTH_KEY = "caiman_auth_2026";
// 有效期 7 天 (毫秒)
const __AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function _sha256(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function tryLogin(input) {
    const h = await _sha256(input);
    if (h === __PWD_HASH) {
        const token = {
            ts: Date.now(),
            h: __PWD_HASH.slice(0, 8),
        };
        localStorage.setItem(__AUTH_KEY, JSON.stringify(token));
        return true;
    }
    return false;
}

function logout() {
    localStorage.removeItem(__AUTH_KEY);
    window.location.href = "login.html";
}

function _isAuthed() {
    try {
        const raw = localStorage.getItem(__AUTH_KEY);
        if (!raw) return false;
        const t = JSON.parse(raw);
        if (!t.ts || !t.h) return false;
        if (Date.now() - t.ts > __AUTH_TTL_MS) return false;
        if (t.h !== __PWD_HASH.slice(0, 8)) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function requireAuth() {
    if (!_isAuthed()) {
        // 跳到 login.html, 保留来路
        const back = encodeURIComponent(window.location.pathname + window.location.search);
        // 若已经在子页 (strategies/xxx.html), 需要回到根
        const path = window.location.pathname;
        const depth = (path.match(/\//g) || []).length - 1;
        const rel = depth > 0 ? "../".repeat(Math.max(0, depth - (path.endsWith("/") ? 0 : 0))) : "";
        // 简化: 子页用 ../login.html, 根用 login.html
        const isSubdir = path.includes('/strategies/');
        window.location.href = (isSubdir ? "../login.html" : "login.html") + "?back=" + back;
    }
}

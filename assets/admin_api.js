// ============================================================
// 管理员后台 - GitHub API 工具库 (PAT 模式, 让 toggle 即时生效)
// ============================================================
//
// 安全说明:
//   - PAT 存在 admin 浏览器 LocalStorage, 永远不进入 GitHub 仓库.
//   - PAT 仅 admin 自己持有, 用于直接修改 site repo 的 JSON 文件.
//   - PAT 丢失 (浏览器被偷) 风险: 入侵者能改本仓库. 建议:
//       1. 用最小权限: scope 仅 "repo" (或更细 contents:write)
//       2. 设置 expiration (例 90 天)
//       3. 怀疑泄漏立即去 https://github.com/settings/tokens 撤销

const REPO_OWNER = "caiyunbin";
const REPO_NAME  = "caiyunbin-quant";
const PAT_KEY    = "caiman_github_pat_2026";

function adminGetPAT()       { return localStorage.getItem(PAT_KEY) || ""; }
function adminSetPAT(t)      { localStorage.setItem(PAT_KEY, t.trim()); }
function adminClearPAT()     { localStorage.removeItem(PAT_KEY); }
function adminHasPAT()       { return !!adminGetPAT(); }

// base64 utils (支持中文)
function _b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function _b64decode(b) {
    return decodeURIComponent(escape(atob(b.replace(/\n/g, ''))));
}

// 拉远程文件 (返回 { sha, json })
async function ghGetJson(path) {
    const pat = adminGetPAT();
    if (!pat) throw new Error("未配置 PAT");
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const r = await fetch(url, {
        headers: { Authorization: `token ${pat}`, "Accept": "application/vnd.github.v3+json" },
    });
    if (!r.ok) {
        if (r.status === 401) throw new Error("PAT 无效或已过期");
        if (r.status === 404) throw new Error(`文件不存在: ${path}`);
        throw new Error(`GitHub API ${r.status}`);
    }
    const j = await r.json();
    const content = _b64decode(j.content);
    return { sha: j.sha, json: JSON.parse(content) };
}

// 写远程文件 (覆写, 需 sha)
async function ghPutJson(path, data, sha, msg) {
    const pat = adminGetPAT();
    if (!pat) throw new Error("未配置 PAT");
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const content = _b64encode(JSON.stringify(data, null, 2));
    const r = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `token ${pat}`,
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: msg, content: content, sha: sha }),
    });
    if (!r.ok) {
        const t = await r.text();
        throw new Error(`GitHub PUT ${r.status}: ${t.slice(0, 200)}`);
    }
    return r.json();
}

// 测试 PAT 可用性
async function adminTestPAT() {
    try {
        await ghGetJson("data/auth_pool.json");
        return { ok: true };
    } catch (e) {
        return { ok: false, msg: e.message };
    }
}

// === 业务: 切换某 user 的 ETF 可见性 ===
// hashPrefix 是 admin_meta 中显示的 12 位前缀
async function adminToggleEtf(hashPrefix, newValue) {
    // 1. 改 auth_pool.json
    const poolFile = await ghGetJson("data/auth_pool.json");
    const fullToken = Object.keys(poolFile.json.etf_prefs || {}).find(k => k.startsWith(hashPrefix));
    if (!fullToken) throw new Error(`未找到 token: ${hashPrefix}`);
    poolFile.json.etf_prefs[fullToken] = !!newValue;
    poolFile.json.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await ghPutJson("data/auth_pool.json", poolFile.json, poolFile.sha,
                    `admin: toggle ETF=${newValue} for ${hashPrefix}`);

    // 2. 改 admin_meta.json (UI 一致性)
    try {
        const metaFile = await ghGetJson("data/admin_meta.json");
        for (const acc of metaFile.json.accounts || []) {
            if (acc.hash_prefix === hashPrefix) {
                acc.etf_visible = !!newValue;
                break;
            }
        }
        metaFile.json.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await ghPutJson("data/admin_meta.json", metaFile.json, metaFile.sha,
                        `admin: toggle ETF=${newValue} for ${hashPrefix} (meta)`);
    } catch (e) {
        console.warn("admin_meta 更新失败 (不影响功能):", e.message);
    }
    return true;
}

// === 业务: 批量设置所有 user 的 ETF ===
async function adminBatchEtf(newValue) {
    const poolFile = await ghGetJson("data/auth_pool.json");
    const roles = poolFile.json.roles || {};
    let cnt = 0;
    for (const token of Object.keys(poolFile.json.etf_prefs || {})) {
        if (roles[token] !== "admin") {   // admin 不动
            poolFile.json.etf_prefs[token] = !!newValue;
            cnt++;
        }
    }
    poolFile.json.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await ghPutJson("data/auth_pool.json", poolFile.json, poolFile.sha,
                    `admin: batch ETF=${newValue} (${cnt} users)`);

    // admin_meta 同步
    try {
        const metaFile = await ghGetJson("data/admin_meta.json");
        for (const acc of metaFile.json.accounts || []) {
            if (acc.role === "user") acc.etf_visible = !!newValue;
        }
        await ghPutJson("data/admin_meta.json", metaFile.json, metaFile.sha,
                        `admin: batch ETF=${newValue} (${cnt} users, meta)`);
    } catch (e) {}
    return cnt;
}

// === 业务: 改管理员账号/密码 ===
async function adminChangeAccount(newUser, newPwd) {
    if (!newPwd || newPwd.length < 8) throw new Error("新密码至少 8 位");
    const cur = getAuthInfo();
    if (!cur || cur.role !== "admin") throw new Error("当前未以 admin 身份登录");

    // 1. 拉 auth_pool
    const poolFile = await ghGetJson("data/auth_pool.json");
    const pool = poolFile.json;

    // 找到当前 admin 的旧 token (用 LocalStorage 的 token 前缀匹配)
    const oldToken = Object.keys(pool.tokens).find(k => k.startsWith(cur.token));
    if (!oldToken) throw new Error("找不到当前 admin token, 可能已被其他设备改动");
    const oldExpire = pool.tokens[oldToken];

    // 计算新 token
    const finalUser = (newUser || cur.user).trim();
    const newToken = await _sha256(finalUser + ":" + newPwd);

    // 替换 auth_pool 三处: tokens / roles / etf_prefs
    delete pool.tokens[oldToken];
    delete pool.roles[oldToken];
    if (pool.etf_prefs) delete pool.etf_prefs[oldToken];

    pool.tokens[newToken] = oldExpire;
    pool.roles[newToken]  = "admin";
    if (pool.etf_prefs) pool.etf_prefs[newToken] = true;
    pool.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await ghPutJson("data/auth_pool.json", pool, poolFile.sha,
                    `admin: change account ${cur.user} → ${finalUser}`);

    // 2. admin_meta 同步 hash_prefix
    try {
        const metaFile = await ghGetJson("data/admin_meta.json");
        for (const acc of metaFile.json.accounts || []) {
            if (acc.role === "admin" && acc.active) {
                acc.hash_prefix = newToken.slice(0, 12);
                break;
            }
        }
        await ghPutJson("data/admin_meta.json", metaFile.json, metaFile.sha,
                        `admin: change account ${finalUser} (meta)`);
    } catch (e) {}

    // 3. 更新本地 LocalStorage 让 admin 继续无感登录
    localStorage.setItem("caiman_auth_2026", JSON.stringify({
        ts: Date.now(),
        token: newToken.slice(0, 12),
        user: finalUser,
        role: "admin",
        expire: oldExpire,
        device: cur.device,
    }));

    return { user: finalUser, expire: oldExpire };
}

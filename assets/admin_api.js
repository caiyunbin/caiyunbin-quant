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

// === 业务: 账号续期 (延长 N 天 - 在原到期日基础上加, 已过期则从今天算) ===
async function adminExtendAccount(hashPrefix, days) {
    if (!days || days <= 0) throw new Error("续期天数必须 > 0");

    // 1. 拉 auth_pool
    const poolFile = await ghGetJson("data/auth_pool.json");
    const pool = poolFile.json;
    const fullToken = Object.keys(pool.tokens || {}).find(k => k.startsWith(hashPrefix));

    // 2. 拉 admin_meta 找到对应 account
    const metaFile = await ghGetJson("data/admin_meta.json");
    const acc = (metaFile.json.accounts || []).find(a => a.hash_prefix === hashPrefix);
    if (!acc) throw new Error(`未找到账号 ${hashPrefix}`);

    // 3. 计算新 expire (在原到期日基础上加; 如已过期, 从今天算)
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const oldExpire = acc.expire;
    let baseDate = (oldExpire >= todayStr) ? new Date(oldExpire) : today;
    const newDate = new Date(baseDate.getTime() + days * 86400000);
    const newExpire = newDate.toISOString().slice(0, 10);

    // 4. 改 admin_meta (恢复 active, 清掉 revoked)
    acc.expire   = newExpire;
    acc.revoked  = false;
    acc.active   = true;
    metaFile.json.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    // 重算 n_active/n_expired (UI 顶部统计)
    const todayStr2 = todayStr;
    let n_active = 0, n_expired = 0, n_revoked = 0;
    for (const a of metaFile.json.accounts || []) {
        if (a.revoked) { n_revoked++; continue; }
        if (a.expire < todayStr2) n_expired++;
        else n_active++;
    }
    metaFile.json.n_active  = n_active;
    metaFile.json.n_expired = n_expired;
    metaFile.json.n_revoked = n_revoked;

    // 5. 改 auth_pool — 如果该 token 之前已过期/被撤销, pool.tokens 里不在, 需要回填
    //    full token 必须存在 (要 hash 完整版); 如果没有, 从 admin_creds.enc 取
    if (fullToken) {
        pool.tokens[fullToken] = newExpire;
        // roles 和 etf_prefs 如果之前清了, 也要回填
        if (!pool.roles[fullToken])     pool.roles[fullToken] = acc.role || "user";
        if (pool.etf_prefs && pool.etf_prefs[fullToken] === undefined) {
            pool.etf_prefs[fullToken] = (acc.role === "admin") ? true : !!acc.etf_visible;
        }
    } else {
        // token 不在 pool — 之前已 expired/revoked 被 sync 清掉.
        // 需要从 admin_creds.enc 解出明文重算 token. 但 admin_creds.enc 也是按 active 过滤的,
        // 所以已过期账号是没法纯前端恢复 token 的. 给提示让 admin 跑 manage_accounts.py extend
        throw new Error(
            `账号 ${hashPrefix} 已过期较久, token 不在 auth_pool 中.\n` +
            `请在本机跑: python v26_production/manage_accounts.py extend <user> --days ${days}`
        );
    }
    pool.n_active = n_active;
    pool.generated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // 6. push 两个文件
    await ghPutJson("data/auth_pool.json", pool, poolFile.sha,
                    `admin: extend ${hashPrefix} +${days}d → ${newExpire}`);
    await ghPutJson("data/admin_meta.json", metaFile.json, metaFile.sha,
                    `admin: extend ${hashPrefix} +${days}d → ${newExpire} (meta)`);

    return { hash_prefix: hashPrefix, old_expire: oldExpire, new_expire: newExpire, days };
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

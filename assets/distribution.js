// ============================================================
// 账号分发管理 — 接收人/备注/已分发状态 (LocalStorage)
// 卡片生成 (Canvas → PNG)
// 组级复制 / CSV 导出
// ============================================================
const NOTES_KEY = "caiman_acc_notes_2026";
// ⭐ 国内可访问的 Cloudflare 镜像 (主用)
const SITE_URL = "https://caiyunbin-quant.caiyunbinlihai.workers.dev/";
// GitHub Pages 原站 (海外备用)
const SITE_URL_GITHUB = "https://caiyunbin.github.io/caiyunbin-quant/";

function loadAccNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); }
    catch (e) { return {}; }
}
function saveAccNotes(d) { localStorage.setItem(NOTES_KEY, JSON.stringify(d)); }

function getNote(hashPrefix) {
    return loadAccNotes()[hashPrefix] || null;
}
function setNote(hashPrefix, data) {
    const all = loadAccNotes();
    all[hashPrefix] = { ...all[hashPrefix], ...data, updated_at: new Date().toISOString() };
    saveAccNotes(all);
}
function clearNote(hashPrefix) {
    const all = loadAccNotes();
    delete all[hashPrefix];
    saveAccNotes(all);
}
function markDistributed(hashPrefix, recipient) {
    setNote(hashPrefix, {
        recipient: recipient,
        distributed: true,
        distributed_at: new Date().toISOString(),
    });
}
function markNotDistributed(hashPrefix) {
    const all = loadAccNotes();
    if (all[hashPrefix]) {
        all[hashPrefix].distributed = false;
        delete all[hashPrefix].distributed_at;
        saveAccNotes(all);
    }
}

// ============================================================
// 格式化复制内容 (单个/批量)
// ============================================================
function formatCredential(user, pwd, expire) {
    return `账号:${user}
密码:${pwd}
网址:${SITE_URL}
有效期至:${expire}`;
}

function formatCredentialList(rows) {
    // 批量复制: 每个账号一段, 中间分隔线
    return rows.map((r, i) =>
        `═══ 账号 ${i + 1} ═══
账号:${r.user}
密码:${r.password}
网址:${SITE_URL}
有效期至:${r.expire}`
    ).join('\n\n');
}

// CSV 导出
function generateCSV(rows) {
    const header = "账号,密码,网址,到期日,备注,接收人,已分发,创建日";
    const lines = rows.map(r => {
        const note = getNote(r.hash_prefix) || {};
        return [
            r.user, r.password, SITE_URL, r.expire,
            (note.note || '').replace(/,/g, ' '),
            (note.recipient || '').replace(/,/g, ' '),
            note.distributed ? '是' : '否',
            r.created || '-',
        ].map(x => `"${x || ''}"`).join(',');
    });
    return header + '\n' + lines.join('\n');
}

function downloadCSV(filename, csvContent) {
    const BOM = '﻿';   // Excel UTF-8 BOM
    const blob = new Blob([BOM + csvContent], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// 单人卡片生成 (Canvas → PNG)
// ============================================================
async function generateCredCard(user, pwd, expire, opts = {}) {
    const W = 720, H = 420;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景渐变
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#4f46e5');
    grad.addColorStop(1, '#7c3aed');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 白色卡片
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, 24, 24, W - 48, H - 48, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 标题
    ctx.fillStyle = '#4f46e5';
    ctx.font = 'bold 26px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('🚀 多子策略决策引擎', 48, 76);

    ctx.fillStyle = '#6b7280';
    ctx.font = '14px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('A 股每日量化信号 · 仅限授权账号访问', 48, 100);

    // 分隔线
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(48, 120); ctx.lineTo(W - 48, 120); ctx.stroke();

    // 账号信息
    ctx.fillStyle = '#1f2937';
    ctx.font = '15px -apple-system, sans-serif';
    ctx.fillText('账号', 48, 158);
    ctx.fillStyle = '#4f46e5';
    ctx.font = 'bold 28px Menlo, Monaco, monospace';
    ctx.fillText(user, 48, 192);

    ctx.fillStyle = '#1f2937';
    ctx.font = '15px -apple-system, sans-serif';
    ctx.fillText('密码', 48, 232);
    ctx.fillStyle = '#4f46e5';
    ctx.font = 'bold 28px Menlo, Monaco, monospace';
    ctx.fillText(pwd, 48, 266);

    // 网址
    ctx.fillStyle = '#1f2937';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText('网址', 48, 302);
    ctx.fillStyle = '#374151';
    ctx.font = '16px Menlo, monospace';
    ctx.fillText(SITE_URL, 48, 324);

    // 有效期
    ctx.fillStyle = '#dc2626';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.fillText('有效期至:' + expire, 48, 358);

    // 底部提示
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText('⚠ 一个账号最多 2 个设备登录 · 请勿转发 · 内容仅供研究参考', 48, 384);

    return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function downloadCredCard(user, pwd, expire) {
    const canvas = await generateCredCard(user, pwd, expire);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `登录卡_${user}.png`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
}

// ============================================================
// 分发统计
// ============================================================
function getDistributionStats(accounts) {
    let total = 0, distributed = 0, expired = 0, revoked = 0, withNote = 0;
    for (const a of accounts) {
        if (a.role === 'admin') continue;
        total++;
        if (a.revoked) { revoked++; continue; }
        if (!a.active) { expired++; continue; }
        const note = getNote(a.hash_prefix);
        if (note?.distributed) distributed++;
        if (note?.note || note?.recipient) withNote++;
    }
    return {
        total, distributed,
        not_distributed: total - distributed - expired - revoked,
        expired, revoked, with_note: withNote,
    };
}

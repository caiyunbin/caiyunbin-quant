// ============================================================
// paywall.js — 付费墙前端共享模块
// 提供: 鉴权状态 / 取数(preview vs full) / 锁定遮罩 / 解锁弹窗 / 顶部用户条
// ============================================================
const PW_API = "/api";
// 子目录 (/strategies/) 资源要回退一级
const PW_BASE = location.pathname.includes("/strategies/") ? "../" : "";
const PW_TIERS = [
  { tier: "month",   name: "月卡", days: 30,  price: 99  },
  { tier: "quarter", name: "季卡", days: 90,  price: 266 },
  { tier: "year",    name: "年卡", days: 360, price: 799 },
];
// ⚠️ 收款码图片: 上传到 assets/pay_qr.png (微信/支付宝个人收款码)
const PW_QR = PW_BASE + "assets/pay_qr.png";
const PW_CONTACT = "客服微信: caiman_quant";  // 改成你的联系方式

async function pwGet(path) {
  const r = await fetch(PW_API + path, { credentials: "include" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
async function pwPost(path, body) {
  const r = await fetch(PW_API + path, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || r.status);
  return d;
}

// 取登录状态
async function pwMe() {
  try { return await pwGet("/me"); } catch (e) { return { logged_in: false }; }
}

// 取信号数据: 付费→全量, 否则→打码预览
async function pwSignals(me) {
  if (me && me.is_paid) {
    try { return { data: await pwGet("/signals"), locked: false }; } catch (e) {}
  }
  return { data: await pwGet("/preview"), locked: true };
}

// 取事件数据
async function pwEvents(me) {
  if (me && me.is_paid) {
    try { return { data: await pwGet("/events"), locked: false }; } catch (e) {}
  }
  return { data: await pwGet("/events/preview"), locked: true };
}

// 锁定卡片 (替代被遮的信号明细)
function pwLockCard(opts) {
  const { title = "🔒 完整信号已锁定", counts = [], sub = "" } = opts || {};
  const chips = counts.filter(c => c.n > 0).map(c =>
    `<span style="display:inline-block;background:#1e293b;color:#cbd5e1;border:1px solid #334155;
      border-radius:999px;padding:3px 12px;font-size:12px;margin:3px">${c.label} <b style="color:#fbbf24">${c.n}</b></span>`
  ).join("");
  return `<div style="background:linear-gradient(135deg,#0f172a,#1e1b4b);border:1px solid #334155;
      border-radius:14px;padding:26px 20px;text-align:center;color:#e2e8f0">
    <div style="font-size:30px;margin-bottom:6px">🔒</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">${title}</div>
    ${sub ? `<div style="font-size:12.5px;color:#94a3b8;margin-bottom:12px">${sub}</div>` : ""}
    <div style="margin:10px 0 16px">${chips || '<span style="color:#94a3b8;font-size:12px">今日数据已生成</span>'}</div>
    <button onclick="pwUnlock()" style="background:linear-gradient(135deg,#d4af37,#b8860b);color:#1a1407;
      font-weight:700;border:none;border-radius:10px;padding:11px 28px;font-size:14px;cursor:pointer;
      box-shadow:0 8px 20px rgba(212,175,55,.3)">付费解锁全部</button>
  </div>`;
}

// 解锁弹窗 (收款码 + 三档)
function pwUnlock() {
  if (document.getElementById("pw-modal")) return;
  const tiers = PW_TIERS.map(t =>
    `<div style="flex:1;background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:13px;color:#cbd5e1">${t.name}</div>
      <div style="font-size:22px;font-weight:800;color:#fbbf24">¥${t.price}</div>
      <div style="font-size:11px;color:#64748b">${t.days} 天</div>
    </div>`).join("");
  const html = `<div id="pw-modal" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)pwCloseModal()">
    <div style="background:#1e293b;border:1px solid #334155;border-radius:18px;max-width:380px;width:100%;
        padding:28px 24px;color:#e2e8f0;text-align:center">
      <div style="font-size:18px;font-weight:800;margin-bottom:4px">解锁全部信号</div>
      <div style="font-size:12.5px;color:#94a3b8;margin-bottom:16px">每日策略信号 · 持仓 · 事件明细 · 脉络分析</div>
      <div style="display:flex;gap:8px;margin-bottom:18px">${tiers}</div>
      <div style="background:#fff;border-radius:12px;padding:12px;display:inline-block;margin-bottom:12px">
        <img src="${PW_QR}" style="width:200px;height:200px;object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div style="display:none;width:200px;height:200px;line-height:200px;color:#888;font-size:13px">收款码待上传<br>assets/pay_qr.png</div>
      </div>
      <div style="font-size:12.5px;color:#cbd5e1;line-height:1.7">
        扫码付款，<b style="color:#fbbf24">备注填你的注册邮箱</b><br>
        付款后截图发 ${PW_CONTACT}<br>
        <span style="color:#64748b">开通后刷新页面即解锁</span>
      </div>
      <button onclick="pwCloseModal()" style="margin-top:16px;background:#334155;color:#e2e8f0;border:none;
        border-radius:9px;padding:8px 22px;font-size:13px;cursor:pointer">关闭</button>
    </div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}
function pwCloseModal() { const m = document.getElementById("pw-modal"); if (m) m.remove(); }

// 顶部用户条 (右上角): 登录态 + 会员 + 退出
async function pwUserBar(me) {
  me = me || await pwMe();
  let inner;
  if (!me.logged_in) {
    inner = `<a href="login.html?next=${encodeURIComponent(location.pathname.split('/').pop())}"
      style="color:#fbbf24;text-decoration:none;font-weight:600">登录 / 注册</a>`;
  } else {
    const vip = me.is_paid
      ? `<span style="color:#34d399">★ 会员 · 剩 ${me.days_left} 天</span>`
      : `<a href="javascript:pwUnlock()" style="color:#fbbf24;text-decoration:none">未开通 · 解锁</a>`;
    inner = `<span style="color:#94a3b8">${me.email}</span> &nbsp;${vip}
      &nbsp;<a href="javascript:pwLogout()" style="color:#64748b;text-decoration:none">退出</a>`;
  }
  const bar = document.createElement("div");
  bar.id = "pw-userbar";
  bar.style.cssText = "position:fixed;top:0;right:0;z-index:900;background:rgba(15,23,42,.9);" +
    "backdrop-filter:blur(8px);border-bottom-left-radius:10px;border:1px solid #1e293b;" +
    "padding:7px 14px;font-size:12.5px;color:#e2e8f0";
  bar.innerHTML = inner;
  const old = document.getElementById("pw-userbar"); if (old) old.remove();
  document.body.appendChild(bar);
}
async function pwLogout() { try { await pwPost("/logout"); } catch (e) {} location.reload(); }

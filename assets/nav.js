// 共用导航栏 — 支持 admin 角色 + ETF 可见性开关
async function renderNav(isSubdir) {
    const prefix = isSubdir ? "../" : "";
    const auth = getAuthInfo();
    const showAdmin = auth && auth.role === "admin";
    // per-user ETF 开关 (admin 总能看, user 看自己的 etf_visible)
    const showEtf = await isEtfVisibleForCurrentUser();

    const etfLink = showEtf
        ? `<a href="${prefix}strategies/etf.html" class="nav-strat-btn"><span class="label-2x2">板块轮动</span></a>`
        : '';
    const adminLink = showAdmin
        ? `<a href="${prefix}admin.html" class="nav-strat-btn text-orange-600 font-bold hover:bg-orange-50"><span class="label-2x2">管理后台</span></a>`
        : '';
    const userBadge = auth
        ? `<span class="hidden md:inline text-xs text-gray-400">${auth.role === 'admin' ? '👑' : '👤'} ${auth.user}</span>`
        : '';

    const html = `
<nav class="bg-white shadow-sm sticky top-0 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16 md:h-20">
            <div class="flex items-center">
                <a href="${prefix}index.html" class="text-base sm:text-xl font-bold text-indigo-600 whitespace-nowrap">🚀 多子策略决策引擎</a>
            </div>
            <div class="nav-desktop items-center space-x-2">
                <a href="${prefix}index.html" class="nav-strat-btn"><span class="label-2x2">总览首页</span></a>
                <a href="${prefix}signals.html" class="nav-strat-btn text-indigo-600 font-bold hover:bg-indigo-50"><span class="label-2x2">今日信号</span></a>
                <a href="${prefix}strategies/small_cap.html"     class="nav-strat-btn"><span class="label-2x2">小盘动量</span></a>
                <a href="${prefix}strategies/large_cap.html"     class="nav-strat-btn"><span class="label-2x2">大盘突破</span></a>
                <a href="${prefix}strategies/consolidation.html" class="nav-strat-btn"><span class="label-2x2">上涨横盘</span></a>
                ${etfLink}
                ${adminLink}
                ${userBadge}
                <a href="javascript:logout()" class="text-gray-500 hover:text-red-600 px-3 py-2 rounded-md text-sm">退出</a>
            </div>
            <button id="mobile-menu-btn" class="nav-mobile p-2 text-gray-600" aria-label="菜单">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
        </div>
    </div>
</nav>
<div id="mobile-menu-overlay" class="mobile-menu-overlay"></div>
<aside id="mobile-menu" class="mobile-menu">
    <div class="p-5 border-b">
        <div class="text-lg font-bold text-indigo-700">🚀 多子策略</div>
        <div class="text-xs text-gray-500 mt-1">${auth ? (auth.role==='admin'?'👑 ':'👤 ')+auth.user : '未登录'}</div>
    </div>
    <nav class="p-3 space-y-1">
        <a href="${prefix}index.html" class="block px-4 py-3 rounded text-gray-700 hover:bg-indigo-50">📊 总览</a>
        <a href="${prefix}signals.html" class="block px-4 py-3 rounded text-indigo-700 font-bold bg-indigo-50">⭐ 今日信号</a>
        <a href="${prefix}strategies/small_cap.html"     class="block px-4 py-3 rounded text-gray-700 hover:bg-indigo-50">🎯 小盘动量</a>
        <a href="${prefix}strategies/large_cap.html"     class="block px-4 py-3 rounded text-gray-700 hover:bg-indigo-50">🏛️ 大盘突破</a>
        <a href="${prefix}strategies/consolidation.html" class="block px-4 py-3 rounded text-gray-700 hover:bg-indigo-50">📈 上涨横盘</a>
        ${showEtf ? `<a href="${prefix}strategies/etf.html" class="block px-4 py-3 rounded text-gray-700 hover:bg-indigo-50">🏦 板块轮动</a>` : ''}
        ${showAdmin ? `<a href="${prefix}admin.html" class="block px-4 py-3 rounded text-orange-600 font-bold hover:bg-orange-50">⚙️ 管理后台</a>` : ''}
        <div class="border-t mt-3 pt-3">
            <a href="javascript:logout()" class="block px-4 py-3 rounded text-red-500 hover:bg-red-50">↪ 退出登录</a>
        </div>
    </nav>
</aside>`;

    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.insertBefore(div, document.body.firstChild);

    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    const overlay = document.getElementById('mobile-menu-overlay');
    const close = () => { menu.classList.remove('open'); overlay.classList.remove('open'); };
    btn?.addEventListener('click', () => { menu.classList.add('open'); overlay.classList.add('open'); });
    overlay?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // 触发合规弹窗 (仅用户身份)
    if (auth && auth.role === "user") {
        setTimeout(() => {
            if (typeof showComplianceModalIfNeeded === 'function') showComplianceModalIfNeeded();
        }, 200);
    }
}

function renderFooter() {
    const html = `
<footer class="bg-white border-t border-gray-200 mt-12">
    <div class="max-w-7xl mx-auto py-4 px-4 text-center">
        <p class="text-xs text-gray-400">⚠ 风险提示: 本网站展示内容仅供本人量化研究参考, 不构成任何投资建议或收益承诺. 证券市场有风险, 投资需谨慎.</p>
        <p class="text-xs text-gray-300 mt-1">&copy; 2026 多子策略决策引擎</p>
    </div>
</footer>`;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
}

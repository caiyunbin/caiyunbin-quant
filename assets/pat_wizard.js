// ============================================================
// PAT 配置向导 (Admin 第一次进入时强制弹出, 5 步搞定)
// ============================================================
async function showPATWizardIfNeeded() {
    if (adminHasPAT()) {
        // 静默测试一次, 失败就强制配置
        const r = await adminTestPAT();
        if (r.ok) return;   // 已配且可用, 不打扰
        adminClearPAT();    // 失效, 强制重新配
    }
    showPATWizard();
}

function showPATWizard() {
    const wrap = document.createElement('div');
    wrap.id = 'pat-wizard';
    wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;";
    wrap.innerHTML = `
    <div class="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[95vh] overflow-y-auto">
        <div class="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6 rounded-t-lg">
            <h2 class="text-2xl font-bold mb-1">⚙️ 首次配置向导 — PAT</h2>
            <p class="text-sm">配置一次, 之后永久免操作. 大约 1 分钟.</p>
        </div>

        <div class="p-6 space-y-5">
            <div class="bg-blue-50 border-l-4 border-blue-400 p-3 text-sm text-blue-900">
                <strong>为什么需要 PAT?</strong><br>
                网页要修改 GitHub 上的账号文件 (撤销账号 / 改密码 / 切换 ETF 等), 必须有 PAT 当作"钥匙". PAT 只存在你这个浏览器, 不进 GitHub 仓库, 不外传.
            </div>

            <!-- 步骤 1 -->
            <div class="border rounded-lg p-4">
                <h3 class="font-bold text-base mb-2">
                    <span class="inline-block bg-orange-500 text-white rounded-full w-6 h-6 text-center text-sm leading-6 mr-2">1</span>
                    打开 GitHub 生成 PAT 的页面
                </h3>
                <p class="text-xs text-gray-600 mb-3">点下方按钮, 会在新标签页打开 GitHub. 已预填好 scope (repo) 和描述, 你只需要点 "Generate token" 按钮.</p>
                <button id="wiz-open-gh" class="bg-orange-600 text-white px-5 py-2.5 rounded font-medium hover:bg-orange-700">
                    🌐 打开 GitHub 生成页 (新标签页)
                </button>
                <p class="text-xs text-gray-500 mt-2">⚠ 如果 GitHub 需要登录, 用 <code class="bg-gray-100 px-1">caiyunbinlihai@163.com</code> 登录.</p>
                <p class="text-xs text-gray-500 mt-1">⚠ Expiration 可选 90 天或更长. Scope 已勾选 <code class="bg-gray-100 px-1">repo</code>, 不需要改.</p>
            </div>

            <!-- 步骤 2 -->
            <div class="border rounded-lg p-4">
                <h3 class="font-bold text-base mb-2">
                    <span class="inline-block bg-orange-500 text-white rounded-full w-6 h-6 text-center text-sm leading-6 mr-2">2</span>
                    复制生成的 PAT
                </h3>
                <p class="text-xs text-gray-600 mb-2">点 "Generate token" 后, GitHub 会显示一串以 <code class="bg-gray-100 px-1">ghp_</code> 开头的字符串. 这就是 PAT.</p>
                <p class="text-xs text-red-600 font-bold">⚠ PAT 只显示一次, 立即复制! 关掉就再也看不到了 (但能重新生成).</p>
            </div>

            <!-- 步骤 3 -->
            <div class="border rounded-lg p-4">
                <h3 class="font-bold text-base mb-2">
                    <span class="inline-block bg-orange-500 text-white rounded-full w-6 h-6 text-center text-sm leading-6 mr-2">3</span>
                    粘贴到这里 + 自动测试
                </h3>
                <input type="password" id="wiz-pat-input"
                       class="w-full px-4 py-3 border border-gray-300 rounded-md font-mono text-sm"
                       placeholder="粘贴 PAT (以 ghp_ 开头)">
                <div class="mt-3 flex gap-2">
                    <button id="wiz-save" class="flex-1 bg-green-600 text-white px-5 py-3 rounded font-bold hover:bg-green-700">
                        💾 保存并测试
                    </button>
                    <button id="wiz-skip" class="bg-gray-200 text-gray-700 px-4 py-3 rounded text-sm">稍后再说</button>
                </div>
                <p id="wiz-status" class="text-sm mt-3"></p>
            </div>

            <!-- 帮助 -->
            <details class="text-xs text-gray-500">
                <summary class="cursor-pointer hover:text-gray-700">❓ 遇到问题?</summary>
                <div class="mt-2 space-y-1 pl-3">
                    <p>• PAT 测试失败 → 检查 scope 是否包含 <code>repo</code></p>
                    <p>• "未授权" → 确认你登录的是 caiyunbin 这个 GitHub 账号</p>
                    <p>• 不想用 PAT → 点 "稍后再说", 改用 CLI 命令操作 (但每次需手动跑)</p>
                    <p>• 想撤销 PAT → 去 <a href="https://github.com/settings/tokens" target="_blank" class="text-blue-600 underline">GitHub Tokens 设置</a></p>
                </div>
            </details>
        </div>
    </div>`;

    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    // 打开 GitHub 生成页
    document.getElementById('wiz-open-gh').addEventListener('click', () => {
        const url = "https://github.com/settings/tokens/new?scopes=repo&description=" +
                    encodeURIComponent("caiyunbin-quant admin 后台 (本浏览器仅)");
        window.open(url, '_blank');
    });

    // 跳过
    document.getElementById('wiz-skip').addEventListener('click', () => {
        if (!confirm("跳过后: ETF 开关 / 改密码等功能将无法即时生效, 需要走 CLI 命令.\n确定跳过?")) return;
        wrap.remove();
        document.body.style.overflow = '';
    });

    // 保存 + 测试
    document.getElementById('wiz-save').addEventListener('click', async () => {
        const $input = document.getElementById('wiz-pat-input');
        const $status = document.getElementById('wiz-status');
        const pat = $input.value.trim();
        if (!pat) {
            $status.innerHTML = '<span class="text-red-600">⚠ 请先粘贴 PAT</span>';
            return;
        }
        if (!pat.startsWith('ghp_') && !pat.startsWith('github_pat_')) {
            if (!confirm("这个 PAT 格式看着不像 GitHub 的 (一般 ghp_ 开头). 继续保存吗?")) return;
        }
        $status.innerHTML = '<span class="text-blue-600">⏳ 保存 + 测试中...</span>';
        adminSetPAT(pat);
        const r = await adminTestPAT();
        if (r.ok) {
            $status.innerHTML = '<span class="text-green-600 font-bold">✅ 配置成功! 3 秒后自动关闭...</span>';
            setTimeout(() => {
                wrap.remove();
                document.body.style.overflow = '';
                // 通知页面其他模块刷新 (改密码按钮启用 etc)
                if (typeof updateChangeCredUI === 'function') updateChangeCredUI();
            }, 3000);
        } else {
            $status.innerHTML = '<span class="text-red-600">❌ ' + r.msg + '<br>请检查 PAT 是否正确, 或 scope 是否包含 <code>repo</code></span>';
            adminClearPAT();
        }
    });

    // 粘贴自动 trim
    document.getElementById('wiz-pat-input').addEventListener('paste', (e) => {
        setTimeout(() => {
            const v = e.target.value.trim();
            e.target.value = v;
        }, 50);
    });
}

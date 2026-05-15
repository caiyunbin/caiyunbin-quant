// ============================================================
// 用户首次登录合规弹窗 (大模态框, 必须勾选才能关闭)
// ============================================================
function showComplianceModalIfNeeded() {
    if (hasAcceptedCompliance()) return;
    // 创建模态
    const wrap = document.createElement('div');
    wrap.id = 'compliance-modal';
    wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;";
    wrap.innerHTML = `
    <div class="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8">
        <h2 class="text-xl sm:text-2xl font-bold text-red-700 mb-3">⚠️ 合规协议 · 必读</h2>
        <p class="text-sm text-gray-600 mb-4">首次使用本网站前, 请仔细阅读以下内容并勾选"我已阅读并同意":</p>

        <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded text-xs text-red-900 space-y-2 leading-relaxed">
            <p><strong>1. 仅供研究参考</strong>: 本网站所展示的策略数据、信号、净值曲线、推荐操作建议等内容,
                均为本人量化研究的统计结果, 仅供研究参考与个人学习交流使用,
                <strong>不构成任何形式的投资建议、保荐意见或收益承诺</strong>.</p>
            <p><strong>2. 不构成委托关系</strong>: 本网站不向任何用户提供投资咨询、资产管理、代客理财服务,
                不接受任何形式的投资委托. 用户与本网站之间<strong>不存在投资顾问关系</strong>.</p>
            <p><strong>3. 历史业绩不代表未来</strong>: 网站展示的回测净值与年化收益均为
                <strong>历史模拟数据</strong>, 受幸存者偏差、滑点假设、容量约束等多重因素影响,
                实盘表现可能<strong>显著低于</strong>历史回测结果.</p>
            <p><strong>4. 投资风险自负</strong>: 用户基于本网站任何内容做出的投资决策,
                由用户<strong>独立判断并自行承担风险</strong>, 包括但不限于本金亏损、流动性风险、市场风险、政策风险.
                本网站<strong>不对任何投资亏损负责</strong>.</p>
            <p><strong>5. 适当性原则</strong>: 证券投资有风险, 用户应根据自身的财务状况、投资经验、风险承受能力,
                结合专业顾问意见独立做出投资决策. <strong>不具备风险承受能力的用户,
                请勿基于本网站内容进行任何投资操作</strong>.</p>
            <p><strong>6. 数据准确性</strong>: 本网站数据来源于第三方接口 (Tushare),
                不保证数据的实时性、准确性、完整性. 因数据错误或延迟导致的任何损失, 本网站<strong>不承担任何责任</strong>.</p>
            <p><strong>7. 用户使用规范</strong>: 用户不得将本网站内容用于商业用途, 不得对本网站进行逆向工程、爬取、
                批量复制, 不得将账号、密码转借他人. 违反者可能导致账号被立即撤销.</p>
            <p><strong>8. 中国大陆证券合规</strong>: 本网站不为任何用户提供证券投资咨询业务,
                不发布证券投资分析意见. 本网站不属于<strong>《证券投资顾问业务暂行规定》</strong>所涵盖的证券投资顾问服务.
                用户应自觉遵守中国大陆相关法律法规, 包括但不限于《证券法》《证券投资基金法》《证券投资顾问业务暂行规定》.</p>
        </div>

        <div class="mt-5 space-y-3">
            <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="cb-read" class="mt-1 h-5 w-5 accent-indigo-600">
                <span class="text-sm text-gray-800">我已<strong>完整阅读</strong>上述全部条款</span>
            </label>
            <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="cb-understand" class="mt-1 h-5 w-5 accent-indigo-600">
                <span class="text-sm text-gray-800">我<strong>充分理解</strong>本网站不构成投资建议, 投资风险由我独立承担</span>
            </label>
            <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="cb-agree" class="mt-1 h-5 w-5 accent-indigo-600">
                <span class="text-sm text-gray-800">我<strong>自愿同意</strong>所有条款并承担一切相关责任</span>
            </label>
        </div>

        <div class="flex gap-3 mt-6">
            <button id="cb-reject" class="flex-1 bg-gray-200 text-gray-700 py-3 rounded font-medium hover:bg-gray-300">不同意并退出</button>
            <button id="cb-accept" class="flex-1 bg-indigo-600 text-white py-3 rounded font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed" disabled>同意并继续</button>
        </div>
    </div>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    const $read = document.getElementById('cb-read');
    const $und  = document.getElementById('cb-understand');
    const $ag   = document.getElementById('cb-agree');
    const $accept = document.getElementById('cb-accept');
    const $reject = document.getElementById('cb-reject');
    const sync = () => { $accept.disabled = !($read.checked && $und.checked && $ag.checked); };
    [$read, $und, $ag].forEach(x => x.addEventListener('change', sync));
    $accept.addEventListener('click', () => {
        acceptCompliance();
        wrap.remove();
        document.body.style.overflow = '';
    });
    $reject.addEventListener('click', () => {
        logout();
    });
}

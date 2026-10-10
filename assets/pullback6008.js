function pullbackScanInfo(research) {
  const scan = research?.daily_scan || {};
  const status = scan.status || 'not_loaded';
  const ready = status === 'ok' || status === 'ok_with_gaps';
  const labels = {
    market_closed: '休市，不生成当日候选',
    data_unavailable: '行情数据未就绪，候选待确认',
    ok: '扫描已完成',
    ok_with_gaps: '扫描已完成，部分行情缺失',
    not_loaded: '日更状态未加载，候选待确认',
  };
  const suppliedCount = Object.prototype.hasOwnProperty.call(research || {}, 'latest_signals_count')
    ? research.latest_signals_count : scan.signal_count;
  const count = ready && Number.isInteger(suppliedCount) && suppliedCount >= 0 ? suppliedCount : null;
  const label = labels[status] || '扫描状态待确认';
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const historical = !!scan.report_date && scan.report_date !== today;
  const text = [
    historical ? '最近一次扫描（非当日）' : '',
    `报告日期 ${scan.report_date || '-'}`,
    `行情截至 ${scan.data_date || scan.latest_data_date || '-'}`,
    label,
    count == null ? '' : `${count} 个确认候选`,
    scan.note || '',
    scan.generated_at ? `扫描生成 ${scan.generated_at}` : '',
  ].filter(Boolean).join(' · ');
  const emptyMessage = status === 'market_closed'
    ? '市场休市，本报告日不生成候选。'
    : !ready ? '本次扫描未完成，候选数量和明细待确认。'
    : count === 0 ? `${historical ? '该历史扫描' : '本次扫描'}已完成，没有确认候选。`
    : '本次候选明细暂未加载。';
  const emptyLockText = count == null ? '候选数量待确认' : `${historical ? '该历史扫描' : '本次扫描'}已完成`;
  return { status, ready, count, label, text, emptyMessage, emptyLockText, historical };
}

async function loadPullback6008() {
  try { return await pwGet('/pullback6008'); }
  catch (_) {
    const base = location.pathname.includes('/strategies/') ? '../' : '';
    const getPublicJSON = async name => {
      const r = await fetch(`${base}assets/${name}?t=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    const [summary, daily] = await Promise.all([
      getPublicJSON('fixed_strategy_6008.json'),
      getPublicJSON('fixed_strategy_6008_daily_public.json').catch(() => null),
    ]);
    return {
      ...summary,
      daily_scan: daily?.daily_scan ?? summary.daily_scan,
      latest_signals_count: daily ? daily.latest_signals_count : summary.latest_signals_count,
      locked: true,
    };
  }
}

function renderPullbackHistory(research, locked, admin) {
  if (locked) return pwLockCard({
    title: '完整历史信号已锁定', sub: '按日期查看研究历史与后续扫描记录', emptyText: '会员可查看完整历史',
  });
  const esc = value => String(value ?? '-').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
  const pct = value => value == null ? '-' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
  const records = new Map();
  for (const s of [...(research?.signals || []), ...(research?.live_signals || [])]) {
    const key = [s['信号日期'], s['股票代码'], s['事件编号'] || ''].join('|');
    records.set(key, s);
  }
  const history = Array.from(records.values()).sort((a, b) =>
    String(b['信号日期'] || '').localeCompare(String(a['信号日期'] || '')) ||
    String(a['股票代码'] || '').localeCompare(String(b['股票代码'] || '')));
  if (!history.length) return '<p class="text-sm text-gray-500">历史信号明细暂未加载。</p>';
  const years = [...new Set(history.map(s => String(s['信号日期'] || '').slice(0, 4)))].filter(Boolean);
  const columns = [
    ['信号日期', '信号日'], ['股票名称', '名称'], ['股票代码', '代码'],
    ['涨停家族', '家族'], ['执行状态', '状态'], ['扣费净收益', '扣费净收益', true],
    ...(admin ? [
      ['末板日期', '末板'], ['低点日期', '低点'], ['回调深度', '回调深度', true],
      ['距末板交易日', '距末板日数'], ['低点后交易日', '低点后日数'], ['反弹幅度', '反弹幅度', true],
    ] : []),
  ];
  const rows = history.map(s => `<tr data-history-year="${esc(String(s['信号日期'] || '').slice(0, 4))}">${columns.map(([field, , percent]) => `<td class="px-3 py-2 whitespace-nowrap ${percent ? 'text-right' : ''}">${percent ? pct(s[field]) : esc(s[field])}</td>`).join('')}</tr>`).join('');
  return `<details class="mt-4"><summary class="cursor-pointer text-sm font-medium text-indigo-700">完整历史信号 (${history.length})</summary><div class="flex items-center flex-wrap gap-3 mt-4"><label class="text-xs text-gray-600">年份 <select class="border border-gray-300 bg-white rounded px-2 py-1 ml-2" onchange="filterPullbackHistory(this)"><option value="">全部年份</option>${years.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join('')}</select></label><span data-history-count class="text-xs text-gray-500">显示 ${history.length} 条</span></div><div class="scroll-x mt-3" style="max-height:480px;overflow:auto"><table class="min-w-full text-xs"><thead class="bg-gray-100 text-gray-500 sticky top-0"><tr>${columns.map(([,label,percent]) => `<th class="px-3 py-2 whitespace-nowrap ${percent ? 'text-right' : 'text-left'}">${label}</th>`).join('')}</tr></thead><tbody class="divide-y">${rows}</tbody></table></div></details>`;
}

function filterPullbackHistory(select) {
  const details = select.closest('details');
  let shown = 0;
  for (const row of details.querySelectorAll('tbody tr')) {
    row.hidden = !!select.value && row.dataset.historyYear !== select.value;
    if (!row.hidden) shown++;
  }
  details.querySelector('[data-history-count]').textContent = `显示 ${shown} 条`;
}

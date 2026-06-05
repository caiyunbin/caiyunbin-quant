/* 交易日K线弹窗 — 共享组件 (各策略页 + 今日信号). 依赖 echarts 已加载.
   用法: window._TRADES[tid]=trade; 行加 onclick="openTradeChart(tid)";
        或直接用 tradeChartLi(trade, tid) 生成可点 <li>. */
(function () {
  if (window.__tradeChartInit) return;
  window.__tradeChartInit = true;
  window._TRADES = window._TRADES || {};
  var _tmChart = null;

  function injectModal() {
    if (document.getElementById('trade-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="trade-modal" style="display:none;position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);">' +
        '<div style="max-width:760px;margin:6vh auto;background:#fff;border-radius:12px;padding:16px 16px 10px;box-shadow:0 10px 40px rgba(0,0,0,.3);">' +
          '<div class="flex justify-between items-start mb-1"><div>' +
            '<h3 id="tm-title" class="text-base sm:text-lg font-bold text-gray-800"></h3>' +
            '<p id="tm-sub" class="text-xs text-gray-500 mt-0.5"></p></div>' +
            '<button id="tm-close" class="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2" aria-label="关闭">×</button>' +
          '</div><div id="tm-chart" style="width:100%;height:380px;"></div>' +
        '</div></div>';
    var modal = wrap.firstElementChild;
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) window.closeTradeChart(); });
    document.getElementById('tm-close').addEventListener('click', window.closeTradeChart);
  }

  window.closeTradeChart = function () {
    var m = document.getElementById('trade-modal');
    if (m) m.style.display = 'none';
    if (_tmChart) { _tmChart.dispose(); _tmChart = null; }
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.closeTradeChart(); });

  window.openTradeChart = function (tid) {
    var t = window._TRADES[tid];
    if (!t || !t.kline || !t.kline.length || typeof echarts === 'undefined') return;
    injectModal();
    document.getElementById('trade-modal').style.display = 'block';
    var ret = ((t.ret || 0) >= 0 ? '+' : '') + ((t.ret || 0) * 100).toFixed(1) + '%';
    var col = (t.ret || 0) >= 0 ? '#16a34a' : '#dc2626';
    document.getElementById('tm-title').innerHTML = t.ts_code + ' <span style="color:' + col + '">' + ret + '</span>';
    document.getElementById('tm-sub').textContent = t.entry_date + ' 买入 → ' + (t.exit_date || '持有中') + ' 卖出 · 持 ' + (t.hold_days || 0) + ' 天 · ' + (t.reason || '');
    var dates = t.kline.map(function (k) { return k[0]; });
    var ohlc = t.kline.map(function (k) { return [k[1], k[4], k[3], k[2]]; }); // [open,close,low,high]
    function closeAt(d) { var i = dates.indexOf(d); return i >= 0 ? t.kline[i][4] : null; }
    var bc = closeAt(t.entry_date), sc = closeAt(t.exit_date), marks = [];
    if (bc != null) marks.push({ coord: [t.entry_date, bc], value: '买', itemStyle: { color: '#16a34a' }, label: { show: true, formatter: '买入', position: 'bottom', color: '#16a34a', fontWeight: 'bold', fontSize: 11 } });
    if (sc != null) marks.push({ coord: [t.exit_date, sc], value: '卖', itemStyle: { color: '#dc2626' }, label: { show: true, formatter: '卖出', position: 'top', color: '#dc2626', fontWeight: 'bold', fontSize: 11 } });
    if (_tmChart) _tmChart.dispose();
    _tmChart = echarts.init(document.getElementById('tm-chart'));
    _tmChart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      grid: { left: 50, right: 18, top: 18, bottom: 52 },
      xAxis: { type: 'category', data: dates, axisLabel: { rotate: 30, fontSize: 10 } },
      yAxis: { scale: true, axisLabel: { fontSize: 10 } },
      series: [{ type: 'candlestick', data: ohlc, itemStyle: { color: '#ef4444', color0: '#10b981', borderColor: '#ef4444', borderColor0: '#10b981' }, markPoint: { symbol: 'pin', symbolSize: 44, data: marks } }]
    });
    setTimeout(function () { if (_tmChart) _tmChart.resize(); }, 60);
  };

  // 通用: 生成一个可点的交易 <li> (有 kline 才可点)
  window.tradeChartLi = function (t, tid) {
    window._TRADES[tid] = t;
    var hasK = t.kline && t.kline.length;
    var clk = hasK ? "onclick=\"openTradeChart('" + tid + "')\" style=\"cursor:pointer\"" : '';
    var icon = hasK ? '<span class="text-indigo-500 ml-1 text-xs font-medium whitespace-nowrap" title="点击看K线">📈看图</span>' : '';
    var fmt = function (x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; };
    return '<li class="bg-white px-3 py-2 rounded text-xs ' + (hasK ? 'hover:bg-indigo-50' : '') + '" ' + clk + '>' +
      '<div class="flex justify-between flex-wrap gap-1"><span class="font-mono text-gray-700">' + t.ts_code + icon + '</span>' +
      '<span class="' + ((t.ret || 0) >= 0 ? 'text-green-600' : 'text-red-500') + ' font-bold">' + fmt(t.ret || 0) + '</span></div>' +
      '<div class="text-gray-500 mt-1">' + t.entry_date + ' → ' + (t.exit_date || '持有中') + (t.hold_days ? ' · ' + t.hold_days + '天' : '') + (t.reason ? ' · ' + t.reason : '') + '</div></li>';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectModal);
  else injectModal();
})();

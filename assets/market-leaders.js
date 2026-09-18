(function (root) {
  "use strict";
  const SYMBOL = /^\d{6}\.(SH|SZ|BJ)$/;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const COLUMNS = [
    {key: "name", label: "股票", type: "text"}, {key: "streak", label: "连板", type: "number", unit: "板"},
    {key: "reason", label: "涨停原因 / 题材归因", type: "text"}, {key: "return30_pct", label: "30 日涨幅", type: "number", unit: "%"},
    {key: "pct_chg", label: "当日涨幅", type: "number", unit: "%"}, {key: "close", label: "收盘价", type: "number", unit: "元"},
    {key: "amount_yi", label: "成交额", type: "number", unit: "亿元"}, {key: "cap_yi", label: "总市值", type: "number", unit: "亿元"}
  ];
  const GROUPS = ["首板", "二板", "三板", "四板", "五板以上"];
  const collator = new Intl.Collator("zh-CN", {numeric: true});
  const numeric = value => value === null || value === undefined || value === "" || typeof value === "boolean" || !Number.isFinite(Number(value)) ? null : Number(value);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const folded = value => String(value || "").trim().toLocaleLowerCase("zh-CN");
  const textFor = (row, key) => key === "name" ? `${row.name} ${row.ts_code}` : key === "reason" ? [row.reason, row.reason_detail, row.theme, ...row.reason_events.map(event => event.reason)].join(" ") : String(row[key] || "");
  const bucketFor = streak => Number.isInteger(streak) && streak > 0 ? GROUPS[Math.min(streak, 5) - 1] : "";

  function normalizeRow(row) {
    if (!row || !SYMBOL.test(row.ts_code || "")) return null;
    const result = {...row, name: String(row.name || row.ts_code), board: String(row.board || "其他")};
    COLUMNS.filter(column => column.type === "number").forEach(column => { result[column.key] = numeric(row[column.key]); });
    if (!Number.isInteger(result.streak) || result.streak < 0) result.streak = null;
    result.bucket = bucketFor(result.streak);
    result.is_st = row.is_st === true || row.is_st === 1;
    ["reason", "reason_detail", "reason_source", "theme", "status"].forEach(key => {result[key] = String(row[key] || "").trim();});
    result.reason_date = ISO_DATE.test(row.reason_date || "") ? row.reason_date : "";
    result.reason_events = (Array.isArray(row.reason_events) ? row.reason_events : []).filter(event => event && typeof event === "object").map(event => ({date: ISO_DATE.test(event.date || "") ? event.date : "", reason: String(event.reason || "").trim(), source: String(event.source || "").trim(), status: String(event.status || "").trim(), detail: String(event.detail || "").trim()})).sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }

  function filterAndSort(rows, filters = {}, sorting = {}) {
    const query = folded(filters.query);
    const kept = rows.filter(row => {
      if (filters.board && row.board !== filters.board) return false;
      if (filters.bucket && row.bucket !== filters.bucket) return false;
      if (filters.excludeST && row.is_st) return false;
      if (query && !folded(`${textFor(row, "name")} ${textFor(row, "reason")}`).includes(query)) return false;
      return Object.entries(filters.columns || {}).every(([key, filter]) => {
        if (filter.text !== undefined) return folded(textFor(row, key)).includes(folded(filter.text));
        const value = row[key];
        return finite(value) && (filter.min === null || filter.min === undefined || value >= filter.min) && (filter.max === null || filter.max === undefined || value <= filter.max);
      });
    });
    const column = COLUMNS.find(item => item.key === sorting.key) || COLUMNS[3];
    const direction = sorting.direction === "asc" ? 1 : -1;
    return kept.sort((left, right) => {
      const a = left[column.key], b = right[column.key];
      if (column.type === "number") {
        if (!finite(a) && finite(b)) return 1;
        if (finite(a) && !finite(b)) return -1;
        if (finite(a) && finite(b) && a !== b) return (a - b) * direction;
      } else { const comparison = collator.compare(textFor(left, column.key), textFor(right, column.key)); if (comparison) return comparison * direction; }
      if (column.key === "streak" && finite(left.return30_pct) && finite(right.return30_pct) && left.return30_pct !== right.return30_pct) return right.return30_pct - left.return30_pct;
      return collator.compare(left.ts_code, right.ts_code);
    });
  }

  function selectLeaders(rows, ladder) {
    const excluded = new Set(ladder.map(row => row.ts_code));
    const seen = new Set();
    return filterAndSort(rows.filter(row => !excluded.has(row.ts_code) && finite(row.return30_pct) && !seen.has(row.ts_code) && seen.add(row.ts_code)), {}, {key: "return30_pct", direction: "desc"}).slice(0, 50);
  }

  function normalizeHistory(payload) {
    if (!payload || !Array.isArray(payload.dates)) throw new Error("历史日期索引暂不可用。");
    const dates = [...new Set(payload.dates.filter(date => ISO_DATE.test(date || "")))].sort().reverse();
    if (!dates.length) throw new Error("尚未提供可用历史日期。");
    const latest = dates.includes(payload.latest_date) ? payload.latest_date : dates[0];
    return {dates: dates.filter(date => date <= latest), latest_date: latest};
  }
  function rowAsOf(raw, date) {
    const row = normalizeRow(raw); if (!row) return null;
    row.reason_events = row.reason_events.filter(event => event.date && event.date <= date);
    if (row.reason_date && row.reason_date > date) {
      const latest = row.reason_events[0];
      row.reason = latest ? latest.reason : ""; row.reason_date = latest ? latest.date : ""; row.reason_source = latest ? latest.source : ""; row.status = latest ? latest.status : ""; row.reason_detail = latest ? latest.detail : ""; row.theme = "";
    }
    return row;
  }
  function normalizeLogicGroup(group, date) {
    if (!group || !group.id || !String(group.name || "").trim()) return null;
    const result = {...group, id: String(group.id), name: String(group.name).trim(), source: String(group.source || "").trim()};
    ["consecutive_days", "active_days", "today_count", "member_count"].forEach(key => {const value = numeric(group[key]); result[key] = Number.isInteger(value) && value >= 0 ? value : null;});
    ["first_seen", "last_seen"].forEach(key => {result[key] = ISO_DATE.test(group[key] || "") && group[key] <= date ? group[key] : "";});
    result.consecutive_left_censored = group.consecutive_left_censored === true;
    const seen = new Set();
    result.members = (Array.isArray(group.members) ? group.members : []).map(raw => {
      const row = rowAsOf(raw, date); if (!row) return null;
      row.logic_dates = [...new Set((Array.isArray(raw.logic_dates) ? raw.logic_dates : []).filter(value => ISO_DATE.test(value || "") && value <= date))].sort().reverse();
      row.latest_logic_date = row.logic_dates[0] || (ISO_DATE.test(raw.latest_logic_date || "") && raw.latest_logic_date <= date ? raw.latest_logic_date : "");
      row.active_today = row.logic_dates.includes(date);
      row.logic_reason_events = (Array.isArray(raw.logic_reason_events) ? raw.logic_reason_events : []).filter(event => event && ISO_DATE.test(event.date || "") && event.date <= date).map(event => ({date: event.date, reason: String(event.reason || ""), source: String(event.source || ""), status: String(event.status || "")})).sort((a, b) => b.date.localeCompare(a.date));
      row.quote_date = ISO_DATE.test(raw.quote_date || "") ? raw.quote_date : "";
      if (row.quote_date && row.quote_date !== date) ["close", "pct_chg", "amount_yi", "cap_yi", "return30_pct"].forEach(key => {row[key] = null;});
      return row;
    }).filter(row => row && row.latest_logic_date && !seen.has(row.ts_code) && seen.add(row.ts_code));
    return result;
  }
  function filterLogicGroups(groups, filters = {}, sorting = {}) {
    const query = folded(filters.query), minDays = numeric(filters.minDays), minCount = numeric(filters.minCount);
    const key = ["name", "consecutive_days", "today_count", "active_days", "member_count", "last_seen"].includes(sorting.key) ? sorting.key : "today_count";
    const direction = sorting.direction === "asc" ? 1 : -1;
    return groups.filter(group => (!query || folded(`${group.name} ${group.source}`).includes(query)) && (!filters.activeOnly || group.today_count > 0) && (minDays === null || minDays <= 0 || finite(group.consecutive_days) && group.consecutive_days >= minDays) && (minCount === null || minCount <= 0 || finite(group.today_count) && group.today_count >= minCount)).sort((a, b) => {
      if (key === "name" || key === "last_seen") {if (!a[key] && b[key]) return 1; if (a[key] && !b[key]) return -1; const diff = collator.compare(a[key], b[key]); if (diff) return diff * direction;}
      else {if (!finite(a[key]) && finite(b[key])) return 1; if (finite(a[key]) && !finite(b[key])) return -1; if (finite(a[key]) && finite(b[key]) && a[key] !== b[key]) return (a[key] - b[key]) * direction;}
      for (const tieKey of ["today_count", "consecutive_days", "member_count"]) if (a[tieKey] !== b[tieKey] && finite(a[tieKey]) && finite(b[tieKey])) return b[tieKey] - a[tieKey];
      return collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
    });
  }
  function sortLogicMembers(members, activeOnly = false) {
    return members.filter(row => !activeOnly || row.active_today).slice().sort((a, b) => Number(b.active_today) - Number(a.active_today) || b.latest_logic_date.localeCompare(a.latest_logic_date) || (finite(a.pct_chg) && finite(b.pct_chg) ? b.pct_chg - a.pct_chg : 0) || collator.compare(a.ts_code, b.ts_code));
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function makeCsv(rows, date) {
    const columns = [["排序", (_, index) => index + 1], ["快照日期", () => date], ["股票代码", row => row.ts_code], ["股票名称", row => row.name], ["上市板块", row => row.board], ...COLUMNS.filter(column => column.type === "number").map(column => [`${column.label}（${column.unit}）`, row => row[column.key]]), ["涨停原因 / 题材归因", row => row.reason], ["原因日期", row => row.reason_date], ["原因来源", row => row.reason_source], ["来源状态标签（非连续板数）", row => row.status]];
    return "\uFEFF" + [columns.map(column => csvCell(column[0])).join(","), ...rows.map((row, index) => columns.map(column => csvCell(column[1](row, index))).join(","))].join("\r\n");
  }
  function movingAverage(bars, length) {return bars.map((_, i) => i < length - 1 ? null : bars.slice(i - length + 1, i + 1).reduce((sum, bar) => sum + bar.close, 0) / length);}
  function validateBars(payload, kind, requestedDate) {
    if (!payload || !Array.isArray(payload.bars)) throw new Error("行情格式不完整，请稍后重试。");
    if (payload.status === "unavailable") return [];
    if (payload.status !== "ok") throw new Error(String(payload.message || "行情暂不可用。"));
    if (kind === "intraday" && payload.date !== requestedDate || kind === "daily" && payload.date && payload.date !== requestedDate) throw new Error(`返回行情日期 ${payload.date || "未知"} 与快照 ${requestedDate} 不一致，未显示。`);
    let previous = "";
    return payload.bars.map(bar => {
      const time = String(bar.time || ""), required = kind === "daily" ? ["open", "high", "low", "close", "volume"] : ["close", "volume"];
      const result = {...bar, time}; required.forEach(key => {result[key] = numeric(bar[key]);});
      if (required.some(key => result[key] === null) || result.volume < 0 || result.close <= 0) throw new Error("行情包含缺失或无效数值，未绘制图表。");
      if (kind === "daily" && (!ISO_DATE.test(time) || time > requestedDate || result.open <= 0 || result.low <= 0 || result.low > Math.min(result.open, result.close) || result.high < Math.max(result.open, result.close))) throw new Error("日线日期或价格校验失败，未绘制图表。");
      if (kind === "intraday") {
        const match = time.match(/^(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{2}:\d{2})(?::\d{2})?$/);
        if (!match || (match[1] && match[1] !== requestedDate) || match[2] < "09:15" || match[2] > "15:30") throw new Error("分时时间或日期校验失败，未绘制图表。");
      }
      if (time <= previous) throw new Error("行情时间未按顺序排列，未绘制图表。");
      previous = time; return result;
    });
  }
  const AI_SOURCE_NOTE = "关联所选日期、右侧筛选与排序；行情和原因以实际返回的数据来源为准。";
  function stockReasonQuestion(row, date) {
    if (!row || !SYMBOL.test(row.ts_code || "") || !ISO_DATE.test(date || "")) throw new Error("请先选择有效的股票与快照日期。");
    return `请分析 ${row.name || row.ts_code}（${row.ts_code}）截至 ${date} 已知的涨停原因。请区分该日与历史涨停记录，梳理主要题材逻辑、连续发酵情况，以及还需要核实的线索；若所选日未涨停或没有原因记录，请明确说明，不要把历史记录当作当日原因。`;
  }
  function normalizeViewContext(raw) {
    if (!raw || !["ladder", "leaders", "logic"].includes(raw.view)) return null;
    const text = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
    const unique = (values, limit, valid) => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && valid(value)))].slice(0, limit);
    const filters = {}, input = raw.filters && typeof raw.filters === "object" ? raw.filters : {};
    ["query", "board", "bucket"].forEach(key => {if (typeof input[key] === "string") filters[key] = text(input[key]);});
    ["excludeST", "activeOnly"].forEach(key => {if (typeof input[key] === "boolean") filters[key] = input[key];});
    ["minDays", "minCount"].forEach(key => {if (input[key] === null || finite(input[key])) filters[key] = input[key];});
    if (input.columns && typeof input.columns === "object") {
      filters.columns = {};
      COLUMNS.forEach(column => {
        const filter = input.columns[column.key]; if (!filter || typeof filter !== "object") return;
        if (column.type === "text" && typeof filter.text === "string") filters.columns[column.key] = {text: text(filter.text)};
        else if (column.type === "number") {
          const bounds = {};
          ["min", "max"].forEach(key => {if (filter[key] === null || finite(filter[key])) bounds[key] = filter[key];});
          if (Object.keys(bounds).length) filters.columns[column.key] = bounds;
        }
      });
    }
    const keys = raw.view === "logic" ? ["name", "consecutive_days", "today_count", "active_days", "member_count", "last_seen"] : COLUMNS.map(column => column.key);
    return {view: raw.view, page: integer(raw.page, 1, 1, 10000), page_size: integer(raw.page_size, raw.view === "logic" ? 25 : 50, 1, 100),
      visible_codes: unique(raw.visible_codes, 100, value => SYMBOL.test(value)), filtered_codes: unique(raw.filtered_codes, 500, value => SYMBOL.test(value)),
      total_filtered: integer(raw.total_filtered, 0, 0, 10000), logic_ids: unique(raw.logic_ids, 25, value => Boolean(value.trim()) && value.length <= 160),
      selected_logic: typeof raw.selected_logic === "string" && raw.selected_logic.trim() && raw.selected_logic.length <= 160 ? raw.selected_logic : null,
      sort: {key: keys.includes(raw.sort?.key) ? raw.sort.key : raw.view === "logic" ? "today_count" : raw.view === "ladder" ? "streak" : "return30_pct", direction: raw.sort?.direction === "asc" ? "asc" : "desc"}, filters};
  }
  function buildDashboardViewContext(dashboard) {
    if (dashboard.view === "logic") {
      const groups = filterLogicGroups(dashboard.logic, dashboard.logicFilters, dashboard.logicSorting);
      const visibleGroups = groups.slice((dashboard.logicPage - 1) * 25, dashboard.logicPage * 25);
      const selected = visibleGroups.find(group => group.id === dashboard.logicSelected);
      const members = selected ? sortLogicMembers(selected.members, dashboard.logicActiveOnly) : [];
      const filtered = selected ? members : groups.flatMap(group => sortLogicMembers(group.members));
      const codes = [...new Set(filtered.map(row => row.ts_code))];
      return normalizeViewContext({view: "logic", page: dashboard.logicPage, page_size: 25, visible_codes: members.map(row => row.ts_code), filtered_codes: codes, total_filtered: codes.length,
        logic_ids: visibleGroups.map(group => group.id), selected_logic: selected ? selected.id : null, sort: dashboard.logicSorting, filters: dashboard.logicFilters});
    }
    return normalizeViewContext({view: dashboard.view, page: dashboard.page, page_size: dashboard.pageSize,
      visible_codes: dashboard.filtered.slice((dashboard.page - 1) * dashboard.pageSize, dashboard.page * dashboard.pageSize).map(row => row.ts_code), filtered_codes: dashboard.filtered.map(row => row.ts_code), total_filtered: dashboard.filtered.length,
      logic_ids: [], selected_logic: null, sort: dashboard.sorting, filters: {...dashboard.filters, bucket: dashboard.view === "ladder" ? dashboard.filters.bucket : ""}});
  }
  function researchResolution(response) {
    const seen = new Set();
    const stocks = (Array.isArray(response.resolved_stocks) ? response.resolved_stocks : []).filter(stock => stock && SYMBOL.test(stock.ts_code || "") && !seen.has(stock.ts_code) && seen.add(stock.ts_code)).map(stock => ({ts_code: stock.ts_code, name: typeof stock.name === "string" && stock.name.trim() ? stock.name.trim().slice(0, 80) : stock.ts_code}));
    return {stocks, selected: stocks.length === 1 ? stocks[0] : null, scope: typeof response.research_scope === "string" ? response.research_scope.slice(0, 500) : ""};
  }
  function safeResearchUrl(value) {
    if (typeof value !== "string" || value.length > 5000 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return "";
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch (_) {return "";}
  }
  function normalizeAiResearch(response = {}) {
    const seen = new Set();
    const statuses = ["completed", "failed", "not_used", "disabled", "unavailable"];
    const sources = (Array.isArray(response.sources) ? response.sources : []).flatMap(source => {
      if (!source || typeof source !== "object") return [];
      const url = safeResearchUrl(source.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      const title = typeof source.title === "string" && source.title.trim() ? source.title.trim().slice(0, 300) : new URL(url).hostname;
      const publishedAt = typeof source.published_at === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(source.published_at) ? source.published_at.slice(0, 10) : "";
      return [{url, title, published_at: publishedAt, verification: typeof source.verification === "string" ? source.verification.slice(0, 120) : ""}];
    }).slice(0, 20);
    const tools = (Array.isArray(response.tools) ? response.tools : []).filter(tool => tool && ["web_search", "web_fetch"].includes(tool.name)).slice(0, 10).map(tool => ({name: tool.name, status: ["completed", "success", "ok"].includes(tool.status) ? "completed" : ["failed", "error"].includes(tool.status) ? "failed" : "unknown"}));
    return {engine: typeof response.engine === "string" ? response.engine.slice(0, 80) : "", search_status: statuses.includes(response.search_status) ? response.search_status : "unknown", sources, tools};
  }
  function researchStatusLabel(status) {
    return {completed: "联网检索已完成", failed: "联网检索未完成，请以已取得的数据为准", not_used: "本次未调用联网检索", disabled: "本次已关闭联网检索", unavailable: "联网检索暂不可用"}[status] || "";
  }
  function researchDateLabel(source) {
    const verification = {verified: "日期已核验", before_asof: "截至所选日已发布", verified_before_asof: "截至所选日已发布", within_asof: "截至所选日已发布", after_asof: "晚于所选日", published_after_asof: "晚于所选日", future: "晚于所选日", unknown: "发布日期未核验", unverified: "发布日期未核验", date_unverified: "发布日期未核验"}[source.verification];
    return [source.published_at || "未提供发布日期", verification || "发布日期未核验"].join(" · ");
  }
  function buildChatPayload(date, code, messages, viewContext, webSearch = true) {
    if (!ISO_DATE.test(date || "") || code !== null && !SYMBOL.test(code || "")) throw new Error("请先等待所选日期的市场快照加载完成。");
    const allowed = messages.filter(message => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.trim()).map(message => ({role: message.role, content: message.content.trim()}));
    if (!allowed.length || allowed.at(-1).role !== "user") throw new Error("请输入你想研究的问题。");
    if (allowed.at(-1).content.length > 4000) throw new Error("每条提问请控制在 4000 字以内。");
    let recent = allowed.slice(-13);
    while (recent.length && recent[0].role !== "user") recent.shift();
    while (recent.length > 1 && (recent.slice(0, -1).some(message => message.content.length > 8000) || recent.slice(0, -1).reduce((sum, message) => sum + message.content.length, 0) > 18000)) {recent.shift(); while (recent.length > 1 && recent[0].role !== "user") recent.shift();}
    const context = normalizeViewContext(viewContext);
    return {date, ts_code: code, messages: recent, web_search: webSearch !== false, ...(context ? {view_context: context} : {})};
  }
  function accessMessage(status) {
    if (status === 401) return {title: "登录后查看市场数据", description: "这台设备尚未登录，或登录已过期。请使用已有账号登录，完成后会返回当前看板。", action: "登录并返回看板"};
    if (status === 403) return {title: "当前账号暂无看板权限", description: "此看板需要有效会员权限。请确认登录的是已开通的账号；如会员已到期，请在首页查看账户状态。", action: "查看账户状态", href: "/index.html"};
    return null;
  }
  const core = {COLUMNS, normalizeRow, bucketFor, filterAndSort, selectLeaders, normalizeHistory, rowAsOf, normalizeLogicGroup, filterLogicGroups, sortLogicMembers, csvCell, makeCsv, movingAverage, validateBars, stockReasonQuestion, normalizeViewContext, buildDashboardViewContext, researchResolution, safeResearchUrl, normalizeAiResearch, researchStatusLabel, researchDateLabel, buildChatPayload, accessMessage};
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element;};
  const fmt = (value, digits = 2) => finite(value) ? value.toLocaleString("zh-CN", {minimumFractionDigits: digits, maximumFractionDigits: digits}) : "—";
  const signed = value => finite(value) ? `${value > 0 ? "+" : ""}${fmt(value)}%` : "—";
  const tone = value => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  const state = {ladder: [], leaders: [], unknown: [], meta: {}, view: "ladder", filtered: [], page: 1, pageSize: 50, filters: {query: "", board: "", bucket: "", excludeST: false, columns: {}}, sorting: {key: "streak", direction: "desc"}, column: null, columnTrigger: null, selected: null, kind: "daily", period: 60, chart: null, chartPayload: null, chartController: null, requestId: 0, cache: new Map(), opener: null, dates: [], requestedDate: "", latestDate: "", loading: true, screenRequestId: 0, screenController: null, screenError: "", logic: [], logicMeta: {}, logicFilters: {query: "", minDays: null, minCount: null, activeOnly: false}, logicSorting: {key: "today_count", direction: "desc"}, logicPage: 1, logicSelected: null, logicActiveOnly: false};

  const ai = {configured: false, configLoaded: false, model: "deepseek-v4-pro", draftModel: "deepseek-v4-pro", models: [{id: "deepseek-v4-pro", label: "DeepSeek V4 Pro"}, {id: "deepseek-flash", label: "DeepSeek Flash"}], keyHint: "", messages: [], selected: null, resolved: [], researchScope: "", date: "", webSearch: true, busy: false, saving: false, requestId: 0, controller: null, pendingQuestion: "", authRequired: false};
  const aiModelName = model => ai.models.find(option => option.id === model)?.label || model;
  const loginUrl = () => `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  function revealLogin() {
    $("ai-login").href = loginUrl(); $("ai-login").hidden = false;
    $("ai-login").textContent = "登录并返回当前看板 →";
    $("ai-connection-status").textContent = "请先登录网站账号";
  }
  function applyAiConfig(payload) {
    const ids = Array.isArray(payload.models) ? payload.models.filter(id => typeof id === "string" && /^deepseek-[a-z0-9-]+$/.test(id)) : ai.models.map(option => option.id);
    const options = Array.isArray(payload.model_options) ? payload.model_options : [];
    if (ids.length) ai.models = [...new Set(ids)].map(id => {
      const option = options.find(item => item && item.id === id);
      return {id, label: typeof option?.label === "string" ? option.label : id, description: typeof option?.description === "string" ? option.description : ""};
    });
    ai.configured = payload.configured === true;
    ai.model = ids.includes(payload.model) ? payload.model : ai.models[0].id;
    ai.draftModel = ai.model; ai.configLoaded = true;
  }
  async function aiRequest(path, method = "GET", body, signal) {
    const response = await fetch(`/api/market-leaders/ai/${path}`, {method, headers: {Accept: "application/json", ...(body ? {"Content-Type": "application/json"} : {})}, credentials: "same-origin", cache: "no-store", ...(body ? {body: JSON.stringify(body)} : {}), signal});
    let payload = null;
    try {if ((response.headers.get("content-type") || "").includes("application/json")) payload = await response.json();} catch (_) { /* Handle invalid service responses below. */ }
    if (response.status === 401) {ai.authRequired = true; revealLogin(); throw new Error("这台设备尚未登录或登录已过期，请先登录网站账号。");}
    if (!response.ok) {
      const errorText = payload && typeof payload.detail === "string" ? payload.detail : payload && typeof payload.error === "string" ? payload.error : payload && typeof payload.message === "string" ? payload.message : "";
      throw new Error(errorText || (response.status === 429 ? "请求较多，请稍后重试。" : `研究助手暂时不可用（${response.status}），请稍后重试。`));
    }
    if (!payload) throw new Error("研究助手未返回有效数据，请稍后重试。");
    ai.authRequired = false; $("ai-login").hidden = true;
    return payload;
  }
  function revealAssistant() {
    if (window.matchMedia("(max-width: 1100px)").matches) {
      document.body.classList.add("ai-sidebar-open"); $("ai-backdrop").hidden = false; $("ai-mobile-toggle").setAttribute("aria-expanded", "true");
    }
  }
  function hideAssistant() {
    document.body.classList.remove("ai-sidebar-open"); $("ai-backdrop").hidden = true; $("ai-mobile-toggle").setAttribute("aria-expanded", "false");
  }
  function toggleAiConfig(open) {
    $("ai-config").hidden = !open; $("ai-config-toggle").setAttribute("aria-expanded", String(open));
    if (open) {revealAssistant(); (ai.configured ? $("ai-model") : $("ai-api-key")).focus();}
    else $("ai-api-key").value = "";
  }
  function renderAiConfig() {
    $("ai-connection-status").textContent = ai.authRequired ? "请先登录网站账号" : ai.configured ? "账户已配置" : "尚未配置 API Key";
    $("ai-connection-dot").classList.toggle("is-connected", ai.configured);
    $("ai-api-key").placeholder = ai.configured ? "留空保留现有密钥" : "输入你的 API Key";
    const select = $("ai-model");
    if ([...select.options].map(option => option.value).join(",") !== ai.models.map(option => option.id).join(",")) {
      select.replaceChildren(...ai.models.map(option => {const node = make("option", "", option.label); node.value = option.id; return node;}));
    }
    select.value = ai.draftModel;
    $("ai-model-label").textContent = aiModelName(ai.model); $("ai-model-label").title = `当前使用：${aiModelName(ai.model)}`;
    const selected = ai.models.find(option => option.id === ai.draftModel);
    $("ai-model-description").textContent = `${selected?.description || ""} 选择后保存，下一次提问生效。${ai.configured ? " API Key 留空即可保留现有密钥。" : ""}`;
    $("ai-delete-config").hidden = !ai.configured;
    $("ai-api-key").disabled = ai.saving || ai.busy; $("ai-model").disabled = ai.saving || ai.busy;
    $("ai-save-config").disabled = ai.saving || ai.busy; $("ai-delete-config").disabled = ai.saving || ai.busy;
    $("ai-save-config").textContent = ai.saving ? "正在保存…" : "保存配置";
    $("ai-send").disabled = ai.busy || ai.saving || state.loading || Boolean(state.screenError);
  }
  async function loadAiConfig() {
    try {
      const payload = await aiRequest("config");
      applyAiConfig(payload);
      renderAiConfig();
    } catch (error) {
      $("ai-connection-status").textContent = ai.authRequired ? "请先登录网站账号" : "配置读取失败";
      showAiStatus(error.message, ai.authRequired ? null : () => loadAiConfig());
    }
  }
  async function saveAiConfig(event) {
    event.preventDefault(); if (ai.saving || ai.busy) return;
    const key = $("ai-api-key").value.trim(), model = $("ai-model").value;
    if (!key && !ai.configured) {$("ai-config-status").textContent = "请先输入你的 DeepSeek API Key。"; $("ai-api-key").focus(); return;}
    ai.saving = true; $("ai-config-status").textContent = "正在保存配置…"; renderAiConfig();
    try {
      const payload = await aiRequest("config", "PUT", {model, ...(key ? {api_key: key} : {})});
      applyAiConfig(payload);
      $("ai-config-status").textContent = ai.configured ? "配置已保存。" : "尚未保存密钥，请检查后重试。";
      if (ai.configured) {toggleAiConfig(false); showAiStatus(`已保存，当前模型：${aiModelName(ai.model)}。${ai.pendingQuestion ? "点击发送即可继续刚才的提问。" : "下一次提问将使用此模型。"}`, null, false); $("ai-chat-input").focus();}
    } catch (error) {$("ai-config-status").textContent = error.message;}
    finally {$("ai-api-key").value = ""; ai.saving = false; renderAiConfig();}
  }
  async function deleteAiConfig() {
    if (ai.saving || ai.busy) return;
    ai.saving = true; renderAiConfig(); $("ai-config-status").textContent = "正在删除密钥…";
    try {applyAiConfig(await aiRequest("config", "DELETE")); $("ai-api-key").value = ""; $("ai-config-status").textContent = "密钥已删除。重新配置后可继续提问。";}
    catch (error) {$("ai-config-status").textContent = error.message;}
    finally {ai.saving = false; renderAiConfig();}
  }
  function showAiStatus(message, retry, error = true) {
    const node = $("ai-chat-status"); node.replaceChildren(); node.hidden = !message; node.classList.toggle("is-error", error);
    if (!message) return;
    node.append(make("span", "", message));
    if (retry) {const button = make("button", "text-button", "重试"); button.type = "button"; button.addEventListener("click", retry); node.append(button);}
  }
  function renderAiContext() {
    const stockNames = ai.resolved.map(stock => stock.name);
    $("ai-context-name").textContent = ai.selected ? `${ai.selected.name} · ${ai.selected.ts_code.split(".")[0]}` : stockNames.length ? stockNames.join(" / ") : ai.researchScope || "所选日市场";
    $("ai-context-name").title = ai.researchScope;
    $("ai-context-date").textContent = ai.date || "等待快照";
    $("ai-context-reset").hidden = !ai.selected && !ai.resolved.length && !ai.researchScope;
    const viewName = {ladder: "连板梯队", leaders: "30 日涨幅榜", logic: "逻辑追踪"}[state.view];
    const group = state.view === "logic" && state.logic.find(item => item.id === state.logicSelected);
    const scope = state.view === "logic" ? group ? ` · ${group.name}${state.logicActiveOnly ? "（当日活跃）" : ""}` : ` · 第 ${state.logicPage} 页` : ` · 第 ${state.page} 页 · ${state.filtered.length} 只符合筛选`;
    $("ai-linked-context").textContent = state.loading ? "正在关联所选日期的看板…" : state.screenError ? "看板数据读取失败，请重试后提问。" : `已关联右侧：${viewName}${scope} · ${state.meta.date || ai.date}`;
  }
  function aiAnswerSource(message) {
    const stocks = Array.isArray(message.resolved_stocks) ? message.resolved_stocks : [];
    return [stocks.length ? `研究标的：${stocks.map(stock => `${stock.name}（${stock.ts_code}）`).join("、")}` : "", message.research_scope ? `范围：${message.research_scope}` : "", message.source_note || AI_SOURCE_NOTE].filter(Boolean).join(" · ");
  }
  function renderAiResearch(item, research) {
    if (!research) return;
    const status = researchStatusLabel(research.search_status);
    if (status) item.append(make("span", `ai-search-status${["failed", "unavailable"].includes(research.search_status) ? " is-warning" : ""}`, status));
    if (research.tools.length) {
      const activity = make("div", "ai-tool-activity"); activity.setAttribute("aria-label", "检索记录");
      research.tools.forEach(tool => activity.append(make("span", "", `${tool.name === "web_search" ? "搜索公告新闻" : "读取网页"} · ${tool.status === "completed" ? "完成" : tool.status === "failed" ? "失败" : "已调用"}`)));
      item.append(activity);
    }
    if (!research.sources.length) return;
    const details = make("details", "ai-research-sources"); details.append(make("summary", "", `参考来源 · ${research.sources.length}`));
    const list = make("ol", "ai-source-list");
    research.sources.forEach(source => {
      const row = make("li", "ai-source-card"), link = make("a", "", source.title);
      link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer";
      row.append(link, make("span", "ai-source-domain", new URL(source.url).hostname), make("span", "ai-source-date", researchDateLabel(source)));
      list.append(row);
    });
    details.append(list); item.append(details);
  }
  function renderAiMessages() {
    const node = $("ai-messages"); node.replaceChildren();
    if (!ai.messages.length && !ai.busy) {
      const welcome = make("div", "ai-welcome"); welcome.append(make("span", "ai-welcome-mark", "✦"), make("strong", "", "直接问股票，也可以问右侧看板"), make("p", "", "输入股票名称或代码即可研究，例如“宁德时代怎么样”，也可以问“比较右边前3只”。当前日期、筛选和排序会一起关联。"), make("span", "", "点击“涨停原因”可快速提问。切换历史日期会开启新对话。")); node.append(welcome);
    }
    ai.messages.forEach(message => {
      const item = make("article", `ai-message ai-message-${message.role}`); item.append(make("span", "ai-message-author", message.role === "user" ? "你" : message.model ? aiModelName(message.model) : "DeepSeek"), make("p", "ai-message-content", message.content));
      if (message.role === "assistant") {item.append(make("span", "ai-message-source", aiAnswerSource(message))); renderAiResearch(item, message.research);}
      node.append(item);
    });
    if (ai.busy) {const pending = make("div", "ai-pending"); pending.append(make("span", "loader"), make("span", "", ai.webSearch ? "正在关联数据并按需检索公告新闻，可能需要 1–3 分钟…" : "正在关联股票、看板与历史数据…")); node.append(pending);}
    node.scrollTop = node.scrollHeight;
    renderAiContext();
    $("ai-chat-input").disabled = ai.busy;
    $("ai-web-search").checked = ai.webSearch; $("ai-web-search").disabled = ai.busy;
    $("ai-send").disabled = ai.busy || ai.saving || state.loading || Boolean(state.screenError);
    $("ai-send").firstChild.textContent = ai.busy ? "分析中 " : "发送 ";
    renderAiConfig();
  }
  function clearAiConversation(row = ai.selected, date = ai.date) {
    ai.requestId++; if (ai.controller) ai.controller.abort(); ai.controller = null;
    ai.busy = false; ai.messages = []; ai.selected = row; ai.resolved = row ? [row] : []; ai.researchScope = ""; ai.date = date; ai.pendingQuestion = "";
    $("ai-chat-input").value = ""; $("ai-source-note").textContent = AI_SOURCE_NOTE; showAiStatus(""); renderAiMessages();
  }
  function syncAiDate(date) {
    if (ai.date !== date) clearAiConversation(null, date);
    else renderAiMessages();
  }
  function makeAiReasonButton(row) {
    const button = make("button", "ai-reason-button", "涨停原因"); button.type = "button"; button.setAttribute("aria-label", `向 DeepSeek 询问${row.name}涨停原因`); button.title = "在左侧研究助手中自动提问";
    button.addEventListener("click", () => askStockReason(row)); return button;
  }
  function askStockReason(row) {
    if (state.loading || state.screenError) return;
    revealAssistant(); clearAiConversation({name: row.name, ts_code: row.ts_code}, state.meta.date);
    const question = stockReasonQuestion(row, state.meta.date); $("ai-chat-input").value = question; ai.pendingQuestion = question;
    if (!ai.configured) {showAiStatus("先配置你的 DeepSeek API Key；保存后点击发送，继续此股的提问。", null, false); toggleAiConfig(true); return;}
    sendAiMessage();
  }
  async function sendAiMessage(event) {
    if (event) event.preventDefault(); if (ai.busy || ai.saving) return;
    const content = $("ai-chat-input").value.trim();
    if (!content) {$("ai-chat-input").focus(); return;}
    if (state.loading || state.screenError) {showAiStatus("请先等待市场快照加载完成。"); return;}
    if (!ai.configured) {ai.pendingQuestion = content; showAiStatus("先配置你的 DeepSeek API Key，保存后点击发送。", null, false); toggleAiConfig(true); return;}
    let payload;
    try {payload = buildChatPayload(ai.date, ai.selected ? ai.selected.ts_code : null, [...ai.messages, {role: "user", content}], buildDashboardViewContext(state), ai.webSearch);}
    catch (error) {showAiStatus(error.message); return;}
    const requestId = ++ai.requestId;
    ai.busy = true; ai.controller = new AbortController(); ai.messages.push({role: "user", content}); ai.pendingQuestion = "";
    $("ai-chat-input").value = ""; showAiStatus(""); renderAiMessages();
    try {
      const response = await aiRequest("chat", "POST", payload, ai.controller.signal);
      if (requestId !== ai.requestId) return;
      if (typeof response.reply !== "string" || !response.reply.trim()) throw new Error("未取得有效回复，请重试。");
      const resolution = researchResolution(response);
      ai.selected = resolution.selected; ai.resolved = resolution.stocks; ai.researchScope = resolution.scope;
      const answer = {role: "assistant", content: response.reply, model: response.model, source_note: typeof response.source_note === "string" ? response.source_note : AI_SOURCE_NOTE, resolved_stocks: resolution.stocks, research_scope: resolution.scope, research: normalizeAiResearch(response)};
      ai.messages.push(answer);
      $("ai-source-note").textContent = aiAnswerSource(answer);
    } catch (error) {
      if (error.name === "AbortError" || requestId !== ai.requestId) return;
      ai.messages.pop(); $("ai-chat-input").value = content;
      showAiStatus(error.message, () => sendAiMessage());
    } finally {if (requestId === ai.requestId) {ai.busy = false; ai.controller = null; renderAiMessages();}}
  }
  async function getJson(url, signal) {
    const response = await fetch(url, {headers: {Accept: "application/json"}, credentials: "same-origin", cache: "no-store", signal});
    if (!response.ok) {
      const error = new Error(accessMessage(response.status)?.description || `数据请求未完成（${response.status}），请稍后重试。`);
      error.status = response.status; throw error;
    }
    if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("接口没有返回有效数据。");
    return response.json();
  }
  function showState(target, title, description, retry, loading = false) {
    target.replaceChildren(); target.hidden = false;
    target.append(make("span", loading ? "loader" : "state-icon", loading ? "" : "◇"), make("strong", "", title));
    if (description) target.append(make("p", "", description));
    if (retry) {const button = make("button", "button button-outline", "重新加载"); button.type = "button"; button.addEventListener("click", retry); target.append(button);}
  }
  function showScreenError(target) {
    const access = accessMessage(state.screenStatus);
    if (!access) {showState(target, "暂时无法读取", state.screenError, () => loadScreen(state.requestedDate)); return;}
    showState(target, access.title, access.description);
    const link = make("a", "button button-primary", access.action);
    link.href = access.href || loginUrl(); target.append(link);
  }
  function setScreenError(error) {
    state.loading = false; state.screenStatus = error.status || 0;
    state.screenError = error.message || "请检查网络连接后重试。";
    const access = accessMessage(state.screenStatus);
    if (access) showScreenError($("access-notice"));
    $("snapshot-note").textContent = access ? access.title : "所选日期读取失败";
    $("history-status").textContent = access ? access.title : "所选日期读取失败，可重试或切换日期";
    if (state.screenStatus === 401) revealLogin();
    render();
  }
  function buildHeaders() {
    $("table-head").replaceChildren();
    COLUMNS.forEach(column => {
      const th = make("th"); th.scope = "col"; th.dataset.column = column.key;
      const wrap = make("div", "column-header"), sort = make("button", "sort-button"); sort.type = "button";
      sort.append(make("span", "", column.unit === "亿元" ? `${column.label} / 亿` : column.label), make("span", "sort-arrow", "↕"));
      sort.addEventListener("click", () => {state.sorting = {key: column.key, direction: state.sorting.key === column.key && state.sorting.direction === "desc" ? "asc" : "desc"}; state.page = 1; render();});
      const filter = make("button", "column-filter-button"); filter.type = "button"; filter.setAttribute("aria-label", `筛选${column.label}${column.unit ? `（${column.unit}）` : ""}`); filter.setAttribute("aria-haspopup", "dialog"); filter.setAttribute("aria-expanded", "false");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 16 16"); icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M2 3h12L9.5 8v4l-3 2V8L2 3Z"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.3"); path.setAttribute("stroke-linejoin", "round"); icon.append(path); filter.append(icon);
      filter.addEventListener("click", () => openColumnFilter(column, filter)); wrap.append(sort, filter); th.append(wrap); $("table-head").append(th);
    });
  }
  function buildGroups() {
    const groups = $("ladder-groups"); groups.replaceChildren();
    ["", ...GROUPS].forEach(bucket => {
      const button = make("button", "ladder-group"); button.type = "button"; button.dataset.bucket = bucket;
      button.append(make("span", "group-label", bucket || "全部梯队"), make("strong", "group-value", "—"), make("span", "group-unit", "只"));
      if (bucket === "五板以上") button.append(make("span", "group-accent", "↗"));
      button.addEventListener("click", () => {state.filters.bucket = bucket; state.page = 1; render();}); groups.append(button);
    });
  }
  function sourceRows() {return state.view === "ladder" ? state.ladder : state.leaders;}
  function resetFilters() {
    state.filters = {query: "", board: "", bucket: "", excludeST: false, columns: {}}; state.page = 1;
    $("stock-search").value = ""; $("board-select").value = ""; $("exclude-st").checked = false;
    closeColumnFilter(false); render();
  }
  function setView(view) {
    if (!["ladder", "leaders", "logic"].includes(view)) return;
    state.view = view; if (view !== "logic") state.sorting = {key: view === "ladder" ? "streak" : "return30_pct", direction: "desc"};
    state.filters.bucket = ""; state.page = 1; closeColumnFilter(false); render();
  }
  function render() {
    const isLadder = state.view === "ladder", source = sourceRows();
    document.querySelectorAll(".panel-tab").forEach(button => {const active = button.dataset.view === state.view; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;});
    $("market-panel").setAttribute("aria-labelledby", `${state.view}-tab`);
    $("market-panel").setAttribute("aria-busy", String(state.loading));
    $("stock-panel-content").hidden = state.view === "logic"; $("logic-panel").hidden = state.view !== "logic";
    if (state.view === "logic") {renderLogic(); return;}
    $("ladder-groups").hidden = !isLadder; $("top-control").hidden = isLadder;
    $("pool-title").textContent = isLadder ? "连板梯队" : "30 日涨幅榜";
    $("pool-description").textContent = isLadder ? "按连续交易日涨停次数分组，首板到最高板一览可见。" : "排除连板单元所有股票，按近 30 个交易日涨幅取前 50 名；筛选只缩小范围，不补位。";
    state.filtered = filterAndSort(source, {...state.filters, bucket: isLadder ? state.filters.bucket : ""}, state.sorting);
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize)); state.page = Math.max(1, Math.min(state.page, totalPages));
    $("result-count").textContent = `显示 ${state.filtered.length} / ${source.length} 只股票`;
    const column = COLUMNS.find(item => item.key === state.sorting.key);
    $("sort-description").textContent = `${column.label} ${state.sorting.direction === "desc" ? "↓" : "↑"}`;
    $("export-csv").disabled = !state.filtered.length;
    const base = filterAndSort(state.ladder, {...state.filters, bucket: ""}, state.sorting);
    $("ladder-groups").querySelectorAll("button").forEach(button => {
      const active = button.dataset.bucket === state.filters.bucket; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));
      button.querySelector(".group-value").textContent = base.filter(row => !button.dataset.bucket || row.bucket === button.dataset.bucket).length;
    });
    $("table-head").querySelectorAll("th").forEach(th => {
      const active = th.dataset.column === state.sorting.key;
      th.setAttribute("aria-sort", active ? state.sorting.direction === "desc" ? "descending" : "ascending" : "none");
      th.querySelector(".sort-arrow").textContent = active ? state.sorting.direction === "desc" ? "↓" : "↑" : "↕";
      th.querySelector(".sort-button").setAttribute("aria-label", `${COLUMNS.find(item => item.key === th.dataset.column).label}，点击${active && state.sorting.direction === "desc" ? "升序" : "降序"}排序`);
      th.querySelector(".column-filter-button").classList.toggle("is-filtered", Boolean(state.filters.columns[th.dataset.column]));
    });
    $("active-filters").replaceChildren(); $("active-filters").hidden = !Object.keys(state.filters.columns).length;
    Object.entries(state.filters.columns).forEach(([key, filter]) => {
      const def = COLUMNS.find(item => item.key === key), description = filter.text !== undefined ? `包含“${filter.text}”` : `${filter.min === null ? "不限" : filter.min} – ${filter.max === null ? "不限" : filter.max}${def.unit}`;
      const button = make("button", "filter-chip", `${def.label}：${description} ×`); button.type = "button";
      button.setAttribute("aria-label", `移除${def.label}筛选`); button.addEventListener("click", () => {delete state.filters.columns[key]; state.page = 1; render();}); $("active-filters").append(button);
    });
    $("pagination").hidden = !state.filtered.length;
    $("page-description").textContent = `第 ${(state.page - 1) * state.pageSize + 1}–${Math.min(state.page * state.pageSize, state.filtered.length)} 只 · 点击股票查看原因与行情`;
    $("page-number").textContent = `${state.page} / ${totalPages}`; $("page-prev").disabled = state.page === 1; $("page-next").disabled = state.page === totalPages;
    $("unknown-note").hidden = !isLadder || !state.unknown.length;
    $("unknown-note").textContent = state.unknown.length ? `另有 ${state.unknown.length} 只股票因涨停价或连续历史缺失，暂未纳入连板分组。` : "";
    renderRows(); renderAiContext();
  }
  function renderRows() {
    const body = $("table-body"); body.replaceChildren();
    if (state.loading) {$("table-scroll").hidden = true; showState($("table-status"), "正在读取历史快照", `${state.requestedDate || "最新交易日"} · 加载当日已知数据`, null, true); return;}
    if (state.screenError) {$("table-scroll").hidden = true; showScreenError($("table-status")); return;}
    if (!state.filtered.length) {$("table-scroll").hidden = true; showState($("table-status"), "没有符合当前条件的股票", "试着放宽筛选条件，或重置筛选查看全部结果。"); return;}
    $("table-scroll").hidden = false; $("table-status").hidden = true;
    const fragment = document.createDocumentFragment(), start = (state.page - 1) * state.pageSize;
    state.filtered.slice(start, start + state.pageSize).forEach((row, index) => {
      const tr = make("tr");
      COLUMNS.forEach(column => {
        const td = make("td");
        if (column.key === "name") {
          const button = make("button", "stock-button"); button.type = "button"; button.setAttribute("aria-label", `${row.name} ${row.ts_code}，查看涨停原因及行情`);
          const label = make("span"), symbol = make("span", "stock-symbol", row.ts_code.split(".")[0]);
          symbol.append(make("span", "stock-board", {"沪主板": "沪", "深主板": "深", "创业板": "创", "科创板": "科", "北交所": "北"}[row.board] || row.board));
          label.append(make("span", "stock-name", row.name), symbol);
          button.append(make("span", `stock-rank${start + index < 3 ? " top-rank" : ""}`, String(start + index + 1).padStart(2, "0")), label);
          button.addEventListener("click", () => openStock(row, button)); const stockActions = make("div", "stock-actions"); stockActions.append(button, makeAiReasonButton(row)); td.append(stockActions);
        } else if (column.key === "streak") {
          td.append(make("span", `streak-badge ${row.streak >= 4 ? "high" : row.streak >= 2 ? "medium" : "low"}`, row.streak > 0 ? row.streak === 1 ? "首板" : `${row.streak} 连板` : row.streak === 0 ? "—" : "待核验"));
        } else if (column.key === "reason") {
          const button = make("button", "reason-button"); button.type = "button";
          if (row.reason) {button.append(make("span", "reason-text", row.reason), make("span", "reason-meta", `${row.reason_date || "日期未提供"} · ${row.reason_source || "来源未提供"}${row.reason_date && row.reason_date !== state.meta.date ? " · 历史记录" : ""}`));}
          else button.append(make("span", "reason-missing", state.view === "ladder" ? "暂未取得该日涨停原因" : "近30日未取得涨停原因记录"));
          button.setAttribute("aria-label", `${row.name}，查看完整原因记录`); button.addEventListener("click", () => openStock(row, button)); td.append(button);
        } else if (["return30_pct", "pct_chg"].includes(column.key)) td.append(make("span", `${tone(row[column.key])}${column.key === "return30_pct" ? " return-value" : ""}`, signed(row[column.key])));
        else td.textContent = fmt(row[column.key]);
        tr.append(td);
      }); fragment.append(tr);
    }); body.append(fragment);
  }
  function parkLogicMembers() {
    const panel = $("logic-members-panel");
    panel.hidden = true;
    $("logic-panel").append(panel);
    return panel;
  }
  function renderLogic() {
    const membersPanel = parkLogicMembers();
    if (state.loading || state.screenError) {
      $("logic-table-scroll").hidden = true; $("logic-pagination").hidden = true;
      $("logic-result-count").textContent = state.loading ? "正在加载…" : "数据尚未读取";
      if (state.screenError) showScreenError($("logic-status"));
      else showState($("logic-status"), "正在读取逻辑历史", `${state.requestedDate || "最新交易日"} · 仅使用该日及此前记录`, null, true);
      renderAiContext(); return;
    }
    const groups = filterLogicGroups(state.logic, state.logicFilters, state.logicSorting), pageSize = 25, pages = Math.max(1, Math.ceil(groups.length / pageSize));
    state.logicPage = Math.max(1, Math.min(state.logicPage, pages));
    $("logic-result-count").textContent = `${groups.length} / ${state.logic.length} 个逻辑 · ${groups.filter(group => group.today_count > 0).length} 个当日活跃`;
    $("logic-window-label").textContent = `${state.logicMeta.window_start || state.meta.start_date || ""} → ${state.meta.date}`;
    $("logic-data-note").textContent = [state.logicMeta.definition || "连续发酵：截至所选日，每个连续交易日至少一只官方涨停股票的同源原因提及该精确标签；中断一天归零。", state.logicMeta.source_note || "", "≥ 表示更早记录不足，真实连续天数可能更长。"].filter(Boolean).join(" ");
    $("logic-table-scroll").hidden = !groups.length; $("logic-pagination").hidden = !groups.length;
    $("logic-status").hidden = Boolean(groups.length);
    if (!groups.length) showState($("logic-status"), "没有符合条件的逻辑", state.logic.length ? "尝试放宽连续天数、当日涨停数量或搜索条件。" : "所选日期暂未取得可用的逻辑归因记录。");
    document.querySelectorAll(".logic-sort").forEach(button => {
      const active = button.dataset.sort === state.logicSorting.key;
      button.classList.toggle("is-active", active); button.querySelector("span").textContent = active ? state.logicSorting.direction === "desc" ? "↓" : "↑" : "↕";
      button.closest("th").setAttribute("aria-sort", active ? state.logicSorting.direction === "desc" ? "descending" : "ascending" : "none");
    });
    const visibleGroups = groups.slice((state.logicPage - 1) * pageSize, state.logicPage * pageSize);
    if (!visibleGroups.some(group => group.id === state.logicSelected)) state.logicSelected = null;
    const body = $("logic-table-body"); body.replaceChildren();
    visibleGroups.forEach(group => {
      const tr = make("tr", `logic-row${state.logicSelected === group.id ? " is-selected" : ""}`), name = make("td"), button = make("button", "logic-name-button", group.name);
      button.dataset.logicId = group.id;
      button.type = "button"; button.setAttribute("aria-expanded", String(state.logicSelected === group.id)); button.setAttribute("aria-controls", "logic-members-panel");
      if (group.source) button.append(make("span", "logic-name-source", group.source));
      button.addEventListener("click", () => selectLogic(group.id)); name.append(button); tr.append(name);
      const days = make("td"); days.append(make("span", `logic-streak${!group.consecutive_days ? " inactive" : ""}`, `${group.consecutive_left_censored && group.consecutive_days > 0 ? "≥" : ""}${fmt(group.consecutive_days, 0)}`), make("span", "logic-days-unit", "天")); tr.append(days);
      ["today_count", "active_days", "member_count"].forEach(key => {const td = make("td", key === "today_count" && group[key] > 0 ? "positive" : "", `${fmt(group[key], 0)}${key === "active_days" ? " 天" : " 只"}`); tr.append(td);});
      tr.append(make("td", "", group.last_seen || "—"));
      const action = make("td"), open = make("button", "logic-open-button", state.logicSelected === group.id ? "▴" : "▾"); open.type = "button"; open.setAttribute("aria-label", `查看${group.name}成分股`); open.setAttribute("aria-expanded", String(state.logicSelected === group.id)); open.setAttribute("aria-controls", "logic-members-panel"); open.addEventListener("click", () => selectLogic(group.id)); action.append(open); tr.append(action); body.append(tr);
      if (state.logicSelected === group.id) {
        const detailRow = make("tr", "logic-detail-row"), detailCell = make("td");
        detailCell.colSpan = 7;
        detailCell.append(membersPanel); detailRow.append(detailCell); body.append(detailRow);
      }
    });
    $("logic-page-description").textContent = groups.length ? `第 ${(state.logicPage - 1) * pageSize + 1}–${Math.min(state.logicPage * pageSize, groups.length)} 个逻辑` : "";
    $("logic-page-number").textContent = `${state.logicPage} / ${pages}`; $("logic-page-prev").disabled = state.logicPage === 1; $("logic-page-next").disabled = state.logicPage === pages;
    if (state.logicSelected) renderLogicMembers();
    else renderAiContext();
  }
  function selectLogic(id) {
    state.logicSelected = state.logicSelected === id ? null : id; state.logicActiveOnly = false; $("logic-active-only").checked = false;
    renderLogic();
    const trigger = Array.from($("logic-table-body").querySelectorAll(".logic-name-button")).find(button => button.dataset.logicId === id);
    if (trigger) trigger.focus({preventScroll: true});
  }
  function renderLogicMembers() {
    const group = state.logic.find(item => item.id === state.logicSelected);
    $("logic-members-panel").hidden = !group; renderAiContext(); if (!group) return;
    $("logic-members-title").textContent = group.name;
    $("logic-members-window").textContent = `${state.logicMeta.window_start || state.meta.start_date || ""} → ${state.meta.date}`;
    $("logic-members-description").textContent = `连续发酵 ${group.consecutive_left_censored && group.consecutive_days > 0 ? "≥" : ""}${fmt(group.consecutive_days, 0)} 天 · 当日 ${fmt(group.today_count, 0)} 只涨停 · 历史 ${fmt(group.member_count, 0)} 只参与${group.first_seen ? ` · 窗口内首次 ${group.first_seen}` : ""}${group.source ? ` · ${group.source}` : ""}`;
    const members = sortLogicMembers(group.members, state.logicActiveOnly);
    $("logic-member-count").textContent = `显示 ${members.length} / ${group.members.length} 只`;
    $("logic-member-empty").hidden = Boolean(members.length);
    const body = $("logic-member-body"); body.replaceChildren();
    members.forEach(row => {
      const tr = make("tr"), name = make("td"), button = make("button", "stock-button"); button.type = "button";
      const label = make("span"); label.append(make("span", "stock-name", row.name), make("span", "stock-symbol", `${row.ts_code.split(".")[0]} · ${row.board}`)); button.append(label); button.setAttribute("aria-label", `${row.name}，查看截至${state.meta.date}的原因与行情`); button.addEventListener("click", () => openStock(row, button)); const stockActions = make("div", "stock-actions"); stockActions.append(button, makeAiReasonButton(row)); name.append(stockActions); tr.append(name);
      const status = make("td"); status.append(make("span", `logic-active-badge${row.active_today ? "" : " history"}`, row.active_today ? "当日活跃" : "历史参与")); tr.append(status, make("td", "", row.latest_logic_date || "—"));
      const days = make("td", "", `${row.logic_dates.length} 天`); days.title = row.logic_dates.join("、"); tr.append(days);
      tr.append(make("td", tone(row.pct_chg), signed(row.pct_chg)));
      const event = row.logic_reason_events[0], reason = make("td"); reason.append(make("span", "", event ? event.reason : `该日涨停原因提及“${group.name}”`), make("span", "reason-meta", `${event ? event.date : row.latest_logic_date || "日期未提供"} · ${event && event.source || group.source || "来源未提供"}`)); tr.append(reason); body.append(tr);
    });
  }
  function openColumnFilter(column, trigger) {
    closeColumnFilter(false); state.column = column; state.columnTrigger = trigger; trigger.setAttribute("aria-expanded", "true");
    $("column-filter-title").textContent = `${column.label}${column.unit ? `（${column.unit}）` : ""}`;
    const fields = $("column-filter-fields"); fields.replaceChildren(); const filter = state.filters.columns[column.key] || {};
    const definitions = column.type === "number" ? [["min", "最小值", "不限"], ["max", "最大值", "不限"]] : [["text", "包含文字", "输入关键字"]];
    definitions.forEach(([key, label, placeholder]) => {const wrap = make("label", "filter-field", label), input = make("input"); input.name = key; input.type = column.type === "number" ? "number" : "text"; if (input.type === "number") input.step = "any"; input.placeholder = placeholder; input.value = filter[key] === null || filter[key] === undefined ? "" : filter[key]; wrap.append(input); fields.append(wrap);});
    const popover = $("column-filter-popover"); popover.hidden = false;
    const bounds = trigger.getBoundingClientRect(), width = popover.offsetWidth, height = popover.offsetHeight;
    popover.style.left = `${Math.max(10, Math.min(window.innerWidth - width - 10, bounds.right - width))}px`;
    popover.style.top = `${Math.max(10, Math.min(window.innerHeight - height - 10, bounds.bottom + 8))}px`;
    fields.querySelector("input").focus();
  }
  function closeColumnFilter(restore = true) {
    $("column-filter-popover").hidden = true;
    if (state.columnTrigger) {state.columnTrigger.setAttribute("aria-expanded", "false"); if (restore && state.columnTrigger.isConnected) state.columnTrigger.focus();}
    state.column = null; state.columnTrigger = null;
  }
  function applyColumnFilter(event) {
    event.preventDefault(); if (!state.column) return;
    const form = new FormData(event.target), column = state.column;
    if (column.type === "number") {
      const min = numeric(form.get("min")), max = numeric(form.get("max"));
      if (min !== null && max !== null && min > max) {
        let error = $("column-filter-fields").querySelector(".filter-error");
        if (!error) {error = make("p", "filter-error"); error.setAttribute("role", "alert"); $("column-filter-fields").append(error);} error.textContent = "最小值不能大于最大值。"; return;
      }
      if (min === null && max === null) delete state.filters.columns[column.key]; else state.filters.columns[column.key] = {min, max};
    } else {const text = String(form.get("text") || "").trim(); if (text) state.filters.columns[column.key] = {text}; else delete state.filters.columns[column.key];}
    closeColumnFilter(); state.page = 1; render();
  }
  function syncHistoryControls() {
    const index = state.dates.indexOf(state.requestedDate);
    $("date-select").value = state.requestedDate; $("date-select").disabled = !state.dates.length;
    $("date-prev").disabled = index < 0 || index >= state.dates.length - 1;
    $("date-next").disabled = index <= 0;
    $("date-latest").disabled = !state.latestDate || state.requestedDate === state.latestDate;
    $("history-count").textContent = state.dates.length ? `最近 ${state.dates.length} 个交易日` : "历史索引暂不可用";
  }
  async function loadHistory() {
    try {
      const history = normalizeHistory(await getJson("/api/market-leaders/history"));
      state.dates = history.dates; state.latestDate = history.latest_date;
      $("date-select").replaceChildren(...state.dates.map(date => new Option(`${date}${date === state.latestDate ? " · 最新" : ""}`, date)));
      const queryDate = new URLSearchParams(location.search).get("date");
      await loadScreen(state.dates.includes(queryDate) ? queryDate : state.latestDate);
    } catch (error) {
      if (accessMessage(error.status)) {setScreenError(error); return;}
      $("history-status").textContent = "历史日期索引未取得，先展示最新快照。";
      await loadScreen("");
    }
  }
  async function loadScreen(date = state.requestedDate) {
    const requestId = ++state.screenRequestId;
    if (state.screenController) state.screenController.abort(); state.screenController = new AbortController();
    state.requestedDate = date || ""; state.loading = true; state.screenError = ""; state.screenStatus = 0; syncAiDate(date || "");
    $("access-notice").hidden = true;
    state.ladder = []; state.leaders = []; state.unknown = []; state.logic = []; state.logicSelected = null; state.logicPage = 1; state.page = 1;
    state.opener = null; if ($("stock-dialog").open) $("stock-dialog").close(); afterCloseStock(); closeColumnFilter(false);
    parkLogicMembers();
    $("table-body").replaceChildren(); $("logic-table-body").replaceChildren(); $("logic-member-body").replaceChildren();
    ["stat-limit", "stat-height", "stat-return", "stat-reasons", "ladder-count", "leaders-count", "logic-count"].forEach(id => {$(id).textContent = "—";});
    ["stat-limit-note", "stat-height-note", "stat-return-note", "stat-reasons-note"].forEach(id => {$(id).textContent = "正在加载所选日期";});
    $("snapshot-date").textContent = date || "—"; $("snapshot-note").textContent = "正在读取历史快照"; $("history-status").textContent = "正在读取所选交易日…";
    syncHistoryControls(); render();
    try {
      const payload = await getJson(`/api/market-leaders${date ? `?date=${encodeURIComponent(date)}` : ""}`, state.screenController.signal);
      if (requestId !== state.screenRequestId) return;
      if (!payload.meta || !ISO_DATE.test(payload.meta.date || "") || !Array.isArray(payload.ladder) || !Array.isArray(payload.leaders)) throw new Error("市场快照格式不完整，暂时无法展示。");
      if (date && payload.meta.date !== date) throw new Error(`返回快照 ${payload.meta.date} 与所选日期 ${date} 不一致，未显示。`);
      const unique = list => {const seen = new Set(); return list.map(row => rowAsOf(row, payload.meta.date)).filter(row => row && !seen.has(row.ts_code) && seen.add(row.ts_code));};
      state.meta = payload.meta; state.ladder = unique(payload.ladder); state.leaders = selectLeaders(unique(payload.leaders), state.ladder); state.unknown = unique(Array.isArray(payload.unknown_streak) ? payload.unknown_streak : []);
      state.logic = (payload.logic && Array.isArray(payload.logic.groups) ? payload.logic.groups : []).map(group => normalizeLogicGroup(group, state.meta.date)).filter(Boolean); state.logicMeta = payload.logic && payload.logic.meta || {};
      state.requestedDate = state.meta.date; state.loading = false; syncAiDate(state.meta.date);
      if (!state.dates.length) {state.dates = [state.meta.date]; state.latestDate = state.meta.date; $("date-select").replaceChildren(new Option(state.meta.date, state.meta.date));}
      syncHistoryControls(); $("history-status").textContent = `${state.meta.date === state.latestDate ? "最新收盘快照" : "历史收盘快照"} · 原因与行情截至所选日`;
      const currentUrl = new URL(location.href); currentUrl.searchParams.set("date", state.meta.date); root.history.replaceState(null, "", currentUrl);
      $("snapshot-date").textContent = state.meta.date; $("snapshot-note").textContent = `${fmt(numeric(state.meta.universe_count), 0)} 只全市场股票 · 非实时`;
      $("ladder-count").textContent = state.ladder.length; $("leaders-count").textContent = state.leaders.length; $("logic-count").textContent = state.logic.length;
      $("stat-limit").textContent = fmt(numeric(state.meta.limit_count) ?? state.ladder.length, 0);
      $("stat-limit-note").textContent = `全市场 · 包含 ST · ${state.ladder.length} 只已分组`;
      const highest = Math.max(0, ...state.ladder.map(row => row.streak || 0));
      $("stat-height").textContent = highest || "—"; $("stat-height-note").textContent = highest ? state.ladder.filter(row => row.streak === highest).map(row => row.name).join(" · ") : "暂无可确认的连板记录";
      const strongest = filterAndSort([...state.ladder, ...state.leaders], {}, {key: "return30_pct", direction: "desc"})[0];
      $("stat-return").textContent = strongest ? fmt(strongest.return30_pct) : "—"; $("stat-return").parentElement.className = `stat-value ${strongest ? tone(strongest.return30_pct) : ""}`;
      $("stat-return-note").textContent = strongest ? `${strongest.name} · ${strongest.ts_code.split(".")[0]}` : "暂无可用区间数据";
      const covered = state.ladder.filter(row => row.reason && row.reason_source && row.reason_date === state.meta.date).length;
      $("stat-reasons").textContent = state.ladder.length ? fmt(covered / state.ladder.length * 100, 0) : "—"; $("stat-reasons-note").textContent = `${covered} / ${state.ladder.length} 只 · 取得当日有源原因`;
      if (state.meta.streak_note) $("streak-note").textContent = state.meta.streak_note;
      const start = ISO_DATE.test(state.meta.start_date || "") ? `${state.meta.start_date} → ${state.meta.date}。` : "";
      $("return-note").textContent = `${start}按前复权收盘价计算最近 30 个交易日区间收益；排除连板单元全部股票，再取前 50 名。筛选仅缩小这 50 只，不补位。`;
      $("data-note").textContent = `${state.meta.data_note || "原因来自数据源题材归因与文字记录，不代表已证实的价格因果关系。"} 当前为选股观察功能，尚未进行策略收益回测。`;
      render();
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.screenRequestId) return;
      setScreenError(error);
    }
  }
  function openStock(row, opener) {
    closeColumnFilter(false); state.selected = row; state.opener = opener; state.kind = "daily"; state.chartPayload = null;
    $("chart-stock-name").textContent = row.name; $("chart-stock-code").textContent = row.ts_code; $("chart-board").textContent = row.board;
    $("chart-streak").textContent = row.streak > 0 ? row.streak === 1 ? "首板" : `${row.streak} 连板` : state.view === "logic" ? "逻辑参与股票" : "30 日涨幅榜";
    $("chart-close").textContent = fmt(row.close); $("chart-close").className = tone(row.pct_chg); $("chart-change").textContent = signed(row.pct_chg); $("chart-change").className = tone(row.pct_chg);
    $("chart-return").textContent = signed(row.return30_pct); $("chart-return").className = tone(row.return30_pct); $("chart-amount").textContent = `${fmt(row.amount_yi)} 亿元`; $("chart-snapshot-label").textContent = `${state.meta.date} 收盘快照`;
    $("reason-summary").textContent = row.reason || (row.streak > 0 ? "暂未取得该日涨停原因记录。" : "近30日未取得涨停原因记录。");
    $("reason-source").textContent = row.reason ? `${row.reason_date || "日期未提供"} · ${row.reason_source || "来源未提供"}${row.reason_date && row.reason_date !== state.meta.date ? " · 历史涨停记录，非当日归因" : ""}` : "未使用推测或题材标签填补缺失原因。";
    const evidenceNote = [row.reason_detail, /差异/.test(row.streak_evidence || "") ? row.streak_evidence : ""].filter(Boolean).join(" ");
    $("reason-detail").textContent = evidenceNote; $("reason-detail").hidden = !evidenceNote;
    $("reason-count").textContent = row.reason_events.length ? `${row.reason_events.length} 条来源记录` : "";
    const events = $("reason-events"); events.replaceChildren();
    row.reason_events.forEach(event => {const item = make("article", "reason-event"); item.append(make("strong", "", `${event.date || "日期未提供"} · ${event.source || "来源未提供"}`), make("p", "", event.reason || "该记录未提供原因说明")); if (event.detail && event.detail !== event.reason) item.append(make("p", "", event.detail)); if (event.status) item.append(make("span", "", `来源标签：${event.status}（不作为连续板数）`)); events.append(item);});
    $("reason-history").hidden = !row.reason_events.length; $("reason-history").open = false;
    const [code, market] = row.ts_code.split("."); $("external-quote").href = `https://quote.eastmoney.com/${market.toLowerCase()}${code}.html`;
    $("stock-dialog").showModal(); document.body.style.overflow = "hidden"; $("close-dialog").focus(); syncChartControls(); loadChart();
  }
  function afterCloseStock() {
    state.requestId++; if (state.chartController) state.chartController.abort(); state.chartController = null;
    if (state.chart) {state.chart.dispose(); state.chart = null;}
    state.chartPayload = null; state.selected = null; document.body.style.overflow = "";
    if (state.opener && state.opener.isConnected) state.opener.focus();
  }
  function syncChartControls() {
    document.querySelectorAll(".chart-tab").forEach(button => {const active = button.dataset.kind === state.kind; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));});
    $("chart-periods").hidden = state.kind !== "daily";
    $("chart-periods").querySelectorAll("button").forEach(button => {const active = Number(button.dataset.period) === state.period; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));});
  }
  async function loadChart(force = false) {
    if (!state.selected) return;
    const requestId = ++state.requestId, symbol = state.selected.ts_code, kind = state.kind, date = state.meta.date;
    if (state.chartController) state.chartController.abort(); state.chartController = new AbortController();
    state.chartPayload = null; $("stock-chart").hidden = true; $("chart-source").textContent = ""; $("chart-accessible-summary").textContent = "";
    showState($("chart-status"), kind === "daily" ? "正在读取日 K 线" : "正在读取分时数据", `${date} · ${symbol}`, null, true);
    try {
      const key = `${symbol}:${kind}:${date}`;
      const payload = !force && state.cache.has(key) ? state.cache.get(key) : await getJson(`/api/market-leaders/chart/${encodeURIComponent(symbol)}?kind=${kind}&date=${encodeURIComponent(date)}`, state.chartController.signal);
      if (requestId !== state.requestId || !$("stock-dialog").open) return;
      if (payload.ts_code && payload.ts_code !== symbol) throw new Error("返回行情与所选股票不一致，未显示。");
      const bars = validateBars(payload, kind, date); state.cache.set(key, payload); state.chartPayload = {...payload, bars};
      $("chart-source").textContent = [payload.source || "来源未提供", payload.as_of ? `截至 ${payload.as_of}` : `日期 ${payload.date || date}`, kind === "daily" ? payload.adjustment : "成交量单位：股"].filter(Boolean).join(" · ");
      if (!bars.length) {showState($("chart-status"), kind === "intraday" ? "该日分时暂不可用" : "暂未取得日线", payload.message || "数据源未提供所选日期行情，可通过下方链接查看可用行情。", () => loadChart(true)); return;}
      renderChart();
    } catch (error) {if (error.name !== "AbortError" && requestId === state.requestId && $("stock-dialog").open) showState($("chart-status"), "暂时无法读取行情", error.message, () => loadChart(true));}
  }
  function renderChart() {
    const payload = state.chartPayload;
    if (!payload || !payload.bars.length || !state.selected || !$("stock-dialog").open) return;
    if (!root.echarts) {showState($("chart-status"), "图表组件暂未加载", "请刷新后重试，也可通过下方链接查看个股行情。", () => location.reload()); return;}
    const kind = state.kind, all = payload.bars, bars = kind === "daily" ? all.slice(-state.period) : all, offset = all.length - bars.length;
    const times = bars.map(bar => kind === "daily" ? bar.time : (bar.time.match(/(\d{2}:\d{2})(?::\d{2})?$/) || [bar.time, bar.time])[1]);
    $("chart-status").hidden = true; $("stock-chart").hidden = false;
    if (!state.chart) state.chart = root.echarts.init($("stock-chart"), null, {renderer: "canvas"});
    const up = "#d85b57", down = "#2f937b", axis = "#a1aab6", grid = "#f0f2f5", small = window.innerWidth < 600, series = [];
    if (kind === "daily") {
      series.push({name: "日K", type: "candlestick", data: bars.map(bar => [bar.open, bar.close, bar.low, bar.high]), itemStyle: {color: up, color0: down, borderColor: up, borderColor0: down}});
      [5, 10, 20].forEach((length, index) => series.push({name: `MA${length}`, type: "line", data: movingAverage(all, length).slice(offset), showSymbol: false, connectNulls: false, lineStyle: {width: 1, color: ["#c39a50", "#9180b1", "#619da5"][index]}, itemStyle: {color: ["#c39a50", "#9180b1", "#619da5"][index]}}));
    } else {
      series.push({name: "分时价格", type: "line", data: bars.map(bar => bar.close), showSymbol: false, lineStyle: {width: 1.5, color: "#5d819c"}, itemStyle: {color: "#5d819c"}, areaStyle: {color: "rgba(93,129,156,.06)"}});
      if (numeric(payload.pre_close) > 0) series[0].markLine = {silent: true, symbol: "none", lineStyle: {color: "#b7c0ca", type: "dashed", width: 1}, label: {formatter: "昨收", fontSize: 9, color: axis, position: "insideEndTop"}, data: [{yAxis: Number(payload.pre_close)}]};
    }
    series.push({name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: kind === "daily" ? 8 : 3, data: bars.map((bar, i) => ({value: bar.volume, itemStyle: {color: bar.close >= (kind === "daily" ? bar.open : i ? bars[i - 1].close : numeric(payload.pre_close) || bar.close) ? up : down, opacity: .6}}))});
    state.chart.setOption({animation: false, textStyle: {fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif'},
      legend: {show: kind === "daily", top: 10, left: 20, data: ["MA5", "MA10", "MA20"], itemWidth: 13, itemHeight: 2, textStyle: {fontSize: 10, color: axis}},
      tooltip: {trigger: "axis", confine: true, transitionDuration: 0, axisPointer: {type: "cross", label: {backgroundColor: "#7b8899", precision: 2}}, backgroundColor: "rgba(255,255,255,.97)", borderColor: "#e4e7eb", textStyle: {fontSize: 10, color: "#657181"}, formatter: params => {
        const bar = params.length && bars[params[0].dataIndex]; if (!bar) return "";
        const box = make("div"); box.style.cssText = "font-size:11px;line-height:1.8;min-width:130px"; box.append(make("strong", "", bar.time));
        (kind === "daily" ? [["开", bar.open], ["收", bar.close], ["高", bar.high], ["低", bar.low]] : [["价格", bar.close]]).forEach(([label, value]) => box.append(make("div", "", `${label}  ${fmt(value)}`)));
        box.append(make("div", "", `成交量  ${fmt(bar.volume / 10000)} 万股`)); return box;
      }}, axisPointer: {link: [{xAxisIndex: "all"}]},
      grid: [{left: small ? 48 : 62, right: small ? 18 : 30, top: 43, height: "55%"}, {left: small ? 48 : 62, right: small ? 18 : 30, top: "73%", height: "16%"}],
      xAxis: [{type: "category", data: times, gridIndex: 0, boundaryGap: kind === "daily", axisLine: {show: false}, axisTick: {show: false}, axisLabel: {show: false}}, {type: "category", data: times, gridIndex: 1, boundaryGap: kind === "daily", axisLine: {lineStyle: {color: grid}}, axisTick: {show: false}, axisLabel: {fontSize: 9, color: axis, hideOverlap: true, formatter: value => kind === "daily" ? value.slice(5) : value}}],
      yAxis: [{scale: true, gridIndex: 0, splitNumber: 4, axisLabel: {fontSize: 9, color: axis, formatter: value => Number(value).toFixed(2)}, axisLine: {show: false}, axisTick: {show: false}, splitLine: {lineStyle: {color: grid, type: "dashed"}}}, {scale: true, min: 0, gridIndex: 1, splitNumber: 2, axisLabel: {fontSize: 9, color: axis, formatter: value => value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿` : `${Math.round(value / 1e4)}万`}, axisLine: {show: false}, axisTick: {show: false}, splitLine: {show: false}, name: "股", nameGap: 7, nameTextStyle: {fontSize: 9, color: axis}}],
      dataZoom: kind === "daily" ? [{type: "inside", xAxisIndex: [0, 1], start: 0, end: 100, minValueSpan: 8, zoomOnMouseWheel: false, moveOnMouseWheel: false}] : [], series}, true);
    state.chart.resize(); const last = bars[bars.length - 1];
    const summary = `${state.selected.name}，截至 ${state.meta.date} 的${kind === "daily" ? "日K线" : "分时"}，显示 ${bars.length} 个数据点。最后 ${last.time}，价格 ${fmt(last.close)} 元。`;
    $("stock-chart").setAttribute("aria-label", summary); $("chart-accessible-summary").textContent = summary;
  }
  document.querySelectorAll(".panel-tab").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.view));
    button.addEventListener("keydown", event => {if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {event.preventDefault(); const views = ["ladder", "leaders", "logic"], index = views.indexOf(state.view); const view = event.key === "Home" ? views[0] : event.key === "End" ? views[2] : views[(index + (event.key === "ArrowLeft" ? 2 : 1)) % 3]; setView(view); $(`${view}-tab`).focus();}});
  });
  $("date-select").addEventListener("change", event => {if (state.dates.includes(event.target.value)) loadScreen(event.target.value);});
  $("date-prev").addEventListener("click", () => {const next = state.dates[state.dates.indexOf(state.requestedDate) + 1]; if (next) loadScreen(next);});
  $("date-next").addEventListener("click", () => {const next = state.dates[state.dates.indexOf(state.requestedDate) - 1]; if (next) loadScreen(next);});
  $("date-latest").addEventListener("click", () => {if (state.latestDate) loadScreen(state.latestDate);});
  $("logic-search").addEventListener("input", event => {state.logicFilters.query = event.target.value; state.logicPage = 1; renderLogic();});
  $("logic-min-days").addEventListener("input", event => {state.logicFilters.minDays = numeric(event.target.value); state.logicPage = 1; renderLogic();});
  $("logic-min-count").addEventListener("input", event => {state.logicFilters.minCount = numeric(event.target.value); state.logicPage = 1; renderLogic();});
  $("logic-only-active").addEventListener("change", event => {state.logicFilters.activeOnly = event.target.checked; state.logicPage = 1; renderLogic();});
  $("logic-reset").addEventListener("click", () => {state.logicFilters = {query: "", minDays: null, minCount: null, activeOnly: false}; state.logicPage = 1; ["logic-search", "logic-min-days", "logic-min-count"].forEach(id => {$(id).value = "";}); $("logic-only-active").checked = false; renderLogic();});
  document.querySelectorAll(".logic-sort").forEach(button => button.addEventListener("click", () => {state.logicSorting = {key: button.dataset.sort, direction: state.logicSorting.key === button.dataset.sort && state.logicSorting.direction === "desc" ? "asc" : "desc"}; state.logicPage = 1; renderLogic();}));
  $("logic-page-prev").addEventListener("click", () => {state.logicPage--; renderLogic();});
  $("logic-page-next").addEventListener("click", () => {state.logicPage++; renderLogic();});
  $("logic-members-close").addEventListener("click", () => {if (state.logicSelected) selectLogic(state.logicSelected);});
  $("logic-active-only").addEventListener("change", event => {state.logicActiveOnly = event.target.checked; renderLogicMembers();});
  $("stock-search").addEventListener("input", event => {state.filters.query = event.target.value; state.page = 1; render();});
  $("board-select").addEventListener("change", event => {state.filters.board = event.target.value; state.page = 1; render();});
  $("exclude-st").addEventListener("change", event => {state.filters.excludeST = event.target.checked; state.page = 1; render();});
  $("reset-filters").addEventListener("click", resetFilters);
  $("page-prev").addEventListener("click", () => {state.page--; render(); $("table-scroll").scrollTop = 0;});
  $("page-next").addEventListener("click", () => {state.page++; render(); $("table-scroll").scrollTop = 0;});
  $("export-csv").addEventListener("click", () => {if (!state.filtered.length) return; const url = URL.createObjectURL(new Blob([makeCsv(state.filtered, state.meta.date)], {type: "text/csv;charset=utf-8;"})), link = make("a"); link.href = url; link.download = `${state.view === "ladder" ? "连板梯队" : "30日涨幅榜"}_${state.meta.date}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);});
  $("column-filter-form").addEventListener("submit", applyColumnFilter); $("close-column-filter").addEventListener("click", () => closeColumnFilter());
  $("clear-column-filter").addEventListener("click", () => {if (state.column) delete state.filters.columns[state.column.key]; closeColumnFilter(); state.page = 1; render();});
  document.addEventListener("pointerdown", event => {if (state.column && !$("column-filter-popover").contains(event.target) && !state.columnTrigger.contains(event.target)) closeColumnFilter(false);});
  document.addEventListener("keydown", event => {if (!state.column) return; if (event.key === "Escape") {event.preventDefault(); closeColumnFilter();} if (event.key === "Tab") {const items = [...$("column-filter-popover").querySelectorAll("button,input")], first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();} else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}}});
  $("table-scroll").addEventListener("scroll", () => {if (state.column) closeColumnFilter(false);});
  window.addEventListener("scroll", () => {if (state.column) closeColumnFilter(false);}, {passive: true});
  $("close-dialog").addEventListener("click", () => $("stock-dialog").close()); $("stock-dialog").addEventListener("close", afterCloseStock);
  $("stock-dialog").addEventListener("click", event => {if (event.target === $("stock-dialog")) {const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();}});
  document.querySelectorAll(".chart-tab").forEach(button => button.addEventListener("click", () => {if (state.kind !== button.dataset.kind) {state.kind = button.dataset.kind; syncChartControls(); loadChart();}}));
  $("chart-periods").querySelectorAll("button").forEach(button => button.addEventListener("click", () => {state.period = Number(button.dataset.period); syncChartControls(); renderChart();}));
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {if (state.chart && $("stock-dialog").open && !$("stock-chart").hidden) state.chart.resize();}).observe($("stock-chart"));
  window.addEventListener("resize", () => {if (state.column) closeColumnFilter(false); if (state.chart && $("stock-dialog").open) state.chart.resize();});
  $("ai-config-toggle").addEventListener("click", () => {revealAssistant(); toggleAiConfig($("ai-config").hidden);});
  $("ai-config").addEventListener("submit", saveAiConfig); $("ai-delete-config").addEventListener("click", deleteAiConfig);
  $("ai-model").addEventListener("change", event => {ai.draftModel = event.target.value; $("ai-config-status").textContent = ai.draftModel === ai.model ? "" : "模型尚未保存，请点击保存配置。"; renderAiConfig();});
  $("ai-chat-form").addEventListener("submit", sendAiMessage); $("ai-clear-chat").addEventListener("click", () => clearAiConversation());
  $("ai-web-search").addEventListener("change", event => {ai.webSearch = event.target.checked;});
  $("ai-context-reset").addEventListener("click", () => clearAiConversation(null));
  $("ai-chat-input").addEventListener("keydown", event => {if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {event.preventDefault(); sendAiMessage();}});
  $("ai-mobile-toggle").addEventListener("click", revealAssistant); $("ai-mobile-close").addEventListener("click", hideAssistant); $("ai-backdrop").addEventListener("click", hideAssistant);
  document.addEventListener("keydown", event => {if (event.key === "Escape" && document.body.classList.contains("ai-sidebar-open") && !$("stock-dialog").open) {hideAssistant(); $("ai-mobile-toggle").focus();}});
  window.matchMedia("(max-width: 1100px)").addEventListener("change", event => {if (!event.matches) hideAssistant();});
  buildHeaders(); buildGroups(); loadHistory(); loadAiConfig();
})(typeof globalThis !== "undefined" ? globalThis : this);

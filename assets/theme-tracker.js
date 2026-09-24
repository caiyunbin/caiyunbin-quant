(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  };
  const ns = "http://www.w3.org/2000/svg";
  const state = { data: null, date: "", latestDate: "", dates: [], selectedTheme: null, view: "themes", attention: null, requestId: 0, controller: null };
  const stageLabels = Object.freeze({
    "观察中": "题材萌芽", "题材萌芽": "题材萌芽", "普通观察": "初级发酵", "初级发酵": "初级发酵",
    "扩散观察": "中级发酵", "中级发酵": "中级发酵",
    "主线候选": "主线进行", "主线进行": "主线进行", "降温观察": "主线退潮", "主线退潮": "主线退潮",
    "数据不足": "数据不足"
  });
  const stageNames = new Set(Object.keys(stageLabels));
  const stageOrder = Object.freeze(["题材萌芽", "初级发酵", "中级发酵", "主线进行", "主线退潮"]);
  const isVisibleStageChange = (change) => {
    if (!change || typeof change !== "object") return false;
    if (change.type === "removed") return true;
    const before = stageOrder.indexOf(stageLabels[change.previous_stage]);
    const after = stageOrder.indexOf(stageLabels[change.stage]);
    if (after < 0) return false;
    if (change.type === "new") return !change.previous_stage || change.previous_stage === "未出现";
    return change.type === "changed" && before >= 0 && after > before;
  };
  const themeStageChange = (theme) => {
    const change = theme && theme.stage_change;
    return change && change.type !== "removed" && isVisibleStageChange(change)
      && stageLabels[change.stage] === stageLabels[theme.stage] ? change : null;
  };
  const finite = (value) => {
    if (value === null || value === undefined || typeof value === "boolean" || (typeof value === "string" && value.trim() === "")) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const numberText = (value, digits) => {
    const number = finite(value);
    return number === null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits === undefined ? 1 : digits, minimumFractionDigits: 0 });
  };
  const signedPct = (value) => {
    const number = finite(value);
    return number === null ? "—" : `${number > 0 ? "+" : ""}${numberText(number, 1)}%`;
  };
  const pctValue = finite;
  const pctText = (value) => {
    const number = pctValue(value);
    return number === null ? "—" : `${numberText(number, 1)}%`;
  };
  const scoreValue = (theme) => finite(theme && theme.score);
  const stageFor = (theme) => {
    const stage = theme && stageLabels[String(theme.stage)];
    if (stage && stageNames.has(stage)) return stage;
    return "数据不足";
  };
  const trustedDomains = ["xueqiu.com", "eastmoney.com", "cninfo.com.cn", "sse.com.cn", "szse.cn", "bse.cn", "cls.cn", "stcn.com", "cnstock.com", "cs.com.cn", "10jqka.com.cn", "sina.com.cn", "sina.cn", "gov.cn", "yicai.com", "thepaper.cn", "stockstar.com", "jrj.com.cn"];
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ""));
      const trusted = trustedDomains.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
      return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && trusted ? url.href : "";
    } catch (_) { return ""; }
  };
  const request = async (url, signal) => {
    const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) { const error = new Error("数据暂不可用"); error.status = response.status; throw error; }
    const payload = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("invalid response");
    return payload;
  };
  const showStatus = (kind, title, detail) => {
    const target = $("theme-status");
    target.className = `theme-state is-${kind}`;
    while (target.firstChild) target.removeChild(target.firstChild);
    if (kind === "loading") target.append(make("span", "theme-loader"));
    target.append(make("strong", "", title), make("p", "", detail));
    target.hidden = false;
    $("theme-content").hidden = true;
  };
  const showContent = () => { $("theme-status").hidden = true; $("theme-content").hidden = false; };
  const clear = (target) => { while (target.firstChild) target.removeChild(target.firstChild); };
  const setText = (id, value) => { const target = $(id); if (target) target.textContent = value === undefined || value === null || value === "" ? "—" : String(value); };
  const stateTone = (stage) => stage === "主线进行" ? "strong" : stage === "主线退潮" ? "cooling" : stage === "数据不足" ? "missing" : "watch";
  const stageBadge = (stage) => make("span", `theme-stage stage-${stateTone(stage)}`, stage);

  function renderMarket(data) {
    const market = data.market || {};
    setText("market-regime", market.regime || "数据不足");
    setText("market-regime-tone", state.date);
    $("market-regime-tone").className = `regime-tone ${market.regime ? "" : "is-missing"}`;
    setText("market-breadth", pctText(market.breadth_pct));
    setText("market-index-return", signedPct(market.index_return5_pct));
    setText("market-limit-count", numberText(market.limit_count, 0));
    setText("market-note", market.note || "当前市场读数以题材计算日为准。");
    const meta = data.meta || {};
    const sourceDates = meta.source_dates || {};
    const sourceBits = [];
    if (sourceDates.prices) sourceBits.push(`行情 ${sourceDates.prices}`);
    if (sourceDates.funds) sourceBits.push(`资金 ${sourceDates.funds}`);
    if (sourceDates.labels) sourceBits.push(`标签 ${sourceDates.labels}`);
    setText("theme-source-note", sourceBits.length ? `来源日期：${sourceBits.join(" · ")}` : "来源日期暂不可用。");
    setText("theme-score-note", meta.score_note || "0–100 分表达观察强度，不是上涨概率、胜率或买卖建议。缺失指标显示为“—”。");
    setText("theme-temporal-note", meta.temporal_note || "历史记录仅展示对应计算日可用的归档信息。");
    const methods = $("theme-methodology-list"); clear(methods);
    (Array.isArray(data.methodology) ? data.methodology : []).forEach((method) => {
      methods.append(make("p", "theme-method-item", `${method.name || "分项"}${finite(method.weight) === null ? "" : ` · 权重 ${numberText(method.weight, 0)}%`}：${method.description || "说明暂缺"}`));
    });
    const leading = (Array.isArray(data.themes) ? data.themes : []).find((theme) => scoreValue(theme) !== null);
    setText("theme-focus-name", leading ? leading.name : "暂无可用题材");
    const focusMetrics = $("theme-focus-metrics"); clear(focusMetrics);
    if (leading) focusMetrics.append(stageBadge(stageFor(leading)), make("strong", "", `${numberText(leading.score, 1)} 分`));
    setText("theme-focus-note", leading ? `${numberText(leading.member_count, 0)} 只成员 · 5 日相对强度 ${signedPct(leading.rs5_pct)}` : "数据到达后将在这里呈现。");
    $("theme-focus-open").disabled = !leading;
    $("theme-focus-open").onclick = leading ? () => showDetail(leading) : null;
    setText("theme-snapshot-date", state.date || meta.date || "—");
    setText("theme-snapshot-note", state.date === state.latestDate ? "最新题材快照" : "历史题材计算日");
    setText("theme-tracker-title", state.date === state.latestDate ? "最新观察" : "历史观察");
    setText("theme-date-note", state.date === state.latestDate ? `最新计算日 · ${state.date || "—"}` : `题材计算日期 · ${state.date || "—"}；历史视图不含当前人气`);
  }

  function renderDateSelect(meta) {
    const dates = Array.isArray(meta.dates) ? meta.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))) : [];
    if (dates.length) state.dates = [...new Set(dates)].sort().reverse();
    if (state.dates.length) state.latestDate = state.dates[0];
    if (!state.latestDate) state.latestDate = String(meta.date || "");
    if (!state.date) state.date = String(meta.date || state.dates[0] || "");
    const select = $("theme-date-select");
    clear(select);
    if (!state.dates.length && state.date) state.dates = [state.date];
    state.dates.forEach((date) => {
      const option = make("option", "", date); option.value = date; option.selected = date === state.date; select.append(option);
    });
    select.disabled = state.dates.length < 2;
  }

  function renderThemeCard(theme, index) {
    const article = make("article", "theme-row");
    if (themeStageChange(theme)) article.classList.add("is-stage-changed");
    const open = make("button", "theme-row-main"); open.type = "button"; open.setAttribute("aria-label", `查看${theme.name || "题材"}详情`);
    const title = make("div", "theme-row-title");
    title.append(make("span", "theme-rank", finite(theme.rank) === null ? "—" : String(theme.rank).padStart(2, "0")), make("span", "theme-name", theme.name || "未命名题材"), stageBadge(stageFor(theme)));
    const score = make("div", "theme-score"); score.append(make("strong", "", numberText(theme.score, 1)), make("span", "", "观察强度"));
    open.append(title, score);
    const metrics = make("div", "theme-row-metrics");
    [["5日相对", signedPct(theme.rs5_pct)], ["广度", pctText(theme.breadth_pct)], ["成员", numberText(theme.member_count, 0)], ["涨停", numberText(theme.limit_count, 0)]].forEach(([label, value]) => { const item = make("span", "theme-metric"); item.append(make("small", "", label), make("b", "", value)); metrics.append(item); });
    const bar = make("div", "theme-score-bar"); const fill = make("span"); const scoreNumber = scoreValue(theme); fill.style.width = `${scoreNumber === null ? 0 : Math.max(0, Math.min(100, scoreNumber))}%`; bar.append(fill);
    open.append(metrics, bar); open.setAttribute("aria-expanded", String(Boolean(state.selectedTheme && state.selectedTheme.id === theme.id))); open.setAttribute("aria-controls", "theme-detail"); open.addEventListener("click", () => showDetail(theme)); article.append(open); return article;
  }

  function matchesTheme(theme, query, stage) {
    if (stage && stageFor(theme) !== stage) return false;
    if (!query) return true;
    const needle = query.toLowerCase();
    return [theme.name, theme.id, ...(Array.isArray(theme.members) ? theme.members.flatMap((member) => [member.name, member.ts_code]) : [])].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
  }

  function renderThemes() {
    const target = $("theme-ranking"); clear(target);
    const themes = Array.isArray(state.data && state.data.themes) ? state.data.themes : [];
    const query = $("theme-search").value.trim(); const stage = $("theme-stage-filter").value;
    const filtered = themes.filter((theme) => matchesTheme(theme, query, stage));
    setText("theme-count", themes.length ? `${filtered.length}/${themes.length}` : "0"); $("theme-ranking-empty").hidden = filtered.length > 0;
    filtered.forEach((theme, index) => target.append(renderThemeCard(theme, index)));
  }

  function researchMoveStock(theme, member) {
    const change = themeStageChange(theme);
    const transition = change && change.type === "changed" ? `题材阶段由“${stageLabels[change.previous_stage]}”变为“${stageLabels[change.stage]}”。` : change && change.type === "new" ? `题材新进入观察池，当前阶段为“${stageFor(theme)}”。` : `当前题材阶段为“${stageFor(theme)}”，不预设它刚发生阶段变化。`;
    const question = `请分析${member.name || member.ts_code}（${member.ts_code}）在题材“${theme.name}”中的可能上涨原因。${transition}研究截止日为 ${state.date}，请优先查阅截止日之前近期公司公告、新闻及联网搜索结果，并核对关键来源和发布时间。请判断是否存在比“${theme.name}”更直接的概念催化（例如短剧概念），把公司公告明确证实、媒体报道、市场可能炒作但证据不足的逻辑分开；最多列出3个原因，逐项说明证据、日期、来源和关联程度，并列反证与不确定性。不能仅凭题材名称或股价上涨推断因果；截止日之后发布的消息不能解释当日上涨。`;
    const assistant = window.CaimanMarketLeaders;
    if (assistant && typeof assistant.askThemeReason === "function") {
      assistant.askThemeReason({name: member.name || member.ts_code, ts_code: member.ts_code, theme_name: theme.name || theme.id || "题材雷达", date: state.date, question});
    }
  }

  function renderThemeChanges(data) {
    const list = $("theme-changes-list"); clear(list);
    const comparison = data.meta && data.meta.stage_comparison || {};
    const changes = comparison.status === "ok" && Array.isArray(data.stage_changes) ? data.stage_changes.filter(isVisibleStageChange) : [];
    setText("theme-changes-note", comparison.status === "ok" ? `与 ${comparison.previous_date} 比较 · 仅展示阶段顺序推进与进出观察池，点击标签查看下方详情` : comparison.status === "no_previous_date" ? "该日期没有更早的可用题材快照" : "上一交易日快照不可用，无法可靠比较");
    setText("theme-changes-count", `${changes.length} 个题材`);
    $("theme-changes-empty").hidden = changes.length > 0;
    if (comparison.status !== "ok") { $("theme-changes-empty").hidden = true; list.append(make("p", "theme-changes-empty", comparison.status === "no_previous_date" ? "没有前一交易日可供比较。" : "比较数据暂不可用，不展示推测的状态变化。")); return; }
    if (!changes.length) $("theme-changes-empty").hidden = false;
    const currentThemes = new Map((Array.isArray(data.themes) ? data.themes : []).map(theme => [theme.id, theme]));
    groupThemeChanges(changes).forEach((group) => {
      const article = make("section", "theme-transition-group"); article.setAttribute("aria-label", group.title);
      const heading = make("div", "theme-transition-heading");
      const title = make("h4", "", group.title);
      const transitionIcon = { 
        "题材萌芽 → 初级发酵": ["👑", "transition-icon-gold", "金皇冠：阶段首次形成有效扩散"],
        "初级发酵 → 主线进行": ["👑", "transition-icon-silver", "银皇冠：阶段扩散进入主线"],
        "主线进行 → 主线退潮": ["😈", "transition-icon-devil", "恶魔：主线退潮风险信号"]
      }[group.title];
      let icon = null;
      if (transitionIcon) {
        icon = make("span", `transition-icon ${transitionIcon[1]}`, transitionIcon[0]);
        icon.setAttribute("aria-hidden", "true"); icon.title = transitionIcon[2];
      }
      if (icon) title.append(icon);
      heading.append(title, make("span", "theme-transition-count", `${group.changes.length} 个题材`));
      const tags = make("div", "theme-transition-tags");
      group.changes.forEach((change) => {
        const button = make("button", "theme-transition-tag", change.name || change.id || "未命名题材"); button.type = "button";
        const current = change.type === "removed" ? null : currentThemes.get(change.id);
        if (current) {
          button.setAttribute("aria-controls", "theme-detail");
          button.setAttribute("aria-label", `查看${current.name || change.name || change.id}题材详情`);
          button.title = "展开并跳转到下方题材详情";
          button.addEventListener("click", () => {
            if (!matchesTheme(current, $("theme-search").value.trim(), $("theme-stage-filter").value)) {
              $("theme-search").value = ""; $("theme-stage-filter").value = ""; renderPopular();
            }
            showDetail(current);
          });
        } else {
          button.disabled = true; button.title = "当日观察池中无此题材，暂无可跳转的详情";
        }
        tags.append(button);
      });
      article.append(heading, tags);
      if (group.changes.some(change => change.type === "removed" || !currentThemes.has(change.id))) {
        article.append(make("p", "theme-transition-note", "灰色标签当日不在观察池中，暂无可跳转的详情。"));
      }
      list.append(article);
    });
  }

  function groupThemeChanges(changes) {
    const groups = new Map();
    changes.filter(isVisibleStageChange).forEach((change) => {
      const before = stageLabels[change.previous_stage];
      const after = stageLabels[change.stage];
      const removed = change.type === "removed", added = change.type === "new";
      const key = removed ? "removed" : JSON.stringify([added ? "new" : before, after]);
      if (!groups.has(key)) {
        const title = removed ? "退出观察池" : added ? `新进入 · ${after}` : `${before} → ${after}`;
        groups.set(key, {title, changes: [], order: removed ? 2 : added ? 1 : 0, before: removed || added ? stageOrder.length : stageOrder.indexOf(before), after: stageOrder.indexOf(after)});
      }
      groups.get(key).changes.push(change);
    });
    return [...groups.values()].sort((a, b) => a.order - b.order || a.before - b.before || a.after - b.after);
  }

  function appendResearchControl(parent, theme, member, className = "theme-member-ai-button") {
    const button = make("button", className, "可能原因"); button.type = "button"; button.disabled = !member.ts_code; button.title = "在右侧 DeepSeek 对话中查看研判与来源";
    button.addEventListener("click", () => researchMoveStock(theme, member));
    parent.append(button);
  }

  function stockName(member) { return member && (member.name || member.ts_code) || "未命名股票"; }
  function openMember(member) {
    if (!member || !member.ts_code) return;
    const row = Object.assign({}, member, { date: state.date });
    if (typeof window.openThemeStock === "function") { window.openThemeStock(row, state.date); return; }
    if (typeof window.openMarketStock === "function") { window.openMarketStock(member.ts_code, state.date, row); return; }
    const match = /^(\d{6})\.(SH|SZ|BJ)$/i.exec(String(member.ts_code));
    if (!match) return;
    const url = safeUrl(`https://quote.eastmoney.com/${match[2].toLowerCase()}${match[1]}.html`);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function renderPopular() {
    const target = $("popular-ranking"); clear(target);
    const rows = Array.isArray(state.data && state.data.popular_stocks) ? state.data.popular_stocks : [];
    const query = $("theme-search").value.trim().toLowerCase();
    const filtered = rows.filter((member) => !query || [member.name, member.ts_code, ...(Array.isArray(member.theme_names) ? member.theme_names : [])].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
    setText("popular-count", rows.length ? `${filtered.length}/${rows.length}` : "0"); $("popular-empty").hidden = filtered.length > 0;
    filtered.forEach((member, index) => {
      const article = make("article", "popular-row"); const button = make("button", "popular-row-main"); button.type = "button"; button.addEventListener("click", () => openMember(member));
      const title = make("div", "popular-title"); title.append(make("span", "theme-rank", String(member.rank || index + 1).padStart(2, "0")), make("span", "theme-name", stockName(member)), make("small", "theme-symbol", member.ts_code || "—"));
      const right = make("div", "popular-score"); right.append(make("strong", "", numberText(member.score, 1)), make("span", "", `题材 ${numberText(member.theme_score, 1)}`));
      const metrics = make("div", "popular-metrics"); [["当日", signedPct(member.pct_chg)], ["5日", signedPct(member.return5_pct)], ["主力", finite(member.main_net_wan) === null ? "—" : `${numberText(member.main_net_wan, 0)}万`]].forEach(([label, value]) => { const item = make("span", "theme-metric"); item.append(make("small", "", label), make("b", "", value)); metrics.append(item); });
      button.append(title, metrics, right); article.append(button); target.append(article);
    });
  }

  function renderSparkline(theme) {
    const target = $("theme-sparkline"); clear(target);
    const labels = $("theme-history-labels"); clear(labels);
    const history = Array.isArray(theme.history) ? theme.history.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")) && item.date <= state.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-5) : [];
    history.forEach((item) => labels.append(make("span", "", `${item.date} · ${numberText(item.score, 1)}${finite(item.rank) === null ? "" : ` · 第${numberText(item.rank, 0)}名`}`)));
    if (!history.some((item) => finite(item.score) !== null)) { target.append(make("p", "theme-empty-inline", "暂无近 5 日轨迹")); return; }
    const width = 420; const height = 120; const pad = 14;
    const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `近五日观察强度，纵轴0至100：${history.map((item) => `${item.date} ${numberText(item.score, 1)}`).join("；")}`);
    const drawSegment = (points) => {
      if (points.length < 2) return;
      const line = document.createElementNS(ns, "polyline"); line.setAttribute("points", points.join(" ")); line.setAttribute("fill", "none"); line.setAttribute("stroke", "#9a793d"); line.setAttribute("stroke-width", "3"); line.setAttribute("stroke-linecap", "round"); line.setAttribute("stroke-linejoin", "round"); svg.append(line);
    };
    let segment = [];
    history.forEach((item, index) => {
      const score = finite(item.score);
      if (score === null) { drawSegment(segment); segment = []; return; }
      const x = pad + (width - pad * 2) * (history.length === 1 ? .5 : index / (history.length - 1));
      const y = height - pad - Math.max(0, Math.min(100, score)) / 100 * (height - pad * 2);
      segment.push(`${x},${y}`);
      const circle = document.createElementNS(ns, "circle"); circle.setAttribute("cx", String(x)); circle.setAttribute("cy", String(y)); circle.setAttribute("r", "4"); circle.setAttribute("fill", "#fffdf7"); circle.setAttribute("stroke", "#9a793d"); circle.setAttribute("stroke-width", "2");
      const title = document.createElementNS(ns, "title"); title.textContent = `${item.date} · ${numberText(score, 1)} 分`; circle.append(title); svg.append(circle);
    });
    drawSegment(segment); target.append(svg);
  }

  function renderDetailComponents(theme) {
    const target = $("theme-components"); clear(target);
    const components = Array.isArray(theme.components) ? theme.components : [];
    if (!components.length) { target.append(make("p", "theme-empty-inline", "当前快照暂无分项评分")); return; }
    components.forEach((component) => {
      const score = finite(component.score);
      const row = make("div", "component-row");
      const heading = make("div", "component-heading");
      heading.append(make("span", "", component.name || "分项"), make("b", "", score === null ? "—" : `${numberText(score, 1)} / 100`));
      const track = make("div", "component-track");
      const fill = make("span"); fill.style.width = `${score === null ? 0 : Math.max(0, Math.min(100, score))}%`; track.append(fill);
      const value = finite(component.value);
      const valueText = value === null ? "原始值暂缺" : `${numberText(value, 2)}${typeof component.unit === "string" ? component.unit : ""}`;
      const weight = finite(component.weight);
      row.append(heading, track, make("small", "component-note", `${valueText}${weight === null ? "" : ` · 权重 ${numberText(weight, 0)}%`}`));
      target.append(row);
    });
  }

  function renderMembers(theme) {
    const target = $("theme-members"); clear(target);
    const members = Array.isArray(theme.members) ? theme.members : [];
    setText("theme-member-count", members.length ? `${members.length} 只 · 点击股票查看行情` : "暂无成员");
    $("theme-members-empty").hidden = members.length > 0;
    if (!members.length) return;
    const table = make("table", "theme-members-table");
    table.append(make("caption", "sr-only", "题材成员股票行情、资金及角色，点击股票名称查看个股窗口"));
    const head = make("thead"); const header = make("tr");
    ["股票 / 角色", "收盘价", "当日", "5日", "20日", "成交额（亿）", "主力净额（万）", "30日净流率", "30日正流入天数", "所属题材 / 原因"].forEach((label) => header.append(make("th", "", label)));
    head.append(header); table.append(head);
    const body = make("tbody");
    members.forEach((member) => {
      const row = make("tr"); const nameCell = make("td"); const button = make("button", "theme-member-button"); button.type = "button";
      button.disabled = !member.ts_code; button.addEventListener("click", () => openMember(member));
      const name = make("span", "theme-member-name"); name.append(make("b", "", stockName(member)), make("small", "", `${member.ts_code || "—"}${member.role ? ` · ${member.role}` : ""}`));
      button.append(name); nameCell.append(button); row.append(nameCell);
      [numberText(member.close, 2), signedPct(member.pct_chg), signedPct(member.return5_pct), signedPct(member.return20_pct), numberText(member.amount_yi, 2), numberText(member.main_net_wan, 0), signedPct(member.flow30_ratio_pct), numberText(member.positive_flow_days30, 0)].forEach((value) => row.append(make("td", "theme-number", value)));
      const reason = make("td", "theme-member-reason");
      const themes = Array.isArray(member.theme_names) ? member.theme_names.join(" · ") : "";
      if (themes) reason.append(make("b", "theme-member-themes", themes));
      reason.append(make("span", "", member.reason ? `${member.reason}${member.reason_date ? ` · ${member.reason_date}` : ""}` : "暂无归因记录"));
      appendResearchControl(reason, theme, member, "theme-member-ai-button");
      if (member.quote_date && member.quote_date !== state.date) reason.append(make("small", "", `行情日期 ${member.quote_date}`));
      row.append(reason); body.append(row);
    });
    table.append(body); target.append(table);
  }

  function showDetail(theme) {
    state.selectedTheme = theme;
    setText("theme-detail-title", theme.name || "未命名题材");
    setText("theme-detail-summary", `${stageFor(theme)} · 观察强度 ${numberText(theme.score, 1)} · ${finite(theme.coverage) === null ? "覆盖度暂无" : `覆盖 ${pctText(Number(theme.coverage) * 100)}`}`);
    closeMetricHelp(); renderDetailComponents(theme); renderSparkline(theme); renderMembers(theme);
    $("theme-detail").hidden = false; renderThemes();
    $("theme-detail-title").setAttribute("tabindex", "-1");
    $("theme-detail-title").focus({preventScroll: true});
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("theme-detail").scrollIntoView({behavior: reducedMotion ? "auto" : "smooth", block: "start"});
  }

  function addExternalLink(parent, label, href, className) { const url = safeUrl(href); if (!url) { parent.append(make("span", className || "attention-unavailable", `${label} · 链接不可用`)); return; } const link = make("a", className || "attention-link", label); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; parent.append(link); }
  function renderAttention(payload) {
    state.attention = payload; const panel = $("attention-panel"); panel.hidden = false; setText("attention-observed-at", payload.observed_at ? `观测于 ${payload.observed_at}` : "观测日期未提供"); setText("attention-status", ({ok: "当前人气快照", available: "当前人气快照", partial: "部分来源暂不可用", unavailable: "当前人气数据暂不可用", stale: "展示最近一次可用观测"})[payload.status] || "当前人气快照");
    const stocks = $("attention-stocks"); const topics = $("attention-topics"); const catalysts = $("attention-catalysts"); const sources = $("attention-sources-list"); [stocks, topics, catalysts, sources].forEach(clear);
    const renderList = (items, target, formatter) => { if (!Array.isArray(items) || !items.length) { target.append(make("p", "attention-empty", "暂无可用记录")); return; } items.forEach((item, index) => { const row = make("div", "attention-item"); const rank = item.rank || index + 1; row.append(make("span", "attention-rank", String(rank).padStart(2, "0"))); formatter(item, row); target.append(row); }); };
    renderList(payload.hot_stocks, stocks, (item, row) => { const holder = make("div"); addExternalLink(holder, item.title || item.symbol || "热门股票", item.link); holder.append(make("small", "attention-meta", `${numberText(item.current, 2)} · ${signedPct(item.pct_change)}`)); row.append(holder); });
    renderList(payload.hot_topics, topics, (item, row) => { const holder = make("div"); addExternalLink(holder, item.title || "热门话题", item.link); holder.append(make("small", "attention-meta", `热度 ${numberText(item.topic_heat, 0)} · ${numberText(item.status_count, 0)} 条状态`)); row.append(holder); });
    renderList(payload.catalysts, catalysts, (item, row) => { const holder = make("div"); addExternalLink(holder, item.title || "催化信息", item.link); holder.append(make("small", "attention-meta", `${item.source || "来源待标注"}${item.published_at ? ` · ${item.published_at}` : ""}`)); row.append(holder); });
    renderList(payload.sources, sources, (item, row) => { row.className = "attention-source-item"; row.append(make("span", "", item.name || "数据源"), make("small", "attention-meta", `${({ok: "可用", available: "可用", partial: "部分可用", unavailable: "暂不可用", stale: "最近归档"})[item.status] || "待核对"}${item.observed_at ? ` · ${item.observed_at}` : ""}`), make("p", "", item.note || "")); });
  }

  function updateView() { const themes = state.view === "themes"; $("theme-stage-filter").disabled = !themes; $("theme-tab").tabIndex = themes ? 0 : -1; $("popular-tab").tabIndex = themes ? -1 : 0; $("theme-ranking-panel").hidden = !themes; $("popular-ranking-panel").hidden = themes; $("theme-tab").classList.toggle("is-active", themes); $("popular-tab").classList.toggle("is-active", !themes); $("theme-tab").setAttribute("aria-selected", String(themes)); $("popular-tab").setAttribute("aria-selected", String(!themes)); }
  function setWorkspaceView(view) {
    const topics = view === "topics";
    $("topics-workspace-panel").hidden = !topics;
    $("stocks-workspace-panel").hidden = topics;
    $("topics-workspace-tab").classList.toggle("is-active", topics);
    $("stocks-workspace-tab").classList.toggle("is-active", !topics);
    $("topics-workspace-tab").setAttribute("aria-selected", String(topics));
    $("stocks-workspace-tab").setAttribute("aria-selected", String(!topics));
    $("topics-workspace-tab").tabIndex = topics ? 0 : -1;
    $("stocks-workspace-tab").tabIndex = topics ? -1 : 0;
  }
  function bindWorkspaceTabs() {
    const tabs = [$("topics-workspace-tab"), $("stocks-workspace-tab")];
    setWorkspaceView("topics");
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => setWorkspaceView(index === 0 ? "topics" : "stocks"));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        setWorkspaceView(nextIndex === 0 ? "topics" : "stocks");
        tabs[nextIndex].focus();
      });
    });
  }
  function attentionPlaceholder(title, note) {
    $("attention-panel").hidden = false;
    setText("attention-observed-at", title); setText("attention-status", note);
    ["attention-stocks", "attention-topics", "attention-catalysts", "attention-sources-list"].forEach((id) => {
      clear($(id)); $(id).append(make("p", "attention-empty", note));
    });
  }
  async function loadAttention(requestId, signal) {
    if (state.date !== state.latestDate) { attentionPlaceholder("历史日期", "尚无历史人气快照"); return; }
    attentionPlaceholder("当前观测", "正在读取人气与催化…");
    try {
      const payload = await request("/api/market-leaders/attention", signal);
      if (requestId !== state.requestId || state.date !== state.latestDate) return;
      renderAttention(payload);
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.requestId) return;
      attentionPlaceholder("当前观测不可用", "热榜与催化暂时无法读取");
    }
  }
  async function loadThemes(date) {
    const requestId = ++state.requestId;
    if (state.controller) state.controller.abort();
    const controller = new AbortController(); state.controller = controller;
    showStatus("loading", "正在读取题材数据", date ? `正在读取 ${date} 的题材快照。` : "市场环境、主题排行和成员股票即将出现。");
    $("theme-detail").hidden = true; state.selectedTheme = null;
    $("theme-date-select").disabled = true;
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const data = await request(`/api/market-leaders/themes${query}`, controller.signal);
      if (requestId !== state.requestId) return;
      const meta = data.meta || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.date || "")) || (date && date !== meta.date)) throw new Error("所选日期未返回对应快照");
      state.data = data; state.date = String(meta.date);
      if (!state.latestDate) state.latestDate = state.date;
      renderDateSelect(meta); renderMarket(data); renderThemeChanges(data); renderThemes(); renderPopular(); updateView(); showContent();
      void loadAttention(requestId, controller.signal);
    } catch (error) {
      if (error.name === "AbortError" || requestId !== state.requestId) return;
      const auth = error.status === 401 || error.status === 403;
      const title = error.status === 401 ? "登录后查看题材雷达" : error.status === 403 ? "当前账户暂无题材访问权限" : "题材数据暂不可用";
      showStatus("error", title, auth ? "请通过当前网站账户登录或核对访问权限。" : date ? `${date} 的题材快照未能读取，请重试或选择其他日期。` : "请稍后重试，或切换至“涨停股看板”查看连板数据。");
      if (auth) {
        const link = make("a", "button button-primary", "前往登录");
        link.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; $("theme-status").append(link);
      } else {
        const retry = make("button", "button button-outline", "重新加载"); retry.type = "button"; retry.addEventListener("click", () => loadThemes(date)); $("theme-status").append(retry);
      }
      setText("theme-snapshot-note", title);
      setText("theme-date-note", date ? `未读取到 ${date} 的快照` : "暂未读取到题材快照");
    } finally {
      if (requestId === state.requestId) $("theme-date-select").disabled = state.dates.length < 2;
    }
  }

  function closeMetricHelp() {
    const button = $("theme-metric-help-toggle"); const panel = $("theme-metric-help");
    if (!button || !panel) return;
    panel.hidden = true; button.setAttribute("aria-expanded", "false");
  }
  function bindMetricHelp() {
    const button = $("theme-metric-help-toggle"); const panel = $("theme-metric-help");
    if (!button || !panel) return;
    button.addEventListener("click", (event) => {
      event.stopPropagation(); const willOpen = panel.hidden; closeMetricHelp();
      if (willOpen) { panel.hidden = false; button.setAttribute("aria-expanded", "true"); }
    });
    panel.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", closeMetricHelp);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || panel.hidden) return;
      closeMetricHelp(); button.focus();
    });
  }
  function bind() {
    bindWorkspaceTabs();
    bindMetricHelp();
    [$("theme-tab"), $("popular-tab")].forEach((tab) => tab.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); state.view = event.key === "Home" ? "themes" : event.key === "End" ? "popular" : state.view === "themes" ? "popular" : "themes"; updateView(); $(state.view === "themes" ? "theme-tab" : "popular-tab").focus(); }));
    $("theme-tab").addEventListener("click", () => { state.view = "themes"; updateView(); }); $("popular-tab").addEventListener("click", () => { state.view = "popular"; updateView(); });
    $("theme-search").addEventListener("input", () => { renderThemes(); renderPopular(); }); $("theme-stage-filter").addEventListener("change", renderThemes);
    $("theme-date-select").addEventListener("change", (event) => { const date = event.target.value; if (date) loadThemes(date); }); $("theme-detail-close").addEventListener("click", () => { closeMetricHelp(); $("theme-detail").hidden = true; state.selectedTheme = null; renderThemes(); });
  }
  document.addEventListener("DOMContentLoaded", () => { bind(); loadThemes(""); });
}());

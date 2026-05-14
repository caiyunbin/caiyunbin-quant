# caiyunbin-quant · 多子策略决策引擎 信号站

> 静态展示站, 内容由本地引擎每日 19:00 自动生成并 push.
> 网站本身**不含任何策略代码、数据库密钥、API token**.

## 📊 访问

- 网址: https://caiyunbin.github.io/caiyunbin-quant/
- 需要简单密码访问 (前端 sha256 校验)
- 内容: 4 个子策略每日信号 / 净值曲线 / 调仓记录

## 🔐 仓库内容白名单

仓库里**只允许**以下文件:

```
index.html              主页 (总览)
login.html              密码输入页
strategies/*.html       4 个子策略详情页
data/latest.json        今日信号
data/history/*.json     历史信号 (近 30 天)
data/equity_curves.json 净值曲线 (8 年)
assets/*.css            样式
assets/*.js             前端 JS (密码校验等)
.gitignore              安全屏障
.nojekyll               关闭 jekyll
README.md
```

**禁止**进入仓库的 (`.gitignore` 已严格阻止):
- 任何 `*.py` (策略代码)
- 任何 `*.parquet`/`*.db` (数据)
- 任何 `*.env`/`*token*`/`*secret*` (密钥)
- 任何 `params*.py` (参数)

## ⏰ 自动更新时间表 (工作日)

| 时间 | 事件 | 触发器 |
|---|---|---|
| 17:00 | 本地拉股票数据 | launchd `stock_data_update` |
| 17:15 | 本地重建 parquet | launchd `build_features` |
| 17:30 | 本地拉 ETF 数据 | launchd `etf_data_update` |
| 18:30 | 本地跑 V27 三策略 + 微信推送 | launchd `v27_daily` |
| 18:45 | 本地跑 ETF 独立 bot | launchd `etf_daily_bot` |
| **19:00** | **本地 export → push 到本仓库** | launchd `update_site` |
| ~19:02 | GitHub Pages 自动构建 | GitHub |
| ~19:03 | 网站全球可访问 | — |

## ⚠️ 风险提示

本仓库内容仅供本人量化研究参考,
**不构成任何投资建议**, 不保证任何收益, 不为任何亏损负责.
证券市场有风险, 投资需谨慎.

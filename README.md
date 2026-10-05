# AirCode Site — 机场三字码 + 航空公司查询（Astro + Cloudflare Pages）

中英双语工具站原型：机场 IATA/ICAO、航空公司 IATA/ICAO，后期预留飞机机型（LOPA/货舱/ULD）。不做港口。

## 技术栈
- Astro 5 静态生成（`output: 'static'`），双语路由 `/zh/...` `/en/...`（`astro.config.mjs` i18n，默认 zh 且带前缀）
- 数据：OurAirports `airports.csv`/`countries.csv`（public domain）+ OpenFlights `airlines.dat`/`planes.dat`，脚本过滤后生成 `src/data/*.json`
- 后台思路：资讯文章用 Markdown/MDX 存 Git；接 Decap CMS（`/admin/` 网页后台，GitHub 登录编辑 → 提交 → Cloudflare Pages 自动构建）。机场/航司为结构化 JSON，不走文章后台，后续可加表格编辑器或小型 Admin 页批量改 JSON。

## 本地开发
```bash
npm install
npm run dev
npm run build   # 输出 dist/
npm run preview
```

## 数据更新
原始文件在构建机下载（勿抓 seabay）：
- https://ourairports.com/data/airports.csv （全量 86k 行，含 IATA 的 9,051 条）
- https://ourairports.com/data/countries.csv
- https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat （过滤 IATA 2 位 + Active=Y，得 992 家）
- planes.dat（234 条）
当前原型为验证构建：机场取 large/medium 优先的前 500 条，航空公司全量。补全量时把 `src/data/airports.json` 换成 9,051 条全量，构建时间/文件数会上升（Cloudflare Pages 免费版单次部署 20,000 文件上限，双语详情页 9051×2 + 航司 992×2 ≈ 20k，需分页或按需只生成有流量机场，或升级/拆分）。

中文名：`name_zh/city_zh` 仅对中国主要机场做了人工映射表（见生成脚本），其余保留英文并在详情页标注“暂无中文名”。下一步：接维基/Wikidata 中文名补全冷门机场，人工校对 Top 2000 货运常用机场。

## 部署到 Cloudflare Pages
1. 把本仓库推到 GitHub/GitLab。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接仓库。
3. Build settings：Framework preset `Astro`，Build command `npm run build`，Output directory `dist`，Node 版本 20+。
4. 绑定自定义域名，`astro.config.mjs` 的 `site` 改成正式域名以便 canonical/sitemap 正确。
5. （可选）开启 Decap：按 Decap CMS 文档加 `public/admin/` 与 GitHub OAuth，编辑 `src/data/news.json` 或后续 `src/content/news/*.md`。

## SEO
- 每页 `title/description/canonical` + `hreflang zh/en` 已在 `src/layouts/Base.astro`。
- 上线后补 `@astrojs/sitemap` 生成 `sitemap-index.xml`（已在 robots.txt 预留），并提交 Google Search Console / Bing / 百度。

## 机型板块（预留）
路由 `/zh/aircraft/` `/en/aircraft/` 已占位，只展示机型代码和字段设计，不编造客舱/货舱图。后续每条记录：`airline_iata, aircraft_iata, LOPA{ cabins, total_seats, source_url }, cargo{ holds, volume, door }, uld{ positions, types }, verified_at`，来源必须是航司公开货运手册/机队页。

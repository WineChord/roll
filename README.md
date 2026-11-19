# ROLL · 饭票罗盘

一个把「今天吃什么」变成可解释随机决策的静态网页。商家池来自 7 张美团外卖截图，共 453 个店铺条目；页面不把截图快照冒充实时菜单。

在线阅读：[www.wineandchord.com/roll](https://www.wineandchord.com/roll/)

## 功能

- 6 种抽取方式：开箱、转盘、翻牌、抽签、扭蛋、老虎机。
- 按菜系、评分、送达时间、起送价、距离和配送费组合筛选。
- 收藏、白名单、黑名单、历史记录与本地持久化。
- 独立的逐条截图清单、来源哈希核对，以及 CSV / JSON 下载。
- 避开最近结果、只看白名单、只看收藏、避免连续重复。
- 分享文案、偏好 JSON 导入导出、来源截图哈希核对。
- 响应式布局、键盘焦点、减少动态效果和空池恢复。

所有个人偏好仅保存在浏览器 `localStorage`，不会上传。

## 本地运行

```bash
npm ci
npm run serve
```

打开 `http://127.0.0.1:4173/`。

## 验证

```bash
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

## 数据

`data/shops.js` 是由原始截图 OCR、裁剪和清洗得到的静态快照。评分、月售、距离、配送时长、起送价与配送费均为 2026-11-19 截图内容；实时营业、菜单、优惠和配送范围以美团结算页为准。

仓库不包含原始整屏截图，只保留 `assets/shops/` 中的商家图裁片。商家名称与图片权利归原权利人。数据来源文件名与 SHA-256 位于 `data/shops.js` 的 `meta.sources`。

主视觉由 Codex 内置 `imagegen` 生成，原始提示词记录在 `assets/hero-prompt.txt`。Lucide 图标以 ISC 许可证随仓库分发，其中派生自 Feather 的图标保留 MIT 条件。

## 发布

推送到 `main` 后，`.github/workflows/pages.yml` 会运行测试、构建静态产物并发布到 GitHub Pages。

## License

本仓库代码与原创视觉采用 MIT License。第三方商家图片、美团截图数据和 Lucide 图标分别保留各自权利与许可证。

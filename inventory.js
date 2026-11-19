(function () {
  "use strict";

  const DATA = window.ROLL_DATA;
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          char
        ]
    );
  const sourceOrder = new Map(DATA.meta.sources.map((source, index) => [source.file, index]));
  const state = { query: "", source: "all", visible: 120 };

  function refreshIcons() {
    window.lucide?.createIcons({ attrs: { "stroke-width": 2.25 } });
  }

  function filtered() {
    const query = state.query.trim().toLowerCase();
    return DATA.shops.filter((shop) => {
      if (state.source !== "all" && shop.source !== state.source) return false;
      return (
        !query ||
        shop.name.toLowerCase().includes(query) ||
        shop.category.toLowerCase().includes(query) ||
        shop.tags.join(" ").toLowerCase().includes(query)
      );
    });
  }

  function rowsFor(shops) {
    return shops
      .map(
        (shop) => `
          <tr>
            <td><img src="${escape(shop.image)}" alt="" loading="lazy" width="52" height="52" /></td>
            <td>
              <div class="inventory-store">
                <div>
                  <b>${escape(shop.name)}</b>
                  <small>${escape(shop.category)} · ${escape(shop.salesText)}</small>
                </div>
                <a class="inventory-link" href="./#shop=${encodeURIComponent(shop.id)}">打开</a>
              </div>
            </td>
            <td data-label="评分">${shop.rating ? shop.rating.toFixed(1) : "—"}</td>
            <td data-label="送达">${escape(shop.deliveryMin ? `${shop.deliveryMin} 分` : "—")}</td>
            <td data-label="起送">${escape(shop.minOrder == null ? "—" : `¥${shop.minOrder}`)}</td>
            <td data-label="配送费">${escape(
              shop.deliveryFee == null
                ? "—"
                : shop.deliveryFee === 0
                  ? "免费"
                  : `¥${shop.deliveryFee}`
            )}</td>
            <td data-label="截图行">${shop.sourceY.toLocaleString("zh-CN")} px</td>
          </tr>`
      )
      .join("");
  }

  function render() {
    const shops = filtered();
    const shown = shops.slice(0, state.visible);
    const groups = new Map();
    for (const shop of shown) {
      if (!groups.has(shop.source)) groups.set(shop.source, []);
      groups.get(shop.source).push(shop);
    }
    const orderedGroups = [...groups.entries()].sort(
      ([a], [b]) => (sourceOrder.get(a) ?? 99) - (sourceOrder.get(b) ?? 99)
    );
    $("#inventoryList").innerHTML = orderedGroups
      .map(([source, entries], index) => {
        const sourceIndex = (sourceOrder.get(source) ?? index) + 1;
        const sourceMeta = DATA.meta.sources.find((item) => item.file === source);
        return `
          <section class="inventory-source">
            <div class="inventory-source-head">
              <div>
                <h2>截图 ${sourceIndex} · ${entries.length} 家</h2>
                <p>${escape(source)}</p>
              </div>
              <code title="${escape(sourceMeta?.sha256 || "")}">${escape(
                sourceMeta?.sha256 || ""
              )}</code>
            </div>
            <table class="inventory-table">
              <thead>
                <tr>
                  <th>图</th><th>门店</th><th>评分</th><th>送达</th><th>起送</th><th>配送费</th><th>原始行</th>
                </tr>
              </thead>
              <tbody>${rowsFor(entries)}</tbody>
            </table>
          </section>`;
      })
      .join("");
    $("#inventoryCount").textContent = `显示 ${shown.length} / ${shops.length} 条`;
    $("#inventoryMore").hidden = shown.length >= shops.length;
    refreshIcons();
  }

  function init() {
    $("#inventoryIntro").textContent = `${DATA.meta.sourceCount} 张截图，${DATA.shops.length} 个店铺条目。保留原始文件名、哈希和截图中门店的纵向位置，不用省略号补造未知信息。`;
    $("#inventoryFootnote").textContent = `${DATA.meta.area} · ${DATA.meta.builtAt} · 非实时快照`;
    $("#sourceFilter").innerHTML = `
      <option value="all">全部截图</option>
      ${DATA.meta.sources
        .map(
          (source, index) =>
            `<option value="${escape(source.file)}">截图 ${index + 1} · ${escape(
              source.file
            )}</option>`
        )
        .join("")}`;
    $("#inventorySearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      state.visible = 120;
      render();
    });
    $("#sourceFilter").addEventListener("change", (event) => {
      state.source = event.target.value;
      state.visible = 120;
      render();
    });
    $("#inventoryMore").addEventListener("click", () => {
      state.visible += 120;
      render();
    });
    render();
  }

  try {
    init();
  } catch (error) {
    console.error(error);
    $("#inventoryList").textContent = `清单加载失败：${error.message}`;
  }
})();

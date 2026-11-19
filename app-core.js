(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  root.RollCore = core;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const GROUPS = [
    "northern",
    "spicy",
    "southern",
    "bbq",
    "hotpot",
    "western",
    "jpkr",
    "dessert",
    "quick",
    "home",
  ];

  const MODES = [
    { key: "case", label: "开箱", icon: "package-open" },
    { key: "wheel", label: "转盘", icon: "circle-dot" },
    { key: "cards", label: "翻牌", icon: "layers-2" },
    { key: "fortune", label: "抽签", icon: "sparkles" },
    { key: "gacha", label: "扭蛋", icon: "circle-dashed" },
    { key: "slot", label: "老虎机", icon: "dices" },
  ];

  const DEFAULT_FILTERS = Object.freeze({
    q: "",
    groups: [],
    rating: "any",
    delivery: "any",
    minOrder: "any",
    distance: "any",
    fee: "any",
    channel: "any",
    sort: "smart",
    view: "grid",
  });

  const DEFAULT_PREFS = Object.freeze({
    blacklist: [],
    whitelist: [],
    favorites: [],
    history: [],
    excludeRecent: 3,
    onlyWhitelist: false,
    favoritesOnly: false,
    sound: true,
    motion: true,
  });

  const FILTER_OPTIONS = Object.freeze({
    rating: [
      ["any", "不限"],
      ["4.5", "4.5+"],
      ["4.7", "4.7+"],
      ["4.8", "4.8+"],
    ],
    delivery: [
      ["any", "不限"],
      ["25", "25 分钟"],
      ["30", "30 分钟"],
      ["40", "40 分钟"],
    ],
    minOrder: [
      ["any", "不限"],
      ["20", "¥20 起"],
      ["30", "¥30 起"],
      ["40", "¥40 起"],
    ],
    distance: [
      ["any", "不限"],
      ["1000", "1km 内"],
      ["2000", "2km 内"],
      ["3000", "3km 内"],
    ],
    fee: [
      ["any", "不限"],
      ["free", "免配送费"],
      ["under2", "¥2 内"],
    ],
    channel: [
      ["any", "不限"],
      ["美团专送", "美团专送"],
      ["美团快送", "美团快送"],
      ["商家自配", "商家自配"],
    ],
    sort: [
      ["smart", "综合推荐"],
      ["delivery", "送得最快"],
      ["rating", "评分最高"],
      ["sales", "月售最高"],
      ["minOrder", "起送最低"],
    ],
  });

  const unique = (values) =>
    [...new Set(values.filter((value) => typeof value === "string" && value))];

  const shortName = (name) =>
    String(name || "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .trim() || String(name || "");

  const normalizeSearch = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[·•.\s（）()]/g, "");

  function normalizeFilters(input) {
    const source = input && typeof input === "object" ? input : {};
    const filters = { ...DEFAULT_FILTERS, ...source };
    filters.q = typeof filters.q === "string" ? filters.q.slice(0, 80) : "";
    filters.groups = unique(Array.isArray(filters.groups) ? filters.groups : []).filter(
      (group) => GROUPS.includes(group)
    );
    for (const key of [
      "rating",
      "delivery",
      "minOrder",
      "distance",
      "fee",
      "channel",
      "sort",
    ]) {
      const allowed = FILTER_OPTIONS[key].map(([value]) => value);
      if (!allowed.includes(String(filters[key]))) {
        filters[key] = DEFAULT_FILTERS[key];
      }
    }
    if (!["grid", "list"].includes(filters.view)) filters.view = "grid";
    return filters;
  }

  function normalizePrefs(input) {
    const source = input && typeof input === "object" ? input : {};
    const prefs = { ...DEFAULT_PREFS, ...source };
    prefs.blacklist = unique(Array.isArray(prefs.blacklist) ? prefs.blacklist : []);
    prefs.whitelist = unique(Array.isArray(prefs.whitelist) ? prefs.whitelist : []);
    prefs.favorites = unique(Array.isArray(prefs.favorites) ? prefs.favorites : []);
    prefs.history = (Array.isArray(prefs.history) ? prefs.history : [])
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.at === "string" &&
          !Number.isNaN(Date.parse(entry.at))
      )
      .slice(0, 100);
    prefs.excludeRecent = Math.max(
      0,
      Math.min(10, Number.parseInt(prefs.excludeRecent, 10) || 0)
    );
    for (const key of ["onlyWhitelist", "favoritesOnly", "sound", "motion"]) {
      prefs[key] = Boolean(prefs[key]);
    }
    return prefs;
  }

  function searchText(shop) {
    return [
      shop.name,
      shop.category,
      shop.description,
      shop.deliveryMode,
      ...(shop.tags || []),
      ...(shop.promotions || []),
    ]
      .join(" ")
      .toLowerCase();
  }

  function matchesQuery(shop, query) {
    const words = String(query || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return true;
    const haystack = normalizeSearch(searchText(shop));
    return words.every((word) => haystack.includes(normalizeSearch(word)));
  }

  function matchesFilters(shop, input) {
    const filters = normalizeFilters(input);
    if (filters.groups.length && !filters.groups.includes(shop.group)) return false;
    if (!matchesQuery(shop, filters.q)) return false;
    if (filters.rating !== "any") {
      if (!Number.isFinite(shop.rating) || shop.rating < Number(filters.rating)) {
        return false;
      }
    }
    if (filters.delivery !== "any") {
      if (
        !Number.isFinite(shop.deliveryMin) ||
        shop.deliveryMin > Number(filters.delivery)
      ) {
        return false;
      }
    }
    if (filters.minOrder !== "any") {
      if (!Number.isFinite(shop.minOrder) || shop.minOrder > Number(filters.minOrder)) {
        return false;
      }
    }
    if (filters.distance !== "any") {
      if (!Number.isFinite(shop.distance) || shop.distance > Number(filters.distance)) {
        return false;
      }
    }
    if (filters.fee === "free" && shop.deliveryFee !== 0) return false;
    if (
      filters.fee === "under2" &&
      (!Number.isFinite(shop.deliveryFee) || shop.deliveryFee > 2)
    ) {
      return false;
    }
    if (filters.channel !== "any" && shop.deliveryMode !== filters.channel) return false;
    return true;
  }

  function smartScore(shop) {
    const rating = Number.isFinite(shop.rating) ? shop.rating * 20 : 0;
    const sales = Math.log10(Math.max(1, shop.sales || 0)) * 10;
    const speed = Number.isFinite(shop.deliveryMin) ? Math.max(0, 40 - shop.deliveryMin) : 0;
    const fee = shop.deliveryFee === 0 ? 9 : Math.max(0, 8 - (shop.deliveryFee || 0) * 2);
    const start = Number.isFinite(shop.minOrder) ? Math.max(0, 35 - shop.minOrder) / 3 : 0;
    return rating + sales + speed + fee + start;
  }

  const SORTERS = {
    smart: (a, b) => smartScore(b) - smartScore(a) || a.name.localeCompare(b.name, "zh"),
    delivery: (a, b) =>
      (a.deliveryMin ?? 999) - (b.deliveryMin ?? 999) ||
      (b.rating ?? 0) - (a.rating ?? 0),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.sales - a.sales,
    sales: (a, b) => (b.sales ?? 0) - (a.sales ?? 0),
    minOrder: (a, b) =>
      (a.minOrder ?? 999) - (b.minOrder ?? 999) || (b.rating ?? 0) - (a.rating ?? 0),
  };

  function sortShops(shops, sort) {
    return [...shops].sort(SORTERS[sort] || SORTERS.smart);
  }

  function candidatePool(shops, filterInput, prefInput, options = {}) {
    const filters = normalizeFilters(filterInput);
    const prefs = normalizePrefs(prefInput);
    const blacklist = new Set(prefs.blacklist);
    const whitelist = new Set(prefs.whitelist);
    const favorites = new Set(prefs.favorites);
    const allById = new Map(shops.map((shop) => [shop.id, shop]));
    const recentIds = new Set(
      prefs.history.slice(0, prefs.excludeRecent).map((entry) => entry.id)
    );

    let pool = shops.filter(
      (shop) =>
        !blacklist.has(shop.id) &&
        (!prefs.onlyWhitelist || whitelist.has(shop.id)) &&
        (!prefs.favoritesOnly || favorites.has(shop.id))
    );
    let recovered = false;
    if (!options.ignoreHistory) {
      const withoutRecent = pool.filter((shop) => !recentIds.has(shop.id));
      if (withoutRecent.length) pool = withoutRecent;
      else if (pool.length && recentIds.size) recovered = true;
    }
    if (options.avoidId) {
      const withoutAvoid = pool.filter((shop) => shop.id !== options.avoidId);
      if (withoutAvoid.length) pool = withoutAvoid;
    }
    pool = sortShops(pool.filter((shop) => matchesFilters(shop, filters)), filters.sort);

    return {
      shops: pool,
      recovered,
      hidden: {
        blacklisted: shops.filter((shop) => blacklist.has(shop.id)).length,
        notWhitelisted:
          prefs.onlyWhitelist && prefs.whitelist.length
            ? shops.filter((shop) => !whitelist.has(shop.id) && !blacklist.has(shop.id))
                .length
            : 0,
        recent: [...recentIds].filter((id) => allById.has(id)).length,
      },
    };
  }

  function chooseCandidate(pool, random = Math.random) {
    if (!pool.length) return null;
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool[index];
  }

  function historyEntry(shop, mode, at = new Date()) {
    return {
      id: shop.id,
      name: shop.name,
      mode,
      at: at.toISOString(),
    };
  }

  function confirmChoice(shop, mode, prefInput, at = new Date()) {
    const prefs = normalizePrefs(prefInput);
    const entry = historyEntry(shop, mode, at);
    prefs.history = [
      entry,
      ...prefs.history.filter((item) => item.id !== shop.id || item.mode !== mode),
    ].slice(0, 100);
    return prefs;
  }

  function recordRoll(shop, mode, prefInput, at = new Date()) {
    const prefs = normalizePrefs(prefInput);
    const entry = { ...historyEntry(shop, mode, at), rolledOnly: true };
    prefs.history = [entry, ...prefs.history].slice(0, 100);
    return prefs;
  }

  function toggleList(prefInput, key, id) {
    const prefs = normalizePrefs(prefInput);
    if (!["blacklist", "whitelist", "favorites"].includes(key)) return prefs;
    prefs[key] = prefs[key].includes(id)
      ? prefs[key].filter((item) => item !== id)
      : [...prefs[key], id];
    if (key === "blacklist" && prefs.blacklist.includes(id)) {
      prefs.whitelist = prefs.whitelist.filter((item) => item !== id);
      prefs.favorites = prefs.favorites.filter((item) => item !== id);
    }
    return prefs;
  }

  function facetCounts(shops, filterInput, prefInput) {
    const filters = normalizeFilters(filterInput);
    const prefs = normalizePrefs(prefInput);
    const blacklist = new Set(prefs.blacklist);
    const whitelist = new Set(prefs.whitelist);
    const favorites = new Set(prefs.favorites);
    const base = shops.filter(
      (shop) =>
        !blacklist.has(shop.id) &&
        (!prefs.onlyWhitelist || whitelist.has(shop.id)) &&
        (!prefs.favoritesOnly || favorites.has(shop.id))
    );
    const groups = Object.fromEntries(GROUPS.map((group) => [group, 0]));
    for (const shop of base) {
      if (matchesFilters(shop, { ...filters, groups: [] })) groups[shop.group] += 1;
    }
    return { groups, total: candidatePool(shops, filters, prefs).shops.length };
  }

  function buildShareText(shop, meta) {
    const facts = [
      shop.rating ? `${shop.rating.toFixed(1)} 分` : null,
      Number.isFinite(shop.deliveryMin) ? `约 ${shop.deliveryMin} 分钟` : null,
      shop.deliveryFee === 0 ? "免配送费" : Number.isFinite(shop.deliveryFee)
        ? `配送约 ¥${shop.deliveryFee}`
        : null,
      Number.isFinite(shop.minOrder) ? `¥${shop.minOrder} 起送` : null,
    ].filter(Boolean);
    const url = `${location.origin}${location.pathname}#shop=${encodeURIComponent(shop.id)}`;
    return [
      `ROLL 饭票：${shop.name}`,
      facts.join(" · "),
      `来源：${meta?.builtAt || "截图"} 美团截图快照；实时信息以美团结算页为准。`,
      url,
    ].join("\n");
  }

  function sanitizeImport(input, shops) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("文件内容不是 ROLL 偏好数据");
    }
    const validIds = new Set(shops.map((shop) => shop.id));
    const source =
      input.data && typeof input.data === "object" ? input.data : input.preferences || input;
    const prefs = normalizePrefs(source);
    prefs.blacklist = prefs.blacklist.filter((id) => validIds.has(id));
    const blacklist = new Set(prefs.blacklist);
    prefs.whitelist = prefs.whitelist.filter(
      (id) => validIds.has(id) && !blacklist.has(id)
    );
    prefs.favorites = prefs.favorites.filter(
      (id) => validIds.has(id) && !blacklist.has(id)
    );
    prefs.history = prefs.history.filter((entry) => validIds.has(entry.id));
    return prefs;
  }

  function exportPayload(prefs, meta) {
    return {
      app: "roll-wineandchord",
      version: 1,
      exportedAt: new Date().toISOString(),
      datasetBuiltAt: meta?.builtAt || null,
      preferences: normalizePrefs(prefs),
    };
  }

  function rarity(shop) {
    if ((shop.rating || 0) >= 4.9) return "legend";
    if ((shop.rating || 0) >= 4.8) return "epic";
    if ((shop.rating || 0) >= 4.7) return "rare";
    return "common";
  }

  function formatMinute(minute) {
    if (!Number.isFinite(minute)) return "待确认";
    if (minute < 60) return `${minute} 分钟`;
    const hours = Math.floor(minute / 60);
    const mins = minute % 60;
    return mins ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "距离待确认";
    return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}km`;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return "待确认";
    return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`;
  }

  return {
    GROUPS,
    MODES,
    DEFAULT_FILTERS,
    DEFAULT_PREFS,
    FILTER_OPTIONS,
    normalizeFilters,
    normalizePrefs,
    shortName,
    matchesFilters,
    matchesQuery,
    sortShops,
    smartScore,
    candidatePool,
    chooseCandidate,
    confirmChoice,
    recordRoll,
    toggleList,
    facetCounts,
    buildShareText,
    sanitizeImport,
    exportPayload,
    rarity,
    formatMinute,
    formatDistance,
    formatMoney,
  };
});

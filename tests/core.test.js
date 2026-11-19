import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL("../app-core.js", import.meta.url), "utf8"), context, {
  filename: "app-core.js",
});
const Core = context.window.RollCore;

const shops = [
  {
    id: "a",
    name: "高分烤鸭（一号店）",
    group: "northern",
    category: "北方风味",
    description: "北京烤鸭",
    tags: ["高分", "免配送费"],
    promotions: [],
    rating: 4.9,
    sales: 5000,
    deliveryMin: 22,
    minOrder: 20,
    deliveryFee: 0,
    distance: 800,
    deliveryMode: "美团快送",
  },
  {
    id: "b",
    name: "重庆火锅（二号店）",
    group: "hotpot",
    category: "火锅香锅",
    description: "麻辣火锅",
    tags: ["送得快"],
    promotions: [],
    rating: 4.6,
    sales: 900,
    deliveryMin: 38,
    minOrder: 35,
    deliveryFee: 4,
    distance: 2400,
    deliveryMode: "美团专送",
  },
  {
    id: "c",
    name: "轻食粥铺",
    group: "quick",
    category: "面饭粥粉",
    description: "粥和轻食",
    tags: ["离得近"],
    promotions: ["神券"],
    rating: 4.7,
    sales: 1200,
    deliveryMin: 25,
    minOrder: 15,
    deliveryFee: 1.5,
    distance: 600,
    deliveryMode: "美团快送",
  },
];

test("normalizes invalid stored filters", () => {
  const filters = Core.normalizeFilters({
    groups: ["hotpot", "unknown"],
    rating: "9",
    x: true,
  });
  assert.deepEqual(Array.from(filters.groups), ["hotpot"]);
  assert.equal(filters.rating, "any");
  assert.equal(filters.view, "grid");
});

test("blacklist and whitelist only constrain the roll pool", () => {
  const prefs = Core.normalizePrefs({
    ...Core.DEFAULT_PREFS,
    blacklist: ["b"],
    whitelist: ["a", "b", "c"],
    onlyWhitelist: true,
  });
  const pool = Core.candidatePool(shops, Core.DEFAULT_FILTERS, prefs).shops;
  assert.deepEqual(
    Array.from(pool.map((shop) => shop.id)).sort(),
    ["a", "c"]
  );
});

test("favorites-only mode uses the favorite set", () => {
  const prefs = Core.normalizePrefs({
    ...Core.DEFAULT_PREFS,
    favorites: ["c"],
    favoritesOnly: true,
  });
  const pool = Core.candidatePool(shops, Core.DEFAULT_FILTERS, prefs).shops;
  assert.deepEqual(
    Array.from(pool.map((shop) => shop.id)),
    ["c"]
  );
});

test("recent choices are avoided and recover when they cover the pool", () => {
  const recent = {
    ...Core.DEFAULT_PREFS,
    excludeRecent: 2,
    history: [
      { id: "a", at: new Date().toISOString(), mode: "case" },
      { id: "b", at: new Date().toISOString(), mode: "case" },
    ],
  };
  const pool = Core.candidatePool(shops, Core.DEFAULT_FILTERS, recent);
  assert.deepEqual(
    Array.from(pool.shops.map((shop) => shop.id)),
    ["c"]
  );
  const allRecent = {
    ...Core.DEFAULT_PREFS,
    excludeRecent: 3,
    history: shops.map((shop) => ({
      id: shop.id,
      at: new Date().toISOString(),
      mode: "case",
    })),
  };
  const recovered = Core.candidatePool(shops, Core.DEFAULT_FILTERS, allRecent);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.shops.length, 3);
});

test("combined filters stay conjunctive", () => {
  const filters = Core.normalizeFilters({
    q: "烤鸭",
    rating: "4.8",
    delivery: "30",
    fee: "free",
  });
  assert.deepEqual(
    shops.filter((shop) => Core.matchesFilters(shop, filters)).map((shop) => shop.id),
    ["a"]
  );
});

test("import sanitizes stale ids and list overlap", () => {
  const prefs = Core.sanitizeImport(
    {
      preferences: {
        blacklist: ["b", "gone"],
        whitelist: ["a", "b", "gone"],
        favorites: ["a", "gone"],
        history: [
          { id: "a", at: new Date().toISOString(), mode: "wheel" },
          { id: "gone", at: new Date().toISOString(), mode: "wheel" },
        ],
      },
    },
    shops
  );
  assert.deepEqual(Array.from(prefs.blacklist), ["b"]);
  assert.deepEqual(Array.from(prefs.whitelist), ["a"]);
  assert.deepEqual(Array.from(prefs.favorites), ["a"]);
  assert.deepEqual(Array.from(prefs.history.map((entry) => entry.id)), ["a"]);
});

test("card and exact roll helpers never mutate their inputs", () => {
  const pool = [...shops];
  const chosen = Core.chooseCandidate(pool, () => 0.5);
  assert.ok(pool.some((shop) => shop.id === chosen.id));
  const prefs = { ...Core.DEFAULT_PREFS, blacklist: [] };
  const next = Core.toggleList(prefs, "blacklist", "a");
  assert.deepEqual(Array.from(prefs.blacklist), []);
  assert.deepEqual(Array.from(next.blacklist), ["a"]);
});

#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const ocrPath = option("ocr");
const screenshotDir = option("screenshots");
if (!ocrPath || !screenshotDir) {
  console.error(
    "Usage: node scripts/build-snapshot.mjs --ocr <ocr.jsonl> --screenshots <directory>"
  );
  process.exit(2);
}

const snapshotDate = "2026-11-19";
const titleCorrections = new Map([
  ["子午路張记肉夹馍", "子午路张记肉夹馍"],
  ["阿祥嫂隆江猪脚飯", "阿祥嫂隆江猪脚饭"],
  ["潮粵肠粉", "潮粤肠粉"],
  ["徽巷里", "徽巷里"],
  ["劉记百年卤煮", "刘记百年卤煮"],
  ["老秦记", "老秦记"],
  ["老奏记", "老秦记"],
  ["Miinchen", "München"],
]);

const rejectedNames = new Set([
  "必点榜",
  "必三榜",
  "楼199",
  "圻品蛋母泊柚",
  "圻県蛋母伯柚",
  "肯德基宅急",
  "肯德基宅急⋯",
  "从些土（货自0 4101.",
  "从些土（动留0 2101.",
  "中小小虻面味 业/",
  "县光大（郝工休1心",
  "县光大利工休1内）",
  "MAAWEA /当餅豆口",
  "MAAWE 华/雪余日口",
  "娃求哒.芤牛娃（五柙",
  "娃立哒.茫牛峙（石烟",
  "好 光出 士安解行",
  "冷且亚山洽小炒。酸蒜",
  "冷日或山浴水帅，酸蒜",
  "长吞呈顺的间以（丑侏…",
  "下吞呈顺时川以（丑侏…",
  "鱼酷活鱼炉",
  "鱼酷活鱼炒",
]);

const readJsonLines = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const normalizeName = (name) =>
  name
    .replace(/\s*[×xX]\s*$/u, "")
    .replace(/\s+/g, " ")
    .replace(/[・•]/g, "·")
    .trim();

const correctionKey = (name) => {
  const base = name.replace(/（.*$/u, "").trim();
  return titleCorrections.get(base) ?? name;
};

const cleanName = (name) => {
  let value = correctionKey(normalizeName(name));
  value = value
    .replace(/張/g, "张")
    .replace(/飯/g, "饭")
    .replace(/粵/g, "粤")
    .replace(/劉/g, "刘")
    .replace(/Miinchen/g, "München")
    .replace(/张记上示烤炉冯蛋灌饼/g, "张记正宗烤炉鸡蛋灌饼")
    .replace(/野鸡枞[·•]云南好\/小吃/g, "野鸡枞·云南野生菌/小吃")
    .replace(/林八汇酸辣粉[（(]立裸松.*$/u, "麻六记酸辣粉（立棵松…")
    .replace(/醉国[（(]刀府峪物夫店[）)]/g, "醉面（万寿路店）")
    .replace(/a奏记|老奏记/g, "老秦记")
    .replace(/tihd 瑅瑚小馆/g, "tíhú 瑅瑚小馆")
    .replace(/小漁郎/g, "小渔郎")
    .replace(/老馋口\./g, "老馋口·")
    .replace(/遛巷\./g, "遛巷·")
    .replace(/活虾\.麻辣香锅/g, "活虾·麻辣香锅")
    .replace(/宏福芦\./g, "宏福芦·")
    .replace(/发向檔连爆浆之士饼/g, "爱尚榴莲爆浆芝士饼")
    .replace(/九品石道口束烊/g, "九品五道口枣糕")
    .replace(/\s*[·•]\s*/g, "·")
    .replace(/[：:]\s*$/u, "");
  value = value.replace(/\s*[.．…⋯]+\s*$/u, "…");
  return value.trim();
};

const numberFrom = (text, fallback = null) => {
  const match = text.match(/(\d+(?:\.\d+)?)/u);
  return match ? Number(match[1]) : fallback;
};

const salesFrom = (text) => {
  const match = text.match(/月售\s*(\d+(?:\.\d+)?)\s*(万)?/u);
  if (!match) return { sales: 0, salesText: "月售信息未识别" };
  const amount = Number(match[1]) * (match[2] ? 10000 : 1);
  return {
    sales: Math.round(amount),
    salesText: match[0].replace(/\s+/g, ""),
  };
};

const deliveryFrom = (block) => {
  const text = block.map((line) => line.text).join(" ");
  const minOrderMatch = text.match(/起送\s*[¥￥]\s*(\d+(?:\.\d+)?)/u);
  const feeMatch =
    text.match(/配送\s*约?\s*[¥￥]\s*(\d+(?:\.\d+)?)/u) ??
    text.match(/满\s*\d+(?:\.\d+)?\s*配送\s*约\s*[¥￥]\s*(\d+(?:\.\d+)?)/u);
  const mode = ["美团专送", "美团快送", "商家自配"].find((value) =>
    text.includes(value)
  );
  return {
    minOrder: minOrderMatch ? Number(minOrderMatch[1]) : null,
    deliveryFee: /免配送费/u.test(text) ? 0 : feeMatch ? Number(feeMatch[1]) : null,
    deliveryMode: mode ?? "",
  };
};

const distanceFrom = (block) => {
  const text = block.map((line) => line.text).join(" ");
  const km = text.match(/(\d+(?:\.\d+)?)\s*km/u);
  const meters = text.match(/(\d+)\s*m(?![a-z])/iu);
  const minutes = text.match(/(\d+)\s*分钟/u);
  const distance = km
    ? Math.round(Number(km[1]) * 1000)
    : meters
      ? Number(meters[1])
      : null;
  return {
    distance,
    distanceText:
      distance == null
        ? "距离未识别"
        : distance < 1000
          ? `${distance}m`
          : `${(distance / 1000).toFixed(1)}km`,
    deliveryMin: minutes ? Number(minutes[1]) : null,
  };
};

const inferGroup = (name) => {
  if (
    /奶茶|咖啡|茶饮|甜品|蛋糕|面包|糕点|桃酥|糖葫芦|冰淇淋|冰室|酸奶|甜点|糖水|梨汤|点心|桃酥|小贝|贝果/u.test(
      name
    )
  ) {
    return "dessert";
  }
  if (
    /汉堡|比萨|披萨|牛排|墨西哥|三明治|意面|烤鸡|炸鸡|赛百味|Wagas|超模厨房|鸡蛋灌饼/u.test(
      name
    )
  ) {
    return "western";
  }
  if (
    /寿司|日式|韩式|居酒屋|炸猪排|咖喱|饭团|紫菜包饭|烧肉|村上一屋|日料|拌饭/u.test(
      name
    )
  ) {
    return "jpkr";
  }
  if (/烧烤|炸串|烤串|卤味|卤煮|熟食|鸭脖|猪脚|鸡架|熏肉/u.test(name)) {
    return "bbq";
  }
  if (/火锅|涮肉|麻辣烫|冒菜|香锅|焖锅|烤鱼|龙虾|羊蝎子|牛蛙/u.test(name)) {
    return "hotpot";
  }
  if (
    /川菜|川小馆|湘菜|湘味|湖南|重庆|麻辣|辣子|酸辣|贵州|宜宾|眉州东坡|水煮鱼|酸菜鱼|毛血旺|辣椒炒肉|盖码/u.test(
      name
    )
  ) {
    return "spicy";
  }
  if (
    /粤菜|潮汕|潮粤|顺德|江浙|上海|徽菜|湖北|福建|云南|淮扬|海南|粤|港式|小笼|生煎|南京|杭州|江南|越南|福萬|酒家/u.test(
      name
    )
  ) {
    return "southern";
  }
  if (
    /北京|京味|东北|饺子|包子|烧饼|肉饼|馅饼|煎饼|春饼|馍|馄饨|羊肉|河南|西安|陕西|新疆|内蒙|山西|晋|鲁菜|驴肉|火烧|卤煮/u.test(
      name
    )
  ) {
    return "northern";
  }
  if (/米线|米粉|面|粉|粥|炒饭|盖饭|烩饭|饭團|饭团|汤包/u.test(name)) {
    return "quick";
  }
  return "home";
};

const groupMeta = {
  northern: ["北方风味", "面食、饼、饺子和京味小吃"],
  spicy: ["川湘辣味", "川菜、湘菜、贵州与重庆风味"],
  southern: ["南方菜系", "粤菜、江浙、云南与东南风味"],
  bbq: ["烧烤卤味", "烤串、炸串、卤味和熟食"],
  hotpot: ["火锅香锅", "火锅、烤鱼、冒菜和锅物"],
  western: ["汉堡西餐", "汉堡、比萨、牛排与轻食"],
  jpkr: ["日韩料理", "寿司、日式便当、韩餐和咖喱"],
  dessert: ["烘焙甜饮", "面包、点心、咖啡和甜饮"],
  quick: ["面饭粥粉", "面、粉、粥、饭和快捷主食"],
  home: ["家常小炒", "家常菜、小炒和综合餐厅"],
};

const tagsFor = (shop) => {
  const tags = [];
  if (shop.rating >= 4.8) tags.push("高分");
  if (shop.deliveryMin != null && shop.deliveryMin <= 25) tags.push("送得快");
  if (shop.distance != null && shop.distance <= 1000) tags.push("离得近");
  if (shop.deliveryFee === 0) tags.push("免配送费");
  if (shop.minOrder != null && shop.minOrder <= 20) tags.push("低起送");
  if (shop.sales >= 3000) tags.push("高月售");
  return tags;
};

const screenshotHeight = (file) => {
  const result = execFileSync(
    "sips",
    ["-g", "pixelHeight", "-g", "pixelWidth", file],
    { encoding: "utf8" }
  );
  const height = result.match(/pixelHeight:\s*(\d+)/u)?.[1];
  const width = result.match(/pixelWidth:\s*(\d+)/u)?.[1];
  if (!height || !width) throw new Error(`Cannot read image dimensions: ${file}`);
  return { width: Number(width), height: Number(height) };
};

const docs = readJsonLines(ocrPath).sort((a, b) => a.image.localeCompare(b.image));
const candidates = [];
for (const doc of docs) {
  const source = path.join(screenshotDir, doc.image);
  const dimensions = screenshotHeight(source);
  const lines = [...doc.lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const monthLines = lines.filter(
    (line) => line.x > 0.33 && line.x < 0.44 && /^月售/u.test(line.text)
  );
  const titleLines = monthLines
    .map((month) => {
      const line = [...lines]
        .reverse()
        .find(
          (near) =>
            near.y < month.y &&
            near.y >= month.y - 0.004 &&
            near.x > 0.33 &&
            near.x < 0.44 &&
            near.text.length >= 2 &&
            !/^(月售|起送|神券|热销|一口价|收藏|新客|必|堂食|¥|￥|\d)/u.test(
              near.text
            ) &&
            !rejectedNames.has(near.text.trim())
        );
      return line ? { line, month } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.line.y - b.line.y);

  for (let index = 0; index < titleLines.length; index += 1) {
    const { line, month } = titleLines[index];
    if (line.y > 0.985) continue;
    const nextTitle = titleLines[index + 1];
    const block = lines.filter(
      (near) =>
        near.y >= line.y &&
        near.y < (nextTitle?.line.y ?? line.y + 0.014)
    );
    const ratingLine = block.find((near) => /^[1-5]\.\d\s*分/u.test(near.text));
    const monthText = block.map((near) => near.text).join(" ");
    const sales = salesFrom(month.text);
    const delivery = deliveryFrom(block);
    const route = distanceFrom(block);
    const name = cleanName(line.text);
    if (!name || rejectedNames.has(name)) continue;
    candidates.push({
      name,
      source: path.basename(doc.image),
      sourcePath: source,
      sourceY: line.y,
      sourceXPx: Math.round(line.x * dimensions.width),
      sourceYPx: Math.round(line.y * dimensions.height),
      imageHeight: dimensions.height,
      imageWidth: dimensions.width,
      rating: ratingLine ? numberFrom(ratingLine.text) : null,
      ...sales,
      ...delivery,
      ...route,
      promotions: block
        .filter((near) => /^(神券|热销|一口价|收藏|新客)/u.test(near.text))
        .map((near) => near.text),
      cardText: monthText,
      confidence: line.confidence,
    });
  }
}

const normalizeForDedup = (name) =>
  name
    .replace(/[·•.\s（）()]/g, "")
    .replace(/[⋯…]+/g, "")
    .toLowerCase();

const hasOpenOnly = (name) => /[（(]\s*$/u.test(name);

const deduped = [];
const byKey = new Map();
for (const candidate of candidates) {
  if (hasOpenOnly(candidate.name) || /[•·-]$/u.test(candidate.name)) continue;
  const key = normalizeForDedup(candidate.name);
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, candidate);
    deduped.push(candidate);
    continue;
  }
  if (candidate.confidence > existing.confidence) {
    const index = deduped.indexOf(existing);
    deduped[index] = candidate;
    byKey.set(key, candidate);
  }
}

const shops = deduped.map((candidate, index) => {
  const id = `shop-${String(index + 1).padStart(3, "0")}`;
  const group = inferGroup(candidate.name);
  const [category, description] = groupMeta[group];
  return {
    id,
    name: candidate.name,
    image: `assets/shops/${id}.jpg`,
    source: candidate.source,
    sourceY: candidate.sourceYPx,
    rating: candidate.rating,
    sales: candidate.sales,
    salesText: candidate.salesText,
    distance: candidate.distance,
    distanceText: candidate.distanceText,
    deliveryMin: candidate.deliveryMin,
    minOrder: candidate.minOrder,
    deliveryFee: candidate.deliveryFee,
    deliveryMode: candidate.deliveryMode,
    promotions: [...new Set(candidate.promotions)].slice(0, 2),
    group,
    category,
    description,
    clipped: /[.．⋯…]$/u.test(candidate.name),
    tags: tagsFor(candidate),
    sourceNote: `${candidate.source} · 第 ${candidate.sourceYPx}px 行`,
  };
});
const sourcePathsById = new Map(
  shops.map((shop, index) => [shop.id, deduped[index].sourcePath])
);

const outputShops = path.join(root, "assets", "shops");
fs.mkdirSync(outputShops, { recursive: true });
const crops = shops.map((shop) => {
  const source = sourcePathsById.get(shop.id);
  if (!source) throw new Error(`Missing source for ${shop.name}`);
  const titleY = Number(shop.sourceY);
  return {
    source,
    output: `${shop.id}.jpg`,
    x: 56,
    y: Math.max(0, titleY - 18),
    width: 316,
    height: 316,
  };
});

const manifestPath = path.join(os.tmpdir(), "roll-crop-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(crops), "utf8");
const cropResult = spawnSync(
  "swift",
  [path.join(root, "scripts", "crop-screenshots.swift"), manifestPath, outputShops],
  { encoding: "utf8" }
);
if (cropResult.status !== 0) {
  process.stderr.write(cropResult.stdout);
  process.stderr.write(cropResult.stderr);
  process.exit(cropResult.status ?? 1);
}

const sourceManifest = docs.map((doc) => {
  const source = path.join(screenshotDir, doc.image);
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(source))
    .digest("hex");
  return { file: doc.image, sha256: hash };
});

const meta = {
  builtAt: snapshotDate,
  area: "北京 · 五棵松 / 公主坟 / 翠微生活圈",
  sourceCount: docs.length,
  shopCount: shops.length,
  dataKind: "meituan-screenshot-snapshot",
  liveData: false,
  groups: Object.entries(groupMeta).map(([key, [name, description]]) => ({
    key,
    name,
    description,
  })),
  sources: sourceManifest,
  disclaimer:
    "评分、月售、距离、配送时长、起送价与配送费均来自 2026-11-19 的美团截图快照；实时价格、营业状态、可售菜单、配送范围与优惠以美团结算页为准。",
};

const payload = { meta, shops };
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(
  path.join(root, "data", "shops.js"),
  `window.ROLL_DATA = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8"
);
fs.writeFileSync(
  path.join(root, "data", "shops.json"),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8"
);

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csvRows = [
  [
    "id",
    "name",
    "category",
    "group",
    "rating",
    "sales",
    "distance_m",
    "delivery_min",
    "min_order",
    "delivery_fee",
    "delivery_mode",
    "source_screenshot",
    "source_y",
  ],
  ...shops.map((shop) => [
    shop.id,
    shop.name,
    shop.category,
    shop.group,
    shop.rating,
    shop.sales,
    shop.distance,
    shop.deliveryMin,
    shop.minOrder,
    shop.deliveryFee,
    shop.deliveryMode,
    shop.source,
    shop.sourceY,
  ]),
];
fs.writeFileSync(
  path.join(root, "data", "shops.csv"),
  `${csvRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
  "utf8"
);

console.log(
  `Built ${shops.length} merchants from ${docs.length} screenshots; ${manifestPath}`
);

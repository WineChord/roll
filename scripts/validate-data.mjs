import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "data", "shops.js"), "utf8"),
  context,
  { filename: "data/shops.js" }
);
const { meta, shops } = context.window.ROLL_DATA;
const failures = [];
const jsonPayload = JSON.parse(
  fs.readFileSync(path.join(root, "data", "shops.json"), "utf8")
);
const csvLines = fs
  .readFileSync(path.join(root, "data", "shops.csv"), "utf8")
  .trim()
  .split("\n");

if (!meta || !Array.isArray(shops)) failures.push("dataset shape is invalid");
if (meta.sourceCount !== 7) failures.push("source count is not 7");
if (meta.shopCount !== shops.length) failures.push("shopCount does not match shops");
if (jsonPayload.shops?.length !== shops.length) failures.push("JSON export is stale");
if (csvLines.length !== shops.length + 1) failures.push("CSV export is stale");
if (shops.length < 400) failures.push("merchant pool unexpectedly small");
if (new Set(shops.map((shop) => shop.id)).size !== shops.length) {
  failures.push("shop ids are not unique");
}
if (new Set(shops.map((shop) => shop.name)).size < shops.length * 0.95) {
  failures.push("too many duplicate names remain");
}

for (const source of meta.sources) {
  if (!/^[a-f0-9]{64}$/.test(source.sha256)) {
    failures.push(`invalid source hash: ${source.file}`);
  }
}

for (const shop of shops) {
  const imagePath = path.join(root, shop.image);
  if (!fs.existsSync(imagePath)) failures.push(`missing image: ${shop.image}`);
  if (!(fs.statSync(imagePath).size > 1000)) failures.push(`tiny image: ${shop.image}`);
  if (!shop.name || !shop.category || !shop.group) {
    failures.push(`incomplete shop: ${shop.id}`);
  }
}

const ratingCoverage = shops.filter((shop) => Number.isFinite(shop.rating)).length / shops.length;
const routeCoverage =
  shops.filter(
    (shop) => Number.isFinite(shop.deliveryMin) && Number.isFinite(shop.minOrder)
  ).length / shops.length;
if (ratingCoverage < 0.98) failures.push(`rating coverage too low: ${ratingCoverage}`);
if (routeCoverage < 0.98) failures.push(`delivery coverage too low: ${routeCoverage}`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Validated ${shops.length} shops, ${meta.sourceCount} screenshots, ${Math.round(
    ratingCoverage * 100
  )}% rating coverage`
);

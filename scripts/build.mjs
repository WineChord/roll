import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const entry of [
  "index.html",
  "styles.css",
  "app-core.js",
  "app.js",
  "inventory.html",
  "inventory.js",
  "inventory.css",
  "data",
  "assets",
]) {
  const source = path.join(root, entry);
  const target = path.join(output, entry);
  fs.cpSync(source, target, { recursive: true });
}

console.log(`Built static site in ${output}`);

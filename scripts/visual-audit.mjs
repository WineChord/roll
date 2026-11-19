import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.ROLL_URL || "http://127.0.0.1:4173/";
const output = path.resolve("visual-audit");
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

for (const target of [
  { name: "desktop", width: 1440, height: 1000, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  const context = await browser.newContext({
    viewport: { width: target.width, height: target.height },
    isMobile: target.mobile,
    hasTouch: target.mobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(output, `${target.name}-page.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(output, `${target.name}-top.png`),
    fullPage: false,
  });
  const metrics = await page.evaluate(() => ({
    title: document.title,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    cards: document.querySelectorAll(".shop-card").length,
    brokenImages: [...document.images].filter(
      (image) => image.complete && image.naturalWidth === 0
    ).length,
    heroHeight: document.querySelector(".hero")?.getBoundingClientRect().height,
  }));
  await page.getByRole("button", { name: "Roll 一次" }).click();
  await page.locator("#resultPanel").waitFor({ state: "visible" });
  await page.screenshot({
    path: path.join(output, `${target.name}-result.png`),
    fullPage: false,
  });
  await page.goto(`${baseURL.replace(/\/$/, "")}/inventory.html`, {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: path.join(output, `${target.name}-inventory.png`),
    fullPage: false,
  });
  results.push({ target: target.name, ...metrics, errors });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

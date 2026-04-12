import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = `file://${join(__dirname, "..", "index.html")}`;

const viewports = [
  { name: "iphone-se",   width: 375,  height: 667 },
  { name: "iphone-14",   width: 390,  height: 844 },
  { name: "ipad-mini",   width: 768,  height: 1024 },
  { name: "ipad-pro",    width: 1024, height: 1366 },
  { name: "laptop",      width: 1440, height: 900 },
  { name: "desktop-xl",  width: 1920, height: 1080 },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(url, { waitUntil: "networkidle" });
  // scroll through entire page to trigger animations
  await page.evaluate(() => {
    document.querySelectorAll("[data-reveal]").forEach(el => el.classList.add("visible"));
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(__dirname, "..", `screenshots/responsive-${vp.name}.png`),
    fullPage: true,
  });
  console.log(`✓ ${vp.name} (${vp.width}x${vp.height})`);
  await page.close();
}

await browser.close();
console.log("\nDone! Check screenshots/ folder.");

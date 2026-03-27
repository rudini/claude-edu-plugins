/**
 * Capture Kahoot screenshots using Playwright for use in the Remotion video.
 * These screenshots serve as realistic backdrops for the animated demo.
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "screenshots");
mkdirSync(outDir, { recursive: true });

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });

  // --- 1. Kahoot landing page ---
  const page = await ctx.newPage();
  await page.goto("https://kahoot.com", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(outDir, "kahoot-landing.png") });
  console.log("✓ kahoot-landing.png");

  // --- 2. Kahoot create page ---
  await page.goto("https://create.kahoot.it", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(outDir, "kahoot-create.png") });
  console.log("✓ kahoot-create.png");

  // --- 3. Kahoot game pin screen ---
  await page.goto("https://kahoot.it", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(outDir, "kahoot-join.png") });
  console.log("✓ kahoot-join.png");

  await browser.close();
  console.log("\nDone! Screenshots saved to ./screenshots/");
}

capture().catch((err) => {
  console.error("Screenshot capture failed:", err.message);
  console.log("Continuing without screenshots — the video will use styled mockups instead.");
  process.exit(0);
});

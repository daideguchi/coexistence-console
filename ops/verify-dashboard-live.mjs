#!/usr/bin/env node
/**
 * Live Dashboard verification for Coexistence Console.
 * Checks the judge-facing dashboard story, real Queue Workbench, and optional translation UX.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';

const MEDIA_DIR = '/Users/dd/000_AI組織/__hackason/coexistence-console/media';
const STORAGE_STATE = '/Users/dd/000_AI組織/ops/reddit_storage_state.json';
const DASHBOARD_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td71v6/coexistence_console_dashboard/?playtest=super-consolex';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function surfaces(page) {
  return [page, ...page.frames()];
}

async function pageText(page) {
  const chunks = [];
  for (const surface of surfaces(page)) {
    try {
      chunks.push(await surface.locator('body').innerText({ timeout: 1000 }));
    } catch {
      // Some frames are cross-origin or not ready. Ignore them.
    }
  }
  return chunks.join('\n\n');
}

async function waitForText(page, pattern, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastSeen = '';
  while (Date.now() < deadline) {
    for (const surface of surfaces(page)) {
      try {
        await surface.getByText(pattern).first().waitFor({ timeout: 500 });
        return await pageText(page);
      } catch {
        // Fall through to body polling.
      }
    }
    const text = await pageText(page);
    lastSeen = text.slice(0, 2000);
    if (pattern.test(text)) return text;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${pattern}. Last text: ${lastSeen}`);
}

async function hasVisibleText(page, pattern) {
  for (const surface of surfaces(page)) {
    try {
      await surface.getByText(pattern).first().waitFor({ timeout: 500 });
      return true;
    } catch {
      // Fall through to body text.
    }
  }
  const text = await pageText(page);
  return pattern.test(text);
}

async function clickText(page, text, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const surface of surfaces(page)) {
      const locators = [
        surface.getByRole('button', { name: text, exact: true }).first(),
        surface.locator('button').filter({ hasText: text }).first(),
        surface.getByText(text, { exact: true }).first(),
      ];
      for (const locator of locators) {
        try {
          await locator.scrollIntoViewIfNeeded({ timeout: 1000 });
          await locator.click({ timeout: 1000 });
          console.log(`clicked: ${text}`);
          return true;
        } catch (error) {
          lastError = error;
        }
      }
    }
    await sleep(500);
  }
  throw new Error(`Could not click "${text}": ${lastError?.message || 'not found'}`);
}

async function screenshot(page, name) {
  const path = `${MEDIA_DIR}/${name}`;
  await page.screenshot({ path, fullPage: false });
  console.log(path);
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  const report = {
    url: DASHBOARD_URL,
    versionExpectation: 'v0.0.54 playtest',
    hasFutureModeratorTagline: false,
    hasQueueWorkbench: false,
    hasTranslateButton: false,
    clickedTranslate: false,
    hasTranslation: false,
    hasTranslationFailure: false,
  };

  try {
    await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForText(
      page,
      /Governance rails for human moderators today, and AI moderators tomorrow\.|今日の人間モデレーターにも、明日のAIモデレーターにも役立つ統治レール。|Queue Workbench|キューワークベンチ/,
      60000
    );
    report.hasFutureModeratorTagline = await hasVisibleText(page, /Governance rails for human moderators today, and AI moderators tomorrow\.|今日の人間モデレーターにも、明日のAIモデレーターにも役立つ統治レール。/);
    report.hasQueueWorkbench = await hasVisibleText(page, /Queue Workbench|キューワークベンチ/);
    report.hasTranslateButton = await hasVisibleText(page, /Translate Preview|投稿プレビューを翻訳/);
    await screenshot(page, 'fresh-v044-dashboard.png');

    if (report.hasTranslateButton) {
      const translateLabel = await hasVisibleText(page, /Translate Preview/) ? 'Translate Preview' : '投稿プレビューを翻訳';
      await clickText(page, translateLabel, 30000);
      report.clickedTranslate = true;
      await sleep(3000);
      const afterClick = await pageText(page);
      report.hasTranslationFailure = /Translation failed|Add a Gemini API key|翻訳に失敗|Gemini APIキー/.test(afterClick);
      if (!report.hasTranslationFailure) {
        try {
          await waitForText(page, /Moderator Translation|モデレーター向け翻訳|Translating\.\.\.|翻訳中/, 90000);
        } catch {
          // Keep the report honest below. Screenshot still captures the actual state.
        }
      }
      const translatedText = await pageText(page);
      report.hasTranslation = /Moderator Translation|モデレーター向け翻訳/.test(translatedText) || await hasVisibleText(page, /Moderator Translation|モデレーター向け翻訳/);
      report.hasTranslationFailure = report.hasTranslationFailure || /Translation failed|Add a Gemini API key|翻訳に失敗|Gemini APIキー/.test(translatedText);
      await screenshot(page, 'fresh-v044-dashboard-translation.png');
    }

    await writeFile(`${MEDIA_DIR}/fresh-v044-dashboard-report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));

    if (!report.hasFutureModeratorTagline) throw new Error('Future moderator tagline was not visible.');
    if (!report.hasQueueWorkbench) throw new Error('Queue Workbench was not visible.');
    if (!report.hasTranslateButton) throw new Error('Translate Preview button was not visible.');
    if (report.clickedTranslate && report.hasTranslationFailure) throw new Error('Translate Preview showed a provider/config failure.');
  } catch (error) {
    await screenshot(page, 'fresh-v044-dashboard-error.png').catch(() => {});
    await writeFile(`${MEDIA_DIR}/fresh-v044-dashboard-report.json`, `${JSON.stringify({ ...report, error: String(error) }, null, 2)}\n`);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

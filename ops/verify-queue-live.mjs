#!/usr/bin/env node
/**
 * Live Queue verification for Coexistence Console.
 * Opens the playtest subreddit, finds the newest Review Queue post, and verifies it renders as Devvit UI.
 */

import { chromium } from 'playwright';
import { access, mkdir, writeFile } from 'fs/promises';

const MEDIA_DIR = '/Users/dd/000_AI組織/__hackason/coexistence-console/media';
const STORAGE_STATE = '/Users/dd/000_AI組織/ops/reddit_storage_state.json';
const SUBREDDIT_URL = 'https://www.reddit.com/r/super_consolex_dev/?playtest=super-consolex';
const LOCAL_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchBrowser() {
  const launchOptions = { headless: false, slowMo: 80 };
  try {
    await access(LOCAL_CHROME_PATH);
    launchOptions.executablePath = LOCAL_CHROME_PATH;
  } catch {
    // Fall back to Playwright's bundled browser when it is installed.
  }
  return chromium.launch(launchOptions);
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
      // Ignore cross-origin or hydrating frames.
    }
  }
  return chunks.join('\n\n');
}

async function hasVisibleText(page, pattern) {
  for (const surface of surfaces(page)) {
    try {
      await surface.getByText(pattern).first().waitFor({ timeout: 500 });
      return true;
    } catch {
      // Fall through.
    }
  }
  return pattern.test(await pageText(page));
}

async function waitForVisibleText(page, pattern, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastSeen = '';
  while (Date.now() < deadline) {
    if (await hasVisibleText(page, pattern)) return true;
    lastSeen = (await pageText(page)).slice(0, 2000);
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${pattern}. Last text: ${lastSeen}`);
}

async function screenshot(page, name) {
  const path = `${MEDIA_DIR}/${name}`;
  await page.screenshot({ path, fullPage: false });
  console.log(path);
}

async function gotoPage(page, url, timeout = 90000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (error) {
    if (!String(error).includes('Timeout')) throw error;
    console.log(`navigation timeout; continuing with current document: ${url}`);
  }
  await sleep(3000);
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });
  const browser = await launchBrowser();
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  const report = {
    url: SUBREDDIT_URL,
    versionExpectation: 'v0.0.54 playtest',
    foundQueuePost: false,
    queuePostUrl: '',
    hasQueueUi: false,
    hasQueuedFilter: false,
    hasOpenPost: false,
    hasTranslatePreview: false,
  };

  try {
    await gotoPage(page, SUBREDDIT_URL, 90000);
    await waitForVisibleText(page, /Coexistence Review Queue/, 60000);
    report.foundQueuePost = true;
    await screenshot(page, 'fresh-v044-queue-feed.png');

    const queueLink = page
      .locator('a[href*="/comments/"]')
      .filter({ hasText: /Coexistence Review Queue/ })
      .first();
    const href = await queueLink.getAttribute('href', { timeout: 10000 });
    if (!href) throw new Error('Queue post link href was not found.');
    report.queuePostUrl = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
    const playtestUrl = report.queuePostUrl.includes('?')
      ? `${report.queuePostUrl}&playtest=super-consolex`
      : `${report.queuePostUrl}?playtest=super-consolex`;

    await gotoPage(page, playtestUrl, 90000);
    await waitForVisibleText(page, /Coexistence Queue|レビューキュー/, 60000);
    report.hasQueueUi = true;
    report.hasQueuedFilter = await hasVisibleText(page, /Queued|未処理/);
    report.hasOpenPost = await hasVisibleText(page, /Open Post|投稿を開く/);
    report.hasTranslatePreview = await hasVisibleText(page, /Translate Preview|投稿プレビューを翻訳/);
    await screenshot(page, 'fresh-v044-queue-page.png');

    await writeFile(`${MEDIA_DIR}/fresh-v044-queue-report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));

    if (!report.hasQueuedFilter || !report.hasOpenPost || !report.hasTranslatePreview) {
      throw new Error('Queue UI rendered but required controls were missing.');
    }
  } catch (error) {
    await screenshot(page, 'fresh-v044-queue-error.png').catch(() => {});
    await writeFile(`${MEDIA_DIR}/fresh-v044-queue-report.json`, `${JSON.stringify({ ...report, error: String(error) }, null, 2)}\n`);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

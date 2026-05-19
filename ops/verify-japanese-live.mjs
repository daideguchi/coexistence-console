#!/usr/bin/env node
/**
 * Japanese UI verification for Coexistence Console.
 * Uses the in-console language switcher, then captures Dashboard / Queue / Policy / Analytics.
 */

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'fs/promises';

const MEDIA_DIR = '/Users/dd/000_AI組織/__hackason/coexistence-console/media';
const STORAGE_STATE = '/Users/dd/000_AI組織/ops/reddit_storage_state.json';
const SUBREDDIT_URL = 'https://www.reddit.com/r/super_consolex_dev/?playtest=super-consolex';
const DASHBOARD_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td71v6/coexistence_console_dashboard/?playtest=super-consolex';
const POLICY_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td74wd/coexistence_policy_editor/?playtest=super-consolex';
const ANALYTICS_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td754t/community_analytics_dashboard/?playtest=super-consolex';

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
      // Ignore unavailable frames.
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
        // Fall through.
      }
    }
    const text = await pageText(page);
    lastSeen = text.slice(0, 2000);
    if (pattern.test(text)) return text;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${pattern}. Last text: ${lastSeen}`);
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
          await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
          await locator.click({ timeout: 2000 });
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

async function gotoPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  } catch (error) {
    if (!String(error).includes('Timeout')) throw error;
    console.log(`navigation timeout; continuing with current document: ${url}`);
  }
  await sleep(3000);
}

async function newestQueueUrl(page) {
  try {
    const previous = JSON.parse(await readFile(`${MEDIA_DIR}/fresh-v044-queue-report.json`, 'utf8'));
    if (previous.queuePostUrl) {
      return previous.queuePostUrl.includes('?')
        ? `${previous.queuePostUrl}&playtest=super-consolex`
        : `${previous.queuePostUrl}?playtest=super-consolex`;
    }
  } catch {
    // Fall back to subreddit discovery below.
  }

  await gotoPage(page, SUBREDDIT_URL);
  await waitForText(page, /Coexistence Review Queue/, 60000);
  const link = page
    .locator('a[href*="/comments/"]')
    .filter({ hasText: /Coexistence Review Queue/ })
    .first();
  const href = await link.getAttribute('href', { timeout: 10000 });
  if (!href) throw new Error('Could not find queue post URL.');
  const url = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
  return url.includes('?') ? `${url}&playtest=super-consolex` : `${url}?playtest=super-consolex`;
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
  });
  const page = await context.newPage();

  const report = {
    dashboardJapanese: false,
    queueJapanese: false,
    policyJapanese: false,
    analyticsJapanese: false,
    queueUrl: '',
  };

  try {
    await gotoPage(page, DASHBOARD_URL);
    await waitForText(page, /EN|日本語|Queue Workbench|キューワークベンチ/, 90000);
    const dashboardBeforeClick = await pageText(page);
    if (!/今日の人間モデレーターにも、明日のAIモデレーターにも役立つ統治レール。|キューワークベンチ/.test(dashboardBeforeClick)) {
      await clickText(page, '日本語', 60000);
    }
    await waitForText(page, /今日の人間モデレーターにも、明日のAIモデレーターにも役立つ統治レール。|キューワークベンチ/, 60000);
    report.dashboardJapanese = true;
    await screenshot(page, 'fresh-v047-ja-dashboard.png');

    report.queueUrl = await newestQueueUrl(page);
    await gotoPage(page, report.queueUrl);
    await waitForText(page, /レビューキュー|投稿を開く|投稿プレビューを翻訳/, 60000);
    report.queueJapanese = true;
    await screenshot(page, 'fresh-v047-ja-queue.png');

    await gotoPage(page, POLICY_URL);
    await waitForText(page, /ポリシーエディタ|ワークフロー概要|ワークフロー設定|スタートモードを選ぶ|ポリシーを保存/, 60000);
    report.policyJapanese = true;
    await screenshot(page, 'fresh-v047-ja-policy.png');

    await gotoPage(page, ANALYTICS_URL);
    await waitForText(page, /コミュニティ分析|共存の可視化|ActionLog/, 60000);
    report.analyticsJapanese = true;
    await screenshot(page, 'fresh-v047-ja-analytics.png');

    await writeFile(`${MEDIA_DIR}/fresh-v047-ja-report.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await screenshot(page, 'fresh-v047-ja-error.png').catch(() => {});
    await writeFile(`${MEDIA_DIR}/fresh-v047-ja-report.json`, `${JSON.stringify({ ...report, error: String(error) }, null, 2)}\n`);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Live AI verification for Coexistence Console.
 * Uses the saved Reddit Playwright storage state and never reads or prints API secrets.
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const MEDIA_DIR = '/Users/dd/000_AI組織/__hackason/coexistence-console/media';
const STORAGE_STATE = '/Users/dd/000_AI組織/ops/reddit_storage_state.json';
const POLICY_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td74wd/coexistence_policy_editor/?playtest=super-consolex';
const ANALYTICS_URL = 'https://www.reddit.com/r/super_consolex_dev/comments/1td754t/community_analytics_dashboard/?playtest=super-consolex';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function surfaces(page) {
  return [page, ...page.frames()];
}

async function clickText(page, text, timeout = 20000) {
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
  throw new Error(`Could not click text "${text}": ${lastError?.message || 'not found'}`);
}

async function waitForText(page, pattern, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastSeen = '';
  while (Date.now() < deadline) {
    for (const surface of surfaces(page)) {
      try {
        await surface.getByText(pattern).first().waitFor({ timeout: 1000 });
        return pattern.toString();
      } catch {
        // Fall through to body text polling below.
      }
      try {
        const body = await surface.locator('body').innerText({ timeout: 1000 });
        lastSeen = body.slice(0, 1000);
        if (pattern.test(body)) return body;
      } catch {
        // Keep polling frames while the Devvit surface hydrates.
      }
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${pattern}. Last page text: ${lastSeen}`);
}

async function waitForTextWithout(page, successPattern, failurePattern, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastSeen = '';
  while (Date.now() < deadline) {
    for (const surface of surfaces(page)) {
      try {
        await surface.getByText(failurePattern).first().waitFor({ timeout: 500 });
        throw new Error(`Observed failure text while waiting for ${successPattern}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Observed failure text')) {
          throw error;
        }
      }
      try {
        await surface.getByText(successPattern).first().waitFor({ timeout: 500 });
        return successPattern.toString();
      } catch {
        // Fall through to body polling.
      }
      try {
        const body = await surface.locator('body').innerText({ timeout: 1000 });
        lastSeen = body.slice(0, 1600);
        if (failurePattern.test(body)) {
          throw new Error(`Observed failure text while waiting for ${successPattern}: ${body.slice(0, 800)}`);
        }
        if (successPattern.test(body)) return body;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Observed failure text')) {
          throw error;
        }
      }
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${successPattern}. Last page text: ${lastSeen}`);
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
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  try {
    await gotoPage(page, POLICY_URL, 90000);
    await waitForText(page, /Workflow rules|ワークフロー設定|AI Policy Copilot|Pick a starting mode|スタートモードを選ぶ/, 45000);
    // Reset console language to EN so AI Copilot labels stay in English for this verifier.
    try {
      await clickText(page, 'EN', 5000);
      await sleep(2000);
    } catch {
      // EN button may not always render in time; continue.
    }
    await waitForText(page, /Workflow rules|AI Policy Copilot|Pick a starting mode/, 45000);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await screenshot(page, 'fresh-v028-live-ai-policy-before.png');
    await clickText(page, 'Test AI', 45000);
    await sleep(5000);
    await screenshot(page, 'fresh-v028-live-ai-policy-after-test-click.png');
    await waitForTextWithout(
      page,
      /humans?\s+remain(?:s)?\s+in\s+control|(?:human )?moderators?\s+retain[s]?\s+(?:full\s+)?(?:final\s+)?editorial\s+control|moderator-reviewed policy drafting|connection verified|policy drafting|editorial control|AI copilot is connected/i,
      /prepayment credits are depleted|AI connection test failed|RESOURCE_EXHAUSTED|API key not valid/i,
      90000
    );
    await screenshot(page, 'fresh-v028-live-ai-policy-test.png');

    await clickText(page, 'Generate Drafts', 45000);
    await waitForText(page, /Draft Package|Generated\s+(?:Community Policy|Disclosure Request|Removal Reason|Sidebar\/Wiki Text|Review Checklist|Recommended Workflow Settings):/i, 120000);
    await screenshot(page, 'fresh-v028-live-ai-policy-drafts.png');

    await gotoPage(page, ANALYTICS_URL, 90000);
    await waitForText(page, /Community Pulse|Coexistence Visibility/, 45000);
    await clickText(page, 'AI Pulse', 45000);
    await waitForText(page, /AI summary/i, 90000);
    await screenshot(page, 'fresh-v028-live-ai-pulse.png');
  } catch (error) {
    await screenshot(page, 'fresh-v028-live-ai-error.png').catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

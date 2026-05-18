#!/usr/bin/env node
/**
 * Local Fireworks smoke test for Coexistence Console.
 * This is intentionally not a Devvit runtime verifier: Reddit's current
 * HTTP Fetch Policy only allows OpenAI and Google Gemini as AI providers.
 * Never print API keys from this script.
 */

import { existsSync, readFileSync } from 'fs';

const localEnvPath = new URL('../.fireworks.active.local.env', import.meta.url);

function readLocalEnv(name) {
  if (!existsSync(localEnvPath)) return '';
  const lines = readFileSync(localEnvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] === name) return match[2].replace(/^"|"$/g, '').trim();
  }
  return '';
}

const apiKey = readLocalEnv('FIREWORKS_API_KEY') || process.env.FIREWORKS_API_KEY;
const baseUrl = readLocalEnv('FIREWORKS_BASE_URL') || process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1';
const model = readLocalEnv('FIREWORKS_MODEL') || process.env.FIREWORKS_MODEL || 'accounts/fireworks/models/deepseek-v4-pro';

if (!apiKey) {
  console.error(JSON.stringify({
    ok: false,
    provider: 'fireworks',
    reason: 'FIREWORKS_API_KEY is not set',
  }, null, 2));
  process.exit(1);
}

const started = Date.now();
const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: 'Return only the final answer. One short sentence. No reasoning.',
      },
      {
        role: 'user',
        content: 'Confirm the AI copilot is connected and human moderators decide.',
      },
    ],
    temperature: 0,
    max_tokens: 64,
    reasoning_effort: 'none',
  }),
});

const data = await response.json().catch(() => ({}));
const message = data?.choices?.[0]?.message || {};
const text = (message.content || data?.choices?.[0]?.text || '').trim();

console.log(JSON.stringify({
  ok: response.ok && Boolean(text),
  provider: 'fireworks',
  model,
  status: response.status,
  ms: Date.now() - started,
  text: text.slice(0, 160),
  error: data?.error ? {
    type: data.error.type,
    message: String(data.error.message || '').slice(0, 220),
  } : null,
}, null, 2));

if (!response.ok || !text) process.exit(1);

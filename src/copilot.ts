import type { DisclosureStatus, ReviewSignals, SuggestedAction, SubredditPolicy } from './types.js';

export const DEFAULT_CLOUDFLARE_MODEL = '@cf/moonshotai/kimi-k2.6';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const SMARTEST_GEMINI_MODEL = 'gemini-3.1-pro-preview';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

const SYSTEM_PROMPT = 'You help Reddit moderators govern AI-era communities. Never claim to detect AI. Use concise, operational language. Return final answer text only.';

export type AIProvider = 'gemini' | 'cloudflare' | 'openai';

export type CloudflareAIConfig = {
  provider?: 'cloudflare';
  accountId: string;
  apiToken: string;
  model?: string;
};

export type GeminiAIConfig = {
  provider: 'gemini';
  apiKey: string;
  model?: string;
};

export type OpenAIAIConfig = {
  provider: 'openai';
  apiKey: string;
  model?: string;
};

export type ModeratorAIConfig = CloudflareAIConfig | GeminiAIConfig | OpenAIAIConfig;

type CloudflareAIResult = {
  response?: string;
  content?: string;
  output_text?: string;
  choices?: Array<{
    text?: string;
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
      reasoning?: string;
      reasoning_content?: string;
    };
  }>;
};

type GeminiAIResult = {
  error?: { message?: string };
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

type OpenAIResult = {
  error?: { message?: string };
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
};

const FORBIDDEN_TRIAGE_TERMS = [
  /AI detected/i,
  /confirmed AI/i,
  /fake human/i,
  /bot detected/i,
  /ban recommended/i,
  /probably AI/i,
  /\bAI-like\b/i,
];

export type PolicyDraftPackage = {
  policy: string;
  disclosure: string;
  removal: string;
  sidebar: string;
  checklist: string;
  workflow: string;
};

export type AITriageSuggestion = {
  label: string;
  action: SuggestedAction;
  reasons: string[];
  safety: string;
};

async function callModeratorAI(prompt: string, config: ModeratorAIConfig, maxTokens = 450): Promise<string> {
  if (config.provider === 'gemini') return callGeminiAI(prompt, config, maxTokens);
  if (config.provider === 'openai') return callOpenAI(prompt, config, maxTokens);
  return callCloudflareAI(prompt, config, maxTokens);
}

async function withTimeout<T>(promise: Promise<T>, label: string, ms = 45000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callCloudflareAI(prompt: string, config: CloudflareAIConfig, maxTokens = 450): Promise<string> {
  const model = config.model || DEFAULT_CLOUDFLARE_MODEL;
  const isKimi = model.includes('/kimi-');
  const body: Record<string, unknown> = {
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  };

  if (isKimi) {
    body.max_completion_tokens = maxTokens;
    body.chat_template_kwargs = { thinking: false };
  } else {
    body.max_tokens = maxTokens;
  }

  const res = await withTimeout(fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }), `Cloudflare Workers AI ${model}`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cloudflare Workers AI ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: CloudflareAIResult;
  };
  if (data.success === false) {
    throw new Error(data.errors?.map((err) => err.message).filter(Boolean).join('; ') || 'Cloudflare Workers AI request failed');
  }
  const output = extractCloudflareText(data.result).trim();
  if (!output) {
    throw new Error(`Cloudflare Workers AI returned an empty response for ${model}`);
  }
  return output;
}

function extractCloudflareText(result: CloudflareAIResult | undefined): string {
  if (!result) return '';
  if (typeof result.response === 'string') return result.response;
  if (typeof result.content === 'string') return result.content;
  if (typeof result.output_text === 'string') return result.output_text;
  const firstChoice = result.choices?.[0];
  const content = firstChoice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text || '').join('').trim();
  }
  if (typeof firstChoice?.text === 'string') return firstChoice.text;
  if (typeof firstChoice?.message?.reasoning === 'string') return firstChoice.message.reasoning;
  if (typeof firstChoice?.message?.reasoning_content === 'string') return firstChoice.message.reasoning_content;
  return '';
}

async function callGeminiAI(prompt: string, config: GeminiAIConfig, maxTokens = 450): Promise<string> {
  const model = config.model || DEFAULT_GEMINI_MODEL;
  const res = await withTimeout(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens,
      },
    }),
  }), `Gemini API ${model}`);

  const data = (await res.json().catch(() => ({}))) as GeminiAIResult;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Gemini API ${res.status}`);
  }
  const output = extractGeminiText(data).trim();
  if (!output) {
    throw new Error(`Gemini API returned an empty response for ${model}`);
  }
  return output;
}

function extractGeminiText(result: GeminiAIResult): string {
  const parts = result.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('').trim();
}

async function callOpenAI(prompt: string, config: OpenAIAIConfig, maxTokens = 450): Promise<string> {
  const model = config.model || DEFAULT_OPENAI_MODEL;
  const res = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  }), `OpenAI API ${model}`);

  const data = (await res.json().catch(() => ({}))) as OpenAIResult;
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `OpenAI API ${res.status}`);
  }
  const output = extractOpenAIText(data).trim();
  if (!output) {
    throw new Error(`OpenAI API returned an empty response for ${model}`);
  }
  return output;
}

function extractOpenAIText(result: OpenAIResult): string {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text || '').join('').trim();
  }
  return '';
}

export async function generateConnectionCheck(
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write one short sentence in ${languageName} confirming that the AI copilot is connected for moderator-reviewed policy drafting.
Mention that humans remain in control.
Do not mention detection or enforcement.`;
  return callModeratorAI(prompt, config);
}

export async function generatePolicyDraftPackage(
  tone: string,
  disclosureReq: string,
  policy: SubredditPolicy,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<PolicyDraftPackage> {
  try {
    const structured = await withTimeout(
      generateStructuredPolicyDraftPackage(tone, disclosureReq, policy, config, languageName),
      'Structured policy draft',
      18000
    );
    if (isCompletePolicyDraftPackage(structured)) return structured;
  } catch {
    // Fall back below. The copilot must remain usable even when a model ignores
    // the requested structure or a provider times out on a longer prompt.
  }

  const policyText = fallbackPolicyHeadline(disclosureReq, languageName);
  return buildDeterministicPackage(policyText, disclosureReq, policy, languageName);
}

function isCompletePolicyDraftPackage(draft: PolicyDraftPackage): boolean {
  return [
    draft.policy,
    draft.disclosure,
    draft.removal,
    draft.sidebar,
    draft.checklist,
    draft.workflow,
  ].every((value) => value.trim().length >= 12);
}

function fallbackPolicyHeadline(disclosureReq: string, languageName: string): string {
  if (languageName === 'Japanese') {
    return `このコミュニティはAI利用を一律に罰するのではなく、開示方針「${disclosureReq}」に沿って透明性と人間のモデレーター判断を重視します。`;
  }
  if (languageName === 'Spanish') {
    return `This community handles AI participation through ${disclosureReq} disclosure, transparency, and final human moderator judgment.`;
  }
  if (languageName === 'French') {
    return `This community manages AI participation through ${disclosureReq} disclosure, transparency, and final human moderator judgment.`;
  }
  return `This community handles AI participation through ${disclosureReq} disclosure, transparency, and final human moderator judgment.`;
}

function buildDeterministicPackage(
  policyText: string,
  disclosureReq: string,
  policy: SubredditPolicy,
  languageName: string
): PolicyDraftPackage {
  if (languageName === 'Japanese') {
    return {
      policy: policyText.trim(),
      disclosure: 'この投稿が人間による執筆、AI補助、AI生成のどれに当たるか返信で教えてください。開示は、投稿の価値を下げるためではなく、コミュニティの透明性を守るためのものです。',
      removal: 'この投稿はAI利用に関する開示が不足しているため削除されました。内容がルールに沿っている場合は、適切な開示を添えて再投稿できます。',
      sidebar: `AI利用は開示方針「${disclosureReq}」で運用します。モデレーターはAI判定ではなく、開示・文脈・重複・低文脈シグナルを確認し、人間が最終判断します。`,
      checklist: '- 開示状態を確認\n- AI生成/AI補助のルール適合を確認\n- 低文脈やテンプレ文を確認\n- 必要なら開示依頼を送る',
      workflow: `- AI生成: ${policy.aiGeneratedAction}\n- AI補助: ${policy.aiAssistedAction}\n- 未開示: ${policy.unknownAction}\n- 類似/低文脈: ${policy.similarityAction}/${policy.lowContextAction}`,
    };
  }
  return {
    policy: policyText.trim(),
    disclosure: 'Please reply to clarify whether this post is human-written, AI-assisted, or AI-generated. Disclosure helps the community stay transparent without treating AI assistance as a violation by itself.',
    removal: 'This post was removed because the community requires AI-use disclosure. If the content otherwise follows the rules, you may resubmit it with a clear disclosure.',
    sidebar: `AI-use disclosure mode: ${disclosureReq}. Moderators review disclosure, context, similarity, and low-context signals. The tool does not detect AI or accuse users; humans make the final decision.`,
    checklist: '- Check disclosure status\n- Compare against AI-generated and AI-assisted rules\n- Review similarity and low-context signals\n- Choose a human-confirmed action',
    workflow: `- AI-generated: ${policy.aiGeneratedAction}\n- AI-assisted: ${policy.aiAssistedAction}\n- Unknown disclosure: ${policy.unknownAction}\n- Similarity/low-context: ${policy.similarityAction}/${policy.lowContextAction}`,
  };
}

function parsePolicyDraftPackage(output: string): PolicyDraftPackage {
  return {
    policy: extractSection(output, 'POLICY') || output.trim(),
    disclosure: extractSection(output, 'DISCLOSURE'),
    removal: extractSection(output, 'REMOVAL'),
    sidebar: extractSection(output, 'SIDEBAR'),
    checklist: extractSection(output, 'CHECKLIST'),
    workflow: extractSection(output, 'WORKFLOW'),
  };
}

function extractSection(output: string, label: string): string {
  const labels = ['POLICY', 'DISCLOSURE', 'REMOVAL', 'SIDEBAR', 'CHECKLIST', 'WORKFLOW'];
  const nextLabels = labels.filter((candidate) => candidate !== label).join('|');
  const match = output.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:${nextLabels}):|$)`, 'i'));
  return (match?.[1] || '').trim();
}

function extractAnySection(output: string, label: string, labels: string[]): string {
  const nextLabels = labels.filter((candidate) => candidate !== label).join('|');
  const match = output.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:${nextLabels}):|$)`, 'i'));
  return (match?.[1] || '').trim();
}

function normalizeSuggestedAction(value: string): SuggestedAction {
  const normalized = value.toLowerCase().replace(/[^a-z]+/g, '_');
  if (normalized.includes('ask') || normalized.includes('disclosure')) return 'ask_disclosure';
  if (normalized.includes('label')) return 'apply_label';
  if (normalized.includes('remove')) return 'remove_with_reason';
  if (normalized.includes('approve')) return 'approve';
  if (normalized.includes('review')) return 'mark_reviewed';
  return 'mark_reviewed';
}

function includesForbiddenTriageLanguage(value: string): boolean {
  return FORBIDDEN_TRIAGE_TERMS.some((pattern) => pattern.test(value));
}

function labelClaimsAIUse(value: string): boolean {
  return /ai[-\s]?(assisted|generated)|AI(補助|生成)|人工知能(補助|生成)/i.test(value);
}

function fallbackTriageSuggestion(
  disclosureStatus: DisclosureStatus,
  reasons: string[],
  suggestedActions: SuggestedAction[],
  languageName: string
): AITriageSuggestion {
  let action = suggestedActions[0] || 'mark_reviewed';
  if (disclosureStatus === 'unknown' && action === 'apply_label') {
    action = 'ask_disclosure';
  }
  const label = (() => {
    if (action === 'ask_disclosure') return languageName === 'Japanese' ? '開示確認が必要' : 'Needs disclosure';
    if (action === 'apply_label' && disclosureStatus === 'ai_generated') return languageName === 'Japanese' ? 'AI生成（自己開示）' : 'AI-generated, self-disclosed';
    if (action === 'apply_label' && disclosureStatus === 'ai_assisted') return languageName === 'Japanese' ? 'AI補助（自己開示）' : 'AI-assisted, self-disclosed';
    if (action === 'remove_with_reason') return languageName === 'Japanese' ? 'ポリシー確認が必要' : 'Policy review';
    if (action === 'approve') return languageName === 'Japanese' ? 'ラベル不要' : 'No label needed';
    return languageName === 'Japanese' ? 'レビュー確認' : 'Policy review';
  })();
  return {
    label,
    action,
    reasons: reasons.slice(0, 3).length > 0
      ? reasons.slice(0, 3)
      : [languageName === 'Japanese' ? '既存のコミュニティポリシーに基づく確認候補です。' : 'Suggested from the current community policy signals.'],
    safety: languageName === 'Japanese'
      ? 'AIは断定や処分をしません。最終判断はモデレーターが行います。'
      : 'AI does not decide or punish. A moderator makes the final decision.',
  };
}

function sanitizeTriageSuggestion(
  suggestion: AITriageSuggestion,
  fallback: AITriageSuggestion,
  disclosureStatus: DisclosureStatus
): AITriageSuggestion {
  let label = includesForbiddenTriageLanguage(suggestion.label) ? fallback.label : suggestion.label;
  let action = suggestion.action;
  let reasons = suggestion.reasons.filter((reason) => !includesForbiddenTriageLanguage(reason));
  const safety = includesForbiddenTriageLanguage(suggestion.safety) ? fallback.safety : suggestion.safety;

  if (disclosureStatus === 'unknown' && (labelClaimsAIUse(label) || action === 'apply_label')) {
    label = fallback.label;
    action = 'ask_disclosure';
    reasons = fallback.reasons;
  }

  return {
    label,
    action,
    reasons: reasons.length > 0 ? reasons : fallback.reasons,
    safety,
  };
}

function parseTriageSuggestion(
  output: string,
  fallback: AITriageSuggestion,
  disclosureStatus: DisclosureStatus
): AITriageSuggestion {
  const labels = ['LABEL', 'ACTION', 'WHY', 'SAFETY'];
  const label = extractAnySection(output, 'LABEL', labels) || fallback.label;
  const action = normalizeSuggestedAction(extractAnySection(output, 'ACTION', labels) || fallback.action);
  const why = extractAnySection(output, 'WHY', labels);
  const reasons = why
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const safety = extractAnySection(output, 'SAFETY', labels) || fallback.safety;
  return sanitizeTriageSuggestion({
    label: label.replace(/["`]/g, '').trim() || fallback.label,
    action,
    reasons: reasons.length > 0 ? reasons : fallback.reasons,
    safety: safety.trim() || fallback.safety,
  }, fallback, disclosureStatus);
}

async function generateStructuredPolicyDraftPackage(
  tone: string,
  disclosureReq: string,
  policy: SubredditPolicy,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<PolicyDraftPackage> {
  const prompt = `Draft moderator-reviewed AI-era Reddit governance copy.
Write in ${languageName}.
Tone: ${tone}.
Disclosure requirement: ${disclosureReq}.
Actions: AI-generated=${policy.aiGeneratedAction}; AI-assisted=${policy.aiAssistedAction}; unknown=${policy.unknownAction}; similarity=${policy.similarityAction}; low-context=${policy.lowContextAction}.
Do not detect AI. Do not accuse users. Humans decide.
Return exact labels:
POLICY: 60 words max.
DISCLOSURE: 35 words max.
REMOVAL: 35 words max.
SIDEBAR: 50 words max.
CHECKLIST: 4 short bullets.
WORKFLOW: 4 short bullets.`;

  const output = await callModeratorAI(prompt, config, 520);
  return parsePolicyDraftPackage(output);
}

export async function generatePolicyDraft(
  tone: string,
  disclosureReq: string,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write a short AI content policy (under 150 words) for a subreddit.
Write in ${languageName}.
Tone: ${tone}.
Disclosure requirement: ${disclosureReq}.
Include:
1. What content requires disclosure
2. How to disclose
3. Consequences for non-disclosure
4. Moderator contact
Be concise and friendly.`;
  return callModeratorAI(prompt, config);
}

export async function generateDisclosureTemplate(
  tone: string,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write a short disclosure request comment (under 100 words) for a Reddit moderator to post.
Write in ${languageName}.
Tone: ${tone}.
Ask the user to clarify whether their post is human-written, AI-assisted, or AI-generated.
Include a brief explanation of why disclosure helps the community.`;
  return callModeratorAI(prompt, config);
}

export async function generateRemovalTemplate(
  tone: string,
  reason: string,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write a short removal reason comment (under 100 words) for a Reddit moderator.
Write in ${languageName}.
Tone: ${tone}.
Reason: ${reason}.
Explain why the post was removed and invite the user to resubmit with proper disclosure if applicable.`;
  return callModeratorAI(prompt, config);
}

export async function generateSidebarText(
  policy: SubredditPolicy,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write a concise sidebar/wiki explanation (under 200 words) for a subreddit's AI content policy.
Write in ${languageName}.
Disclosure: ${policy.disclosureRequirement}.
AI-Generated action: ${policy.aiGeneratedAction}.
AI-Assisted action: ${policy.aiAssistedAction}.
Unknown action: ${policy.unknownAction}.
Explain what users should do and how moderators handle violations.`;
  return callModeratorAI(prompt, config);
}

export async function generateReviewChecklist(
  policy: SubredditPolicy,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Write a short moderator review checklist (bullet points, under 150 words) for reviewing AI content in a subreddit.
Write in ${languageName}.
Check for:
- Disclosure status
- Policy match for AI-generated content (${policy.aiGeneratedAction})
- Policy match for AI-assisted content (${policy.aiAssistedAction})
- Similarity to recent posts (${policy.similarityAction})
- Low-context/template posts (${policy.lowContextAction})
Keep it actionable.`;
  return callModeratorAI(prompt, config);
}

export async function generateWorkflowRecommendation(
  policy: SubredditPolicy,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Recommend deterministic workflow settings for a subreddit AI-content governance tool.
Write in ${languageName}.
Do not claim to detect AI. Do not recommend automatic bans.
Current policy:
- Disclosure: ${policy.disclosureRequirement}
- AI-generated action: ${policy.aiGeneratedAction}
- AI-assisted action: ${policy.aiAssistedAction}
- Unknown disclosure action: ${policy.unknownAction}
- Similarity action: ${policy.similarityAction}
- Low-context action: ${policy.lowContextAction}
Return concise bullets under 150 words covering:
1. Queue reasons to enable
2. Labels to apply
3. When to ask disclosure
4. When removal is appropriate
5. Which actions require moderator confirmation`;
  return callModeratorAI(prompt, config);
}

export async function generateCommunityPulseSummary(
  facts: string,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Summarize this subreddit moderation pulse for moderators in under 80 words.
Do not accuse users of being AI. Do not recommend bans. Focus on practical next steps.
Write the response in ${languageName}.
Facts:
${facts}

Return:
1. One-sentence mood read
2. One practical moderator next move`;
  return callModeratorAI(prompt, config);
}

export async function generateAITriageSuggestion(
  input: {
    title: string;
    bodyPreview: string;
    disclosureStatus: DisclosureStatus;
    policyStatus: string;
    reasons: string[];
    suggestedActions: SuggestedAction[];
    signals: ReviewSignals;
    policy: SubredditPolicy;
  },
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<AITriageSuggestion> {
  const fallback = fallbackTriageSuggestion(input.disclosureStatus, input.reasons, input.suggestedActions, languageName);
  const prompt = `You are an AI Triage Assistant for Reddit moderators.
Write in ${languageName}.
Goal: reduce moderator reading time by suggesting a safe label and next action.
Never claim to detect AI. Never say "AI detected", "confirmed AI", "fake human", "bot detected", "ban recommended", "probably AI", or "AI-like".
If disclosureStatus is unknown, do not suggest AI-assisted or AI-generated labels. Suggest "Needs disclosure", "Policy review", "Needs source / verification", or "Low-context review".
If disclosureStatus is self-disclosed ai_assisted or ai_generated, labels may mention self-disclosed AI use.
Final decision must remain with the moderator.

Post title: ${input.title.slice(0, 240)}
Post preview: ${input.bodyPreview.slice(0, 1200)}
Disclosure status: ${input.disclosureStatus}
Policy status: ${input.policyStatus}
Rule reasons: ${input.reasons.join(' | ') || 'none'}
Rule suggested actions: ${input.suggestedActions.join(', ') || 'none'}
Signals: missingDisclosure=${input.signals.missingDisclosure}; similarToRecentPosts=${input.signals.similarToRecentPosts}; repetitivePattern=${input.signals.repetitivePattern}; lowEffort=${input.signals.lowEffort}
Community policy: disclosure=${input.policy.disclosureRequirement}; aiGenerated=${input.policy.aiGeneratedAction}; aiAssisted=${input.policy.aiAssistedAction}; unknown=${input.policy.unknownAction}; similarity=${input.policy.similarityAction}; lowContext=${input.policy.lowContextAction}

Return exact sections:
LABEL: one safe moderator-facing label candidate, 6 words max.
ACTION: one of ask_disclosure, apply_label, mark_reviewed, remove_with_reason, approve.
WHY: 2 short bullets. Mention observable moderation signals only.
SAFETY: one short sentence saying the moderator decides.`;

  try {
    const output = await callModeratorAI(prompt, config, 360);
    return parseTriageSuggestion(output, fallback, input.disclosureStatus);
  } catch {
    return fallback;
  }
}

export async function translateReviewPreview(
  text: string,
  config: ModeratorAIConfig,
  languageName = 'English'
): Promise<string> {
  const prompt = `Translate this Reddit post preview into ${languageName} for a moderator who needs to understand it quickly.
Do not summarize. Do not judge whether it is AI. Do not add policy recommendations.
Preserve names, URLs, code, quoted phrases, uncertainty, and tone as much as possible.
Return only the translated text.

POST PREVIEW:
${text.slice(0, 2200)}`;
  return callModeratorAI(prompt, config, 420);
}

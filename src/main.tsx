import { Devvit, SettingScope, useState, useAsync } from '@devvit/public-api';
import type {
  ActionLogEntry,
  DisclosureStatus,
  Metrics,
  ModerationActionType,
  RecentAction,
  ReviewItem,
  ReviewSignals,
  SubredditPolicy,
} from './types.js';
import { PRESETS, ACTION_ICONS, DISCLOSURE_LABELS } from './types.js';
import { detectLanguage, t, type SupportedLanguage } from './i18n.js';
import { getPolicy, savePolicy, createDefaultPolicy, applyPreset } from './policy.js';
import {
  normalizeText,
  removeStopWords,
  makeNgrams,
  estimateDisclosureStatus,
  evaluatePost,
  generateDisclosureRequest,
  generateRemovalReason,
} from './signals.js';
import {
  DEFAULT_CLOUDFLARE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AIProvider,
	  type ModeratorAIConfig,
	  generateConnectionCheck,
	  generatePolicyDraftPackage,
	  generateCommunityPulseSummary,
	  translateReviewPreview,
	} from './copilot.js';

Devvit.configure({
  http: {
    domains: ['generativelanguage.googleapis.com', 'api.openai.com'],
  },
  redditAPI: true,
  redis: true,
});

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

Devvit.addSettings([
  {
    type: 'select',
    name: 'ui_language',
    label: 'Moderator UI Language',
    helpText: 'Choose Auto or a fixed language for the moderator console.',
    scope: 'installation',
    defaultValue: ['auto'],
    options: [
      { label: 'Auto', value: 'auto' },
      { label: 'English', value: 'en' },
      { label: 'Japanese', value: 'ja' },
      { label: 'Spanish', value: 'es' },
      { label: 'French', value: 'fr' },
    ],
  },
  {
    type: 'select',
    name: 'preset',
    label: 'AI Policy Preset',
    helpText: 'Choose a starting policy. You can customize later via the Coexistence Console post.',
    scope: 'installation',
    defaultValue: ['balanced'],
    options: [
      { label: 'AI-friendly', value: 'gentle' },
      { label: 'Balanced Coexistence', value: 'balanced' },
      { label: 'Strict AI Governance', value: 'strict' },
    ],
  },
  {
    type: 'select',
    name: 'disclosure_mode',
    label: 'AI Disclosure Mode',
    scope: 'installation',
    defaultValue: ['recommended'],
    options: [
      { label: 'Required', value: 'required' },
      { label: 'Recommended', value: 'recommended' },
      { label: 'Off', value: 'off' },
    ],
  },
  {
    type: 'string',
    name: 'ai_provider',
    label: 'AI Provider',
    helpText: 'Default Gemini is Devvit-compliant and works with the global fetch allowlist. Cloudflare is kept for local/direct API testing only unless Reddit approves that domain.',
    scope: SettingScope.App,
    defaultValue: 'gemini',
  },
  {
    type: 'string',
    name: 'gemini_api_key',
    label: 'Google Gemini API Key',
    helpText: 'App-level secret for Devvit-approved AI policy drafts and Community Pulse summaries.',
    scope: SettingScope.App,
    isSecret: true,
  },
  {
    type: 'string',
    name: 'gemini_model',
    label: 'Gemini Model',
    helpText: `Default: ${DEFAULT_GEMINI_MODEL}. Smartest current Gemini setting: gemini-3.1-pro-preview, if quota allows.`,
    scope: SettingScope.App,
    defaultValue: DEFAULT_GEMINI_MODEL,
  },
  {
    type: 'string',
    name: 'openai_api_key',
    label: 'OpenAI API Key',
    helpText: 'Optional fallback provider. Devvit allows api.openai.com.',
    scope: SettingScope.App,
    isSecret: true,
  },
  {
    type: 'string',
    name: 'openai_model',
    label: 'OpenAI Model',
    helpText: `Default: ${DEFAULT_OPENAI_MODEL}`,
    scope: SettingScope.App,
    defaultValue: DEFAULT_OPENAI_MODEL,
  },
  {
    type: 'string',
    name: 'cloudflare_account_id',
    label: 'Cloudflare Account ID',
    helpText: 'Optional direct Workers AI account ID. Devvit runtime requires Reddit domain approval before api.cloudflare.com can be fetched.',
    scope: SettingScope.App,
    defaultValue: '',
  },
  {
    type: 'string',
    name: 'cloudflare_api_token',
    label: 'Cloudflare API Token',
    helpText: 'App-level secret. Needs Workers AI permissions. Used only for moderator-facing summaries and drafts.',
    scope: SettingScope.App,
    isSecret: true,
  },
  {
    type: 'string',
    name: 'cloudflare_model',
    label: 'Cloudflare Workers AI Model',
    helpText: `Default: ${DEFAULT_CLOUDFLARE_MODEL}`,
    scope: SettingScope.App,
    defaultValue: DEFAULT_CLOUDFLARE_MODEL,
  },
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const REVIEW_KEY = (subredditId: string, postId: string) => `review:${subredditId}:${postId}`;
const RECENT_KEY = (subredditId: string) => `recent:${subredditId}`;
const METRICS_KEY = (subredditId: string, weekStart: number) => `metrics:${subredditId}:${weekStart}`;
const ALL_REVIEW_KEYS = (subredditId: string) => `review_keys:${subredditId}`;

function getWeekStart(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function hashAuthor(authorId: string | undefined): string | undefined {
  if (!authorId) return undefined;
  // Simple deterministic hash for privacy
  let h = 0;
  for (let i = 0; i < authorId.length; i++) {
    h = ((h << 5) - h + authorId.charCodeAt(i)) | 0;
  }
  return `h${Math.abs(h)}`;
}

const DAILY_KEY = (subredditId: string) => `daily:${subredditId}`;
const ACTIVITY_KEY = (subredditId: string) => `activity:${subredditId}`;
const ACTION_LOG_KEY = (subredditId: string) => `actionlog:${subredditId}`;
const MODNOTES_KEY = (subredditId: string, postId: string) => `modnotes:${subredditId}:${postId}`;

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const ACTION_LOG_LIMIT = 250;
const ACTION_LOG_TTL_SECONDS = 60 * 60 * 24 * 90;
const ONE_CLICK_ACTION_SECONDS = 30;

type DailyMetricField =
  | 'postsScanned'
  | 'itemsQueued'
  | 'labelsApplied'
  | 'disclosureRequestsSent'
  | 'approvalsPerformed'
  | 'reviewedPosts'
  | 'removalsPerformed';

const ACTION_SECONDS_SAVED: Record<ModerationActionType, number> = {
  scanned: 0,
  queued: 0,
  approved: ONE_CLICK_ACTION_SECONDS,
  labeled: ONE_CLICK_ACTION_SECONDS,
  asked_disclosure: ONE_CLICK_ACTION_SECONDS,
  reviewed: ONE_CLICK_ACTION_SECONDS,
  removed: ONE_CLICK_ACTION_SECONDS,
};

const ACTION_DAILY_FIELDS: Record<ModerationActionType, DailyMetricField> = {
  scanned: 'postsScanned',
  queued: 'itemsQueued',
  labeled: 'labelsApplied',
  asked_disclosure: 'disclosureRequestsSent',
  approved: 'approvalsPerformed',
  reviewed: 'reviewedPosts',
  removed: 'removalsPerformed',
};

const ACTION_DESCRIPTIONS: Record<ModerationActionType, string> = {
  scanned: 'Post scanned by Coexistence Console',
  queued: 'Post queued for moderator review',
  approved: 'Post approved by moderator',
  labeled: 'Post labeled by moderator',
  asked_disclosure: 'Asked user for disclosure',
  reviewed: 'Post marked as reviewed by moderator',
  removed: 'Post removed by moderator',
};

const CONSOLE_POST_TITLE_MARKERS = [
  'Coexistence Console Dashboard',
  'Coexistence Review Queue',
  'Coexistence Policy Editor',
  'Community Analytics Dashboard',
];

function isConsolePostTitle(title: string | undefined): boolean {
  if (!title) return false;
  return CONSOLE_POST_TITLE_MARKERS.some((marker) => title.includes(marker));
}

const COLORS = {
  // Surfaces — slate-tinted, designed to look like a polished SaaS console
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  surfaceStrong: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  // Text
  ink: '#0F172A',
  muted: '#475569',
  mutedSubtle: '#94A3B8',
  // Reddit-flavored accents (used sparingly, only for meaning)
  brand: '#FF4500',
  brandSoft: '#FFEDD5',
  brandSoftEdge: '#FED7AA',
  primary: '#2563EB',
  primarySoft: '#DBEAFE',
  primarySoftEdge: '#BFDBFE',
  secondary: '#475569',
  // Semantic
  success: '#16A34A',
  successSoft: '#DCFCE7',
  successSoftEdge: '#BBF7D0',
  caution: '#D97706',
  cautionSoft: '#FEF3C7',
  cautionSoftEdge: '#FDE68A',
  warning: '#B45309',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  dangerSoftEdge: '#FECACA',
  white: '#FFFFFF',
};

type ConsoleView = 'dashboard' | 'queue' | 'policy' | 'analytics';

type ConsolePostData = {
  view?: ConsoleView;
  screen?: ConsoleView | 'review_queue';
  lang?: SupportedLanguage;
};

const LANGUAGE_OPTIONS: { value: SupportedLanguage; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ja', label: '日本語' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' },
];

const LANGUAGE_OVERRIDE_KEY = (subredditId: string) => `console_language:${subredditId}`;

function isSupportedLanguage(value: string | undefined): value is SupportedLanguage {
  return value === 'en' || value === 'ja' || value === 'es' || value === 'fr';
}

type RedisLike = { redis: { get(key: string): Promise<string | undefined>; set(key: string, value: string, options?: { nx?: boolean; xx?: boolean; expiration?: Date }): Promise<string>; expire(key: string, seconds: number): Promise<any>; } };

function getConsoleView(context: Devvit.Context): ConsoleView {
  const data = context.postData as ConsolePostData | undefined;
  const view = data?.view || data?.screen;
  if (view === 'review_queue') return 'queue';
  if (view === 'queue' || view === 'policy' || view === 'analytics' || view === 'dashboard') {
    return view;
  }
  return 'dashboard';
}

function redditDateToMillis(value: Date | number | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  return Date.now();
}

function createEmptyMetrics(subredditId: string, weekStart: number = getWeekStart(Date.now())): Metrics {
  return {
    subredditId,
    weekStart,
    postsScanned: 0,
    itemsQueued: 0,
    labelsApplied: 0,
    disclosureRequestsSent: 0,
    approvalsPerformed: 0,
    reviewedPosts: 0,
    removalsPerformed: 0,
    estimatedSecondsSaved: 0,
    estimatedMinutesSaved: 0,
  };
}

function normalizeMetrics(raw: Partial<Metrics> | null | undefined, subredditId: string, weekStart: number): Metrics {
  const metrics = { ...createEmptyMetrics(subredditId, weekStart), ...(raw || {}) };
  metrics.estimatedSecondsSaved = metrics.estimatedSecondsSaved || metrics.estimatedMinutesSaved * 60;
  metrics.estimatedMinutesSaved = metrics.estimatedMinutesSaved || Math.floor(metrics.estimatedSecondsSaved / 60);
  return metrics;
}

async function incrementMetrics(
  context: RedisLike,
  subredditId: string,
  field: keyof Metrics,
  amount: number
): Promise<void> {
  const weekStart = getWeekStart(Date.now());
  const key = METRICS_KEY(subredditId, weekStart);
  const raw = await context.redis.get(key);
  const metrics: Metrics = raw
    ? JSON.parse(raw)
    : createEmptyMetrics(subredditId, weekStart);
  (metrics as any)[field] = ((metrics as any)[field] || 0) + amount;
  await context.redis.set(key, JSON.stringify(metrics));
  await context.redis.expire(key, 60 * 60 * 24 * 30); // 30 days TTL
}

async function incrementDaily(
  context: RedisLike,
  subredditId: string,
  field: DailyMetricField
): Promise<void> {
  const key = DAILY_KEY(subredditId);
  const raw = await context.redis.get(key);
  const daily: Record<string, Record<string, number>> = raw ? JSON.parse(raw) : {};
  const today = new Date().toISOString().split('T')[0];
  if (!daily[today]) daily[today] = {};
  daily[today][field] = (daily[today][field] || 0) + 1;
  await context.redis.set(key, JSON.stringify(daily));
  await context.redis.expire(key, 60 * 60 * 24 * 90); // 90 days TTL
}

type RecordActionInput = {
  type: ModerationActionType;
  postId: string;
  postTitle: string;
  description?: string;
  reason?: string;
  modUsername?: string;
  policyStatus?: ActionLogEntry['policyStatus'];
  disclosureStatus?: ActionLogEntry['disclosureStatus'];
  estimatedSecondsSaved?: number;
};

async function logActivity(
  context: RedisLike,
  subredditId: string,
  action: import('./types.js').RecentAction
): Promise<void> {
  const key = ACTIVITY_KEY(subredditId);
  const raw = await context.redis.get(key);
  const activities: import('./types.js').RecentAction[] = raw ? JSON.parse(raw) : [];
  activities.unshift(action);
  if (activities.length > 20) activities.pop();
  await context.redis.set(key, JSON.stringify(activities));
  await context.redis.expire(key, 60 * 60 * 24 * 30); // 30 days TTL
}

function parseActionLog(raw: string | undefined): ActionLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ActionLogEntry[] : [];
  } catch {
    return [];
  }
}

async function getModeratorAIConfig(context: Devvit.Context): Promise<ModeratorAIConfig | null> {
  const providerRaw = ((await context.settings.get<string>('ai_provider')) || 'gemini').trim().toLowerCase();
  const provider: AIProvider = providerRaw === 'cloudflare' || providerRaw === 'openai' ? providerRaw : 'gemini';

  if (provider === 'gemini') {
    const apiKey = ((await context.settings.get<string>('gemini_api_key')) || '').trim();
    const model = ((await context.settings.get<string>('gemini_model')) || DEFAULT_GEMINI_MODEL).trim();
    if (!apiKey) return null;
    return { provider: 'gemini', apiKey, model: model || DEFAULT_GEMINI_MODEL };
  }

  if (provider === 'openai') {
    const apiKey = ((await context.settings.get<string>('openai_api_key')) || '').trim();
    const model = ((await context.settings.get<string>('openai_model')) || DEFAULT_OPENAI_MODEL).trim();
    if (!apiKey) return null;
    return { provider: 'openai', apiKey, model: model || DEFAULT_OPENAI_MODEL };
  }

  const accountId = ((await context.settings.get<string>('cloudflare_account_id')) || '').trim();
  const apiToken = ((await context.settings.get<string>('cloudflare_api_token')) || '').trim();
  const model = ((await context.settings.get<string>('cloudflare_model')) || DEFAULT_CLOUDFLARE_MODEL).trim();
  if (!accountId || !apiToken) return null;
  return { provider: 'cloudflare', accountId, apiToken, model: model || DEFAULT_CLOUDFLARE_MODEL };
}

function describeAIConfig(config: ModeratorAIConfig | null): string {
  if (!config) return '';
  if (config.provider === 'gemini') return `Gemini ${config.model || DEFAULT_GEMINI_MODEL}`;
  if (config.provider === 'openai') return `OpenAI ${config.model || DEFAULT_OPENAI_MODEL}`;
  return `Cloudflare ${config.model || DEFAULT_CLOUDFLARE_MODEL}`;
}

function formatDisclosureRequirement(value: string, lang: SupportedLanguage = 'en'): string {
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      optional: 'Optional',
      recommended: 'Recommended',
      required_ai_generated: 'Generated required',
      required_ai_assisted_and_generated: 'All AI required',
    },
    ja: {
      optional: '任意',
      recommended: '推奨',
      required_ai_generated: 'AI生成は必須',
      required_ai_assisted_and_generated: 'AI利用はすべて必須',
    },
    es: {
      optional: 'Opcional',
      recommended: 'Recomendado',
      required_ai_generated: 'Generado por IA requerido',
      required_ai_assisted_and_generated: 'Toda IA requerida',
    },
    fr: {
      optional: 'Optionnel',
      recommended: 'Recommande',
      required_ai_generated: 'Genere par IA requis',
      required_ai_assisted_and_generated: 'Toute IA requise',
    },
  };
  return labels[lang]?.[value] || labels.en[value] || value.replace(/_/g, ' ');
}

function formatPolicyAction(value: string, lang: SupportedLanguage = 'en'): string {
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      allow: 'Allow',
      label: 'Apply label',
      queue: 'Queue',
      remove: 'Remove',
      ask_disclosure: 'Ask disclosure',
      off: 'Off',
    },
    ja: {
      allow: '許可',
      label: 'ラベル付け',
      queue: 'キューへ',
      remove: '削除',
      ask_disclosure: '開示を依頼',
      off: 'オフ',
    },
    es: {
      allow: 'Permitir',
      label: 'Etiquetar',
      queue: 'Cola',
      remove: 'Retirar',
      ask_disclosure: 'Pedir divulgacion',
      off: 'Desactivado',
    },
    fr: {
      allow: 'Autoriser',
      label: 'Labeliser',
      queue: 'File',
      remove: 'Retirer',
      ask_disclosure: 'Demander divulgation',
      off: 'Desactive',
    },
  };
  return labels[lang]?.[value] || labels.en[value] || value.replace(/_/g, ' ');
}

function formatTone(value: string, lang: SupportedLanguage = 'en'): string {
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: { friendly: 'Friendly', neutral: 'Neutral', formal: 'Formal', strict: 'Strict' },
    ja: { friendly: '親しみやすい', neutral: '中立', formal: '丁寧', strict: '厳格' },
    es: { friendly: 'Amable', neutral: 'Neutral', formal: 'Formal', strict: 'Estricto' },
    fr: { friendly: 'Amical', neutral: 'Neutre', formal: 'Formel', strict: 'Strict' },
  };
  return labels[lang]?.[value] || labels.en[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

async function getPreferredLanguage(context: Devvit.Context): Promise<SupportedLanguage> {
  const postData = context.postData as ConsolePostData | undefined;
  if (isSupportedLanguage(postData?.lang)) return postData.lang;

  const redisOverride = await context.redis.get(LANGUAGE_OVERRIDE_KEY(context.subredditId));
  if (isSupportedLanguage(redisOverride)) return redisOverride;

  const raw = await context.settings.get<string | string[]>('ui_language');
  const selected = Array.isArray(raw) ? raw[0] : raw;
  if (isSupportedLanguage(selected)) {
    return selected;
  }
  return detectLanguage(context);
}

function renderLanguageSwitcher(
  current: SupportedLanguage,
  onSelect: (lang: SupportedLanguage) => void | Promise<void>
): JSX.Element {
  return (
    <hstack gap="small" alignment="middle end">
      {LANGUAGE_OPTIONS.map((option) => (
        <button
          key={`lang-${option.value}`}
          size="small"
          appearance={current === option.value ? 'primary' : 'bordered'}
          onPress={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </hstack>
  );
}

function languageSwitchToast(lang: SupportedLanguage): string {
  switch (lang) {
    case 'ja': return '日本語表示に切り替えました。';
    case 'es': return 'Idioma cambiado a español.';
    case 'fr': return 'Langue changée en français.';
    default: return 'Language changed to English.';
  }
}

function statusLabel(status: string, lang: SupportedLanguage): string {
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: { queued: 'Queued', approved: 'Approved', labeled: 'Labeled', reviewed: 'Reviewed', removed: 'Removed', all: 'All' },
    ja: { queued: '未処理', approved: '承認済み', labeled: 'ラベル済み', reviewed: 'レビュー済み', removed: '削除済み', all: 'すべて' },
    es: { queued: 'En cola', approved: 'Aprobado', labeled: 'Etiquetado', reviewed: 'Revisado', removed: 'Retirado', all: 'Todo' },
    fr: { queued: 'En file', approved: 'Approuve', labeled: 'Labelise', reviewed: 'Revise', removed: 'Retire', all: 'Tout' },
  };
  return labels[lang]?.[status] || labels.en[status] || status;
}

function policyStatusLabelForLanguage(status: string, lang: SupportedLanguage): string {
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      removal_candidate: 'Removal candidate',
      needs_review: 'Needs review',
      needs_disclosure: 'Needs disclosure',
      needs_label: 'Needs label',
      compliant: 'Compliant',
    },
    ja: {
      removal_candidate: '削除候補',
      needs_review: '要レビュー',
      needs_disclosure: '開示が必要',
      needs_label: 'ラベルが必要',
      compliant: '準拠',
    },
    es: {
      removal_candidate: 'Candidato a retirada',
      needs_review: 'Requiere revision',
      needs_disclosure: 'Requiere divulgacion',
      needs_label: 'Requiere etiqueta',
      compliant: 'Conforme',
    },
    fr: {
      removal_candidate: 'Candidat au retrait',
      needs_review: 'A reviser',
      needs_disclosure: 'Divulgation requise',
      needs_label: 'Label requis',
      compliant: 'Conforme',
    },
  };
  return labels[lang]?.[status] || labels.en[status] || status.replace(/_/g, ' ');
}

function disclosureStatusLabel(status: DisclosureStatus, lang: SupportedLanguage): string {
  const labels: Record<SupportedLanguage, Partial<Record<DisclosureStatus, string>>> = {
    en: DISCLOSURE_LABELS,
    ja: {
      human: '人間のみ',
      ai_assisted: 'AI補助',
      ai_generated: 'AI生成',
      unknown: '未開示 / 不明',
    },
    es: {
      human: 'Humano',
      ai_assisted: 'Asistido por IA',
      ai_generated: 'Generado por IA',
      unknown: 'Sin divulgar / desconocido',
    },
    fr: {
      human: 'Humain',
      ai_assisted: 'Assiste par IA',
      ai_generated: 'Genere par IA',
      unknown: 'Non divulgue / inconnu',
    },
  };
  return labels[lang]?.[status] || DISCLOSURE_LABELS[status] || status;
}

function suggestedActionLabel(action: string, lang: SupportedLanguage): string {
  const normalized = action.replace(/_/g, ' ');
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    en: {
      ask_disclosure: 'ask disclosure',
      mark_reviewed: 'mark reviewed',
      label: 'label',
      approve: 'approve',
      remove: 'remove',
    },
    ja: {
      ask_disclosure: '開示を依頼',
      mark_reviewed: 'レビュー済みにする',
      label: 'ラベル付け',
      approve: '承認',
      remove: '削除',
    },
    es: {
      ask_disclosure: 'pedir divulgacion',
      mark_reviewed: 'marcar revisado',
      label: 'etiquetar',
      approve: 'aprobar',
      remove: 'retirar',
    },
    fr: {
      ask_disclosure: 'demander divulgation',
      mark_reviewed: 'marquer revise',
      label: 'labeliser',
      approve: 'approuver',
      remove: 'retirer',
    },
  };
  return labels[lang]?.[action] || labels.en[action] || normalized;
}

function reviewReasonLabel(reason: string, lang: SupportedLanguage): string {
  if (lang !== 'ja') return reason;
  if (reason.includes('Community policy encourages disclosure')) return 'コミュニティ方針上、開示が推奨されています';
  if (reason.includes('Low-context post')) return '文脈が少ない投稿です';
  if (reason.includes('AI-assisted content requires transparency label')) return 'AI補助コンテンツには透明性ラベルが必要です';
  if (reason.includes('AI-generated content requires disclosure')) return 'AI生成コンテンツには開示が必要です';
  if (reason.includes('Similar to recent posts')) return '最近の投稿と類似しています';
  return reason;
}

function signalLabelForLanguage(signalKey: string, lang: SupportedLanguage): string {
  const labels: Record<string, string> = {
    missingDisclosure: '開示不足',
    similarToRecentPosts: '最近の投稿と類似',
    repetitivePattern: '反復パターン',
    lowEffort: '文脈不足',
  };
  if (lang === 'ja') return labels[signalKey] || signalKey.replace(/([A-Z])/g, ' $1');
  return signalKey === 'missingDisclosure' ? 'Missing disclosure'
    : signalKey === 'similarToRecentPosts' ? 'Similar to recent'
    : signalKey === 'repetitivePattern' ? 'Repetitive pattern'
    : signalKey === 'lowEffort' ? 'Low context'
    : signalKey.replace(/([A-Z])/g, ' $1');
}

function actionLogToRecentAction(entry: ActionLogEntry, description?: string): RecentAction {
  return {
    id: `act-${entry.id}`,
    type: entry.type,
    description: description || (entry.reason ? `${ACTION_DESCRIPTIONS[entry.type]}: ${entry.reason}` : ACTION_DESCRIPTIONS[entry.type]),
    postTitle: entry.postTitle,
    postId: entry.postId,
    modUsername: entry.modUsername,
    timestamp: entry.createdAt,
  };
}

async function recordAction(
  context: RedisLike,
  subredditId: string,
  input: RecordActionInput
): Promise<ActionLogEntry> {
  const createdAt = Date.now();
  const entry: ActionLogEntry = {
    id: `${createdAt}-${input.type}-${input.postId}`,
    subredditId,
    postId: input.postId,
    postTitle: input.postTitle.slice(0, 120),
    type: input.type,
    reason: input.reason,
    modUsername: input.modUsername,
    policyStatus: input.policyStatus,
    disclosureStatus: input.disclosureStatus,
    createdAt,
    estimatedSecondsSaved: input.estimatedSecondsSaved ?? ACTION_SECONDS_SAVED[input.type],
  };

  const key = ACTION_LOG_KEY(subredditId);
  const entries = parseActionLog(await context.redis.get(key));
  entries.unshift(entry);
  if (entries.length > ACTION_LOG_LIMIT) entries.length = ACTION_LOG_LIMIT;
  await context.redis.set(key, JSON.stringify(entries));
  await context.redis.expire(key, ACTION_LOG_TTL_SECONDS);

  await logActivity(context, subredditId, actionLogToRecentAction(entry, input.description));
  return entry;
}

function buildMetricsFromActionLog(
  subredditId: string,
  entries: ActionLogEntry[],
  weekStart: number
): Metrics {
  const metrics = createEmptyMetrics(subredditId, weekStart);
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (entry.createdAt < weekStart || entry.createdAt >= weekEnd) continue;
    const field = ACTION_DAILY_FIELDS[entry.type];
    (metrics as any)[field] = ((metrics as any)[field] || 0) + 1;
    metrics.estimatedSecondsSaved += entry.estimatedSecondsSaved || 0;
  }
  metrics.estimatedMinutesSaved = Math.floor(metrics.estimatedSecondsSaved / 60);
  return metrics;
}

function buildDailyFromActionLog(entries: ActionLogEntry[]): Record<string, Record<string, number>> {
  const daily: Record<string, Record<string, number>> = {};
  for (const entry of entries) {
    const dateKey = new Date(entry.createdAt).toISOString().split('T')[0];
    if (!daily[dateKey]) daily[dateKey] = {};
    const field = ACTION_DAILY_FIELDS[entry.type];
    daily[dateKey][field] = (daily[dateKey][field] || 0) + 1;
  }
  return daily;
}

type ParticipationMix = Record<DisclosureStatus, number>;

function buildParticipationMix(entries: ActionLogEntry[], weekStart: number): ParticipationMix {
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const mix: ParticipationMix = {
    human: 0,
    ai_assisted: 0,
    ai_generated: 0,
    unknown: 0,
  };
  const countedPostIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== 'scanned') continue;
    if (entry.createdAt < weekStart || entry.createdAt >= weekEnd) continue;
    if (countedPostIds.has(entry.postId)) continue;

    countedPostIds.add(entry.postId);
    const disclosureStatus = entry.disclosureStatus || 'unknown';
    mix[disclosureStatus] += 1;
  }

  return mix;
}

function percentOf(total: number, value: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

type CommunityPulse = {
  moodLabel: string;
  moodScore: number;
  moodColor: string;
  reviewPressureLabel: string;
  reviewPressureColor: string;
  disclosureClarityLabel: string;
  disclosureClarityColor: string;
  summary: string;
  nextMove: string;
  facts: string;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildCommunityPulse(
  metrics: Metrics,
  mix: ParticipationMix,
  entries: ActionLogEntry[],
  activeQueueCount: number,
  lang: import('./i18n.js').SupportedLanguage
): CommunityPulse {
  const participationTotal = Math.max(Object.values(mix).reduce((sum, count) => sum + count, 0), metrics.postsScanned, 1);
  const unknownRate = mix.unknown / participationTotal;
  const queuedRate = metrics.itemsQueued / participationTotal;
  const removalRate = metrics.removalsPerformed / participationTotal;
  const disclosureActions = metrics.labelsApplied + metrics.disclosureRequestsSent;
  const disclosureRate = disclosureActions / participationTotal;
  const moodScore = clampNumber(Math.round(82 - queuedRate * 30 - unknownRate * 24 - removalRate * 35 + disclosureRate * 10), 0, 100);
  const moodLabel = moodScore >= 75 ? t('pulse.moodPositive', lang) : moodScore >= 55 ? t('pulse.moodMixed', lang) : t('pulse.moodConcern', lang);
  const moodColor = moodScore >= 75 ? COLORS.success : moodScore >= 55 ? COLORS.caution : COLORS.danger;
  const reviewPressureLabel = activeQueueCount === 0 ? t('pulse.pressureClear', lang) : activeQueueCount < 5 ? t('pulse.pressureActive', lang) : t('pulse.pressureHigh', lang);
  const reviewPressureColor = activeQueueCount === 0 ? COLORS.success : activeQueueCount < 5 ? COLORS.caution : COLORS.danger;
  const disclosureClarityLabel = unknownRate <= 0.2 ? t('pulse.clarityClear', lang) : unknownRate <= 0.5 ? t('pulse.clarityMixed', lang) : t('pulse.clarityNeedsWork', lang);
  const disclosureClarityColor = unknownRate <= 0.2 ? COLORS.success : unknownRate <= 0.5 ? COLORS.caution : COLORS.danger;

  const summary = unknownRate > 0.4
    ? t('pulse.summaryUnknown', lang)
    : activeQueueCount > 0
    ? t('pulse.summaryActive', lang)
    : t('pulse.summaryStable', lang);
  const nextMove = activeQueueCount > 0
    ? unknownRate > 0.3
      ? t('pulse.nextUnknown', lang)
      : t('pulse.nextClearQueue', lang)
    : t('pulse.nextMonitor', lang);
  const queuedReasons = entries
    .filter((entry) => entry.type === 'queued')
    .slice(0, 4)
    .map((entry) => entry.reason || 'Queued for moderator review')
    .join(' | ');
  const facts = [
    `posts scanned: ${metrics.postsScanned}`,
    `active queue: ${activeQueueCount}`,
    `queued this week: ${metrics.itemsQueued}`,
    `labels applied: ${metrics.labelsApplied}`,
    `disclosure requests: ${metrics.disclosureRequestsSent}`,
    `removals: ${metrics.removalsPerformed}`,
    `participation mix: human ${mix.human}, ai-assisted ${mix.ai_assisted}, ai-generated ${mix.ai_generated}, unknown ${mix.unknown}`,
    `latest queue reasons: ${queuedReasons || 'none'}`,
  ].join('\n');

  return {
    moodLabel,
    moodScore,
    moodColor,
    reviewPressureLabel,
    reviewPressureColor,
    disclosureClarityLabel,
    disclosureClarityColor,
    summary,
    nextMove,
    facts,
  };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimeSaved(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function languageNameForAI(lang: import('./i18n.js').SupportedLanguage): string {
  if (lang === 'ja') return 'Japanese';
  if (lang === 'es') return 'Spanish';
  if (lang === 'fr') return 'French';
  return 'English';
}

function formatRelativeTime(timestamp: number, lang: import('./i18n.js').SupportedLanguage): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time.justNow', lang);
  if (minutes < 60) return t('time.minutesAgo', lang, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', lang, { n: hours });
  return t('time.daysAgo', lang, { n: Math.floor(hours / 24) });
}

function getDayOfWeek(): string {
  return DAY_NAMES[new Date().getDay()];
}

/* ------------------------------------------------------------------ */
/*  Trigger: PostSubmit                                               */
/* ------------------------------------------------------------------ */

Devvit.addTrigger({
  event: 'PostSubmit',
  async onEvent(event, context) {
    const post = event.post;
    if (!post) return;

    const subredditId = event.subreddit?.id || context.subredditId;
    const postId = post.id;
    const title = post.title || '';
    const body = post.selftext || '';

    if (isConsolePostTitle(title)) return;

    // Load or init policy
    let policy = await getPolicy(context, subredditId);
    if (!policy) {
      const preset = (await context.settings.get<string>('preset')) || 'balanced';
      policy = applyPreset(subredditId, preset as any);
      await savePolicy(context, policy);
    }

    // Normalize and evaluate against the configured policy.
    const normalized = normalizeText(title + ' ' + body);
    const filtered = removeStopWords(normalized);
    const ngrams = makeNgrams(filtered, 3);

    // Load recent snippets
    const recentRaw = await context.redis.get(RECENT_KEY(subredditId));
    const recentSnippets: { postId: string; normalized: string; ngrams: string[] }[] = recentRaw
      ? JSON.parse(recentRaw)
      : [];

    const isNewAccount = false; // We avoid profiling; use a placeholder

    const disclosure = estimateDisclosureStatus(title, body, post.linkFlair?.text);

    const { signals, policyStatus, reasons, suggestedActions } = evaluatePost(
      title,
      body,
      policy,
      disclosure,
      recentSnippets
    );

    const reviewItem: ReviewItem = {
      id: `review-${postId}`,
      subredditId,
      postId,
      authorIdHash: hashAuthor(post.authorId),
      title,
      bodyPreview: body.slice(0, 300),
      createdAt: redditDateToMillis(post.createdAt),
      disclosureStatus: disclosure,
      status: 'queued',
      policyStatus,
      signals,
      reasons,
      suggestedActions,
    };

    // Save review item if it needs any moderator attention
    if (policyStatus !== 'compliant') {
      await context.redis.set(REVIEW_KEY(subredditId, postId), JSON.stringify(reviewItem));
      await context.redis.hSet(ALL_REVIEW_KEYS(subredditId), { [postId]: '1' });
      await incrementMetrics(context, subredditId, 'itemsQueued', 1);
      await incrementDaily(context, subredditId, 'itemsQueued');
      await recordAction(context, subredditId, {
        type: 'queued',
        description: `Queued: ${reasons.join(', ')}`,
        reason: reasons.join('; '),
        postTitle: title,
        postId,
        policyStatus,
        disclosureStatus: disclosure,
      });
    }

    // Update recent snippets
    recentSnippets.push({ postId, normalized, ngrams });
    if (recentSnippets.length > 20) recentSnippets.shift();
    await context.redis.set(RECENT_KEY(subredditId), JSON.stringify(recentSnippets));
    await context.redis.expire(RECENT_KEY(subredditId), 60 * 60 * 24 * 7); // 7 days

    await incrementMetrics(context, subredditId, 'postsScanned', 1);
    await incrementDaily(context, subredditId, 'postsScanned');
    await recordAction(context, subredditId, {
      type: 'scanned',
      postTitle: title,
      postId,
      policyStatus,
      disclosureStatus: disclosure,
    });
  },
});

/* ------------------------------------------------------------------ */
/*  Trigger: PostDelete                                               */
/* ------------------------------------------------------------------ */

Devvit.addTrigger({
  event: 'PostDelete',
  async onEvent(event, context) {
    const postId = event.postId;
    const subredditId = event.subreddit?.id || context.subredditId;
    if (!postId) return;
    await context.redis.del(REVIEW_KEY(subredditId, postId));
    await context.redis.hDel(ALL_REVIEW_KEYS(subredditId), [postId]);
  },
});

/* ------------------------------------------------------------------ */
/*  Trigger: CommentDelete                                            */
/* ------------------------------------------------------------------ */

Devvit.addTrigger({
  event: 'CommentDelete',
  async onEvent(event, context) {
    // Minimal compliance: we don't store comment data, so nothing to delete.
    // This satisfies Devvit Rules for deletion handling.
  },
});

/* ------------------------------------------------------------------ */
/*  Menu: Open Coexistence Console                                    */
/* ------------------------------------------------------------------ */

Devvit.addMenuItem({
  label: 'Open Coexistence Console',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const subredditName = subreddit.name;

    // Create a dashboard custom post if none exists
    const post = await context.reddit.submitPost({
      subredditName,
      title: '🛡️ Coexistence Console Dashboard',
      postData: { view: 'dashboard' },
      textFallback: {
        text: 'Coexistence Console dashboard for reviewing AI disclosure policy and moderation activity.',
      },
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading Coexistence Console...</text>
        </vstack>
      ),
    });

    context.ui.showToast(`Created Coexistence Console dashboard: ${post.permalink}`);
  },
});

/* ------------------------------------------------------------------ */
/*  Menu: Open Coexistence Queue                                      */
/* ------------------------------------------------------------------ */

Devvit.addMenuItem({
  label: 'Open Coexistence Queue',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const subredditName = subreddit.name;

	    const post = await context.reddit.submitPost({
	      subredditName,
	      title: '📋 Coexistence Review Queue',
	      postData: { view: 'queue' },
      textFallback: {
        text: 'Coexistence Console review queue for posts that need moderator attention.',
      },
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading Review Queue...</text>
        </vstack>
      ),
    });

    context.ui.showToast(`Created Coexistence Queue: ${post.permalink}`);
  },
});

/* ------------------------------------------------------------------ */
/*  Custom Post: Dashboard                                            */
/* ------------------------------------------------------------------ */

function renderDashboard(context: Devvit.Context): JSX.Element {
    const subredditId = context.subredditId;

    const { data: langRaw } = useAsync(async () => {
      return getPreferredLanguage(context);
    });

    const { data: metricsRaw, loading: metricsLoading, error: metricsError } = useAsync(async () => {
      const weekStart = getWeekStart(Date.now());
      const raw = await context.redis.get(METRICS_KEY(subredditId, weekStart));
      return raw ? JSON.parse(raw) : null;
    });

    const { data: prevMetricsRaw, error: prevError } = useAsync(async () => {
      const prevWeekStart = getWeekStart(Date.now()) - 7 * 24 * 60 * 60 * 1000;
      const raw = await context.redis.get(METRICS_KEY(subredditId, prevWeekStart));
      return raw ? JSON.parse(raw) : null;
    });

    const { data: dailyRaw, error: dailyError } = useAsync(async () => {
      const raw = await context.redis.get(DAILY_KEY(subredditId));
      return raw ? JSON.parse(raw) : {};
    });

    const { data: activityRaw, error: activityError } = useAsync(async () => {
      const raw = await context.redis.get(ACTIVITY_KEY(subredditId));
      return raw ? JSON.parse(raw) : [];
    });

    const { data: actionLogRaw, error: actionLogError } = useAsync(async () => {
      const raw = await context.redis.get(ACTION_LOG_KEY(subredditId));
      return parseActionLog(raw);
    });

	    const { data: queueCountRaw, error: queueError } = useAsync(async () => {
	      const keys = await context.redis.hKeys(ALL_REVIEW_KEYS(subredditId));
	      let count = 0;
      for (const postId of keys) {
        const raw = await context.redis.get(REVIEW_KEY(subredditId, postId));
        if (!raw) continue;
        try {
          const item = JSON.parse(raw) as ReviewItem;
          if (!isConsolePostTitle(item.title) && item.status === 'queued') count += 1;
        } catch {
          // ignore corrupt
        }
      }
	      return count;
	    });

	    const { data: dashboardQueueItemRaw } = useAsync(async () => {
	      const keys = await context.redis.hKeys(ALL_REVIEW_KEYS(subredditId));
	      const items: ReviewItem[] = [];
	      for (const postId of keys) {
	        const raw = await context.redis.get(REVIEW_KEY(subredditId, postId));
	        if (!raw) continue;
	        try {
	          const item = JSON.parse(raw) as ReviewItem;
	          if (!isConsolePostTitle(item.title) && item.status === 'queued') items.push(item);
	        } catch {
	          // ignore corrupt
	        }
	      }
	      items.sort((a, b) => b.createdAt - a.createdAt);
	      return items[0] || null;
	    });

	    const { data: aiConfigRaw } = useAsync(async () => {
	      return getModeratorAIConfig(context);
	    });

	    const [dashboardTranslation, setDashboardTranslation] = useState<string>('');
	    const [dashboardTranslationPostId, setDashboardTranslationPostId] = useState<string>('');
	    const [dashboardTranslationLoading, setDashboardTranslationLoading] = useState<boolean>(false);
	    const [dashboardTranslationError, setDashboardTranslationError] = useState<string>('');
	    const [languageOverride, setLanguageOverride] = useState<SupportedLanguage | null>(null);

    const actionLog: ActionLogEntry[] = actionLogRaw || [];
    const visibleActionLog = actionLog.filter((entry) => !isConsolePostTitle(entry.postTitle));
    const hasActionLog = actionLog.length > 0;
    const weekStart = getWeekStart(Date.now());
    const metrics: Metrics = hasActionLog
      ? buildMetricsFromActionLog(subredditId, visibleActionLog, weekStart)
      : normalizeMetrics(metricsRaw, subredditId, weekStart);
    const participationMix = hasActionLog
      ? buildParticipationMix(visibleActionLog, weekStart)
      : { human: 0, ai_assisted: 0, ai_generated: 0, unknown: 0 };
    const participationTotal = Object.values(participationMix).reduce((sum, count) => sum + count, 0);

    const prevWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000;
    const prevMetrics: Metrics | null = hasActionLog
      ? buildMetricsFromActionLog(subredditId, visibleActionLog, prevWeekStart)
      : prevMetricsRaw ? normalizeMetrics(prevMetricsRaw, subredditId, prevWeekStart) : null;
    const daily: Record<string, Record<string, number>> = hasActionLog ? buildDailyFromActionLog(visibleActionLog) : dailyRaw || {};
	    const activities: RecentAction[] = hasActionLog
	      ? visibleActionLog.slice(0, 20).map((entry) => actionLogToRecentAction(entry))
	      : (activityRaw || []).filter((entry: RecentAction) => !isConsolePostTitle(entry.postTitle));
	    const queueCount = queueCountRaw || 0;
	    const lang = languageOverride || langRaw || detectLanguage(context);
	    const dashboardQueueItem = dashboardQueueItemRaw || null;
	    const aiConfig = aiConfigRaw || null;
	    const dashboardQueuePolicyStatus = dashboardQueueItem?.policyStatus || 'needs_review';
	    const dashboardQueueDisclosureStatus = dashboardQueueItem?.disclosureStatus || 'unknown';
	    const dashboardQueueReasons = Array.isArray(dashboardQueueItem?.reasons) ? dashboardQueueItem.reasons : [];
	    const dashboardQueuePreview = dashboardQueueItem?.bodyPreview || '';
	    const communityPulse = buildCommunityPulse(metrics, participationMix, visibleActionLog, queueCount, lang);

    // Build 7-day chart data
    const today = new Date();
    const chartDays: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayData = daily[dateKey];
      const value = dayData ? (dayData.postsScanned || 0) : 0;
      chartDays.push({
        label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
        value,
      });
    }
    const maxChartValue = Math.max(...chartDays.map((d) => d.value), 1);

    // Trend helpers
    function trend(current: number, previous: number | undefined): { arrow: string; color: string; diff: string } {
      if (!previous || previous === 0) return { arrow: '', color: COLORS.muted, diff: '' };
      const diff = current - previous;
      if (diff > 0) return { arrow: '▲', color: COLORS.success, diff: `+${diff}` };
      if (diff < 0) return { arrow: '▼', color: COLORS.danger, diff: `${diff}` };
      return { arrow: '−', color: COLORS.muted, diff: '0' };
    }

    const postsTrend = trend(metrics.postsScanned, prevMetrics?.postsScanned);
    const labelsTrend = trend(metrics.labelsApplied, prevMetrics?.labelsApplied);

    // Severity color for queue
    const queueColor = queueCount === 0 ? COLORS.success : queueCount < 5 ? COLORS.caution : COLORS.danger;

	    const hasAnyError = metricsError || prevError || dailyError || activityError || actionLogError || queueError;

	    // Check if chart is completely empty
	    const hasChartData = chartDays.some((d) => d.value > 0);

	    async function translateDashboardQueuePreview(): Promise<void> {
	      if (!dashboardQueueItem) return;
	      if (!aiConfig) {
	        context.ui.showToast(t('queue.translationMissingConfig', lang));
	        return;
	      }
	      if (dashboardTranslationLoading) return;
	      setDashboardTranslationLoading(true);
	      setDashboardTranslationError('');
	      try {
	        const source = `${dashboardQueueItem.title}\n\n${dashboardQueuePreview}`;
	        const translation = await translateReviewPreview(source, aiConfig, languageNameForAI(lang));
	        setDashboardTranslation(translation);
	        setDashboardTranslationPostId(dashboardQueueItem.postId);
	      } catch {
	        setDashboardTranslationError(t('queue.translationFailed', lang));
	        context.ui.showToast(t('queue.translationFailed', lang));
	      } finally {
	        setDashboardTranslationLoading(false);
	      }
	    }

	    async function markDashboardQueueReviewed(): Promise<void> {
	      if (!dashboardQueueItem) return;
	      dashboardQueueItem.status = 'reviewed';
	      dashboardQueueItem.modDecision = {
	        action: 'marked reviewed',
	        modUsername: context.username || 'mod',
	        decidedAt: Date.now(),
	      };
	      await context.redis.set(REVIEW_KEY(subredditId, dashboardQueueItem.postId), JSON.stringify(dashboardQueueItem));
	      await incrementMetrics(context, subredditId, 'reviewedPosts', 1);
	      await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
	      await incrementDaily(context, subredditId, 'reviewedPosts');
	      await recordAction(context, subredditId, {
	        type: 'reviewed',
	        postTitle: dashboardQueueItem.title,
	        postId: dashboardQueueItem.postId,
	        modUsername: context.username || 'mod',
	        policyStatus: dashboardQueuePolicyStatus,
	        disclosureStatus: dashboardQueueDisclosureStatus,
	      });
	      context.ui.showToast(t('toast.reviewed', lang));
	    }

	    async function askDashboardDisclosure(): Promise<void> {
	      if (!dashboardQueueItem) return;
	      const post = await context.reddit.getPostById(dashboardQueueItem.postId);
	      const policy = await getPolicy(context, subredditId);
	      const commentText = policy?.disclosureRequestTemplate || generateDisclosureRequest(policy || applyPreset(subredditId, 'balanced'));
	      await post.addComment({ text: commentText });
	      dashboardQueueItem.status = 'asked_disclosure';
	      dashboardQueueItem.modDecision = {
	        action: 'asked for disclosure',
	        modUsername: context.username || 'mod',
	        decidedAt: Date.now(),
	      };
	      await context.redis.set(REVIEW_KEY(subredditId, dashboardQueueItem.postId), JSON.stringify(dashboardQueueItem));
	      await incrementMetrics(context, subredditId, 'disclosureRequestsSent', 1);
	      await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
	      await incrementDaily(context, subredditId, 'disclosureRequestsSent');
	      await recordAction(context, subredditId, {
	        type: 'asked_disclosure',
	        postTitle: dashboardQueueItem.title,
	        postId: dashboardQueueItem.postId,
	        modUsername: context.username || 'mod',
	        policyStatus: dashboardQueuePolicyStatus,
	        disclosureStatus: dashboardQueueDisclosureStatus,
	      });
	      context.ui.showToast(t('toast.askDisclosure', lang));
	    }

	    async function setConsoleLanguage(nextLang: SupportedLanguage): Promise<void> {
	      await context.redis.set(LANGUAGE_OVERRIDE_KEY(subredditId), nextLang);
	      setLanguageOverride(nextLang);
	      context.ui.showToast(languageSwitchToast(nextLang));
	    }

    if (hasAnyError) {
      return (
        <vstack height="100%" width="100%" padding="medium" gap="medium" alignment="middle center">
          <text size="xlarge" weight="bold">{t('dashboard.title', lang)}</text>
          <text size="medium" color={COLORS.danger}>{t('dashboard.loadError', lang)}</text>
          <text size="small" color={COLORS.muted}>{t('dashboard.tryRefresh', lang)}</text>
        </vstack>
      );
    }

    const heroQueueLabel = queueCount === 1
      ? t('hero.queueWaitingOne', lang)
      : t('hero.queueWaitingMany', lang, { n: queueCount });
    const heroAccent = queueCount > 0 ? COLORS.brand : COLORS.success;
    const heroBg = queueCount > 0 ? COLORS.brandSoft : COLORS.successSoft;
    const heroBorder = queueCount > 0 ? COLORS.brandSoftEdge : COLORS.successSoftEdge;
    const heroTitle = queueCount > 0 ? heroQueueLabel : t('hero.allClearTitle', lang);
    const heroBody = queueCount > 0 ? t('hero.queueHint', lang) : t('hero.allClearBody', lang);

    return (
      <vstack height="100%" width="100%" backgroundColor={COLORS.surfaceMuted} padding="medium" gap="small">
        {/* Header */}
        <hstack alignment="middle start" gap="small">
          <vstack grow gap="none">
            <text size="xsmall" color={COLORS.mutedSubtle}>{t('loc.dashboard', lang)}</text>
            <text size="xlarge" weight="bold" color={COLORS.ink}>{t('dashboard.title', lang)}</text>
            <text size="xsmall" color={COLORS.muted} wrap>{t('dashboard.subtitle', lang)}</text>
          </vstack>
          {renderLanguageSwitcher(lang, setConsoleLanguage)}
        </hstack>

        {/* Hero — your next move */}
        <hstack backgroundColor={heroBg} border="thin" borderColor={heroBorder} cornerRadius="medium" padding="small" gap="small" alignment="middle start">
          <vstack backgroundColor={heroAccent} cornerRadius="small" padding="xsmall" alignment="middle center">
            <text size="xsmall" weight="bold" color={COLORS.white}>{t('hero.title', lang)}</text>
          </vstack>
          <vstack grow gap="none">
            <text size="medium" weight="bold" color={COLORS.ink} wrap>{heroTitle}</text>
            <text size="xsmall" color={COLORS.muted} wrap>{heroBody}</text>
          </vstack>
          <vstack alignment="middle end" gap="none">
            <text size="xsmall" color={COLORS.mutedSubtle} wrap>{t('policy.howToOpen', lang)}</text>
          </vstack>
        </hstack>

        {/* Top Metrics: Queue (action-first) | Scanned | Time Saved */}
        <hstack gap="small">
          <vstack grow backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" alignment="middle center" gap="none">
            <text size="xxlarge" weight="bold" color={queueColor}>{queueCount.toString()}</text>
            <text size="xsmall" weight="bold" color={COLORS.muted}>{t('dashboard.inQueue', lang)}</text>
          </vstack>
          <vstack grow backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" alignment="middle center" gap="none">
            <text size="xlarge" weight="bold" color={COLORS.ink}>{metrics.postsScanned.toString()}</text>
            <text size="xsmall" color={COLORS.muted}>{t('dashboard.postsScanned', lang)}</text>
            {postsTrend.diff && (
              <text size="xsmall" color={postsTrend.color}>{postsTrend.arrow} {postsTrend.diff}</text>
            )}
          </vstack>
          <vstack grow backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" alignment="middle center" gap="none">
            <text size="xlarge" weight="bold" color={COLORS.success}>{formatTimeSaved(metrics.estimatedSecondsSaved)}</text>
            <text size="xsmall" color={COLORS.muted}>{t('dashboard.timeSaved', lang)}</text>
            <text size="xsmall" color={COLORS.muted}>{t('analytics.actionsTimes30', lang)}</text>
          </vstack>
        </hstack>

        {/* Community Pulse — compact 2-row strip */}
	        <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" gap="small">
	          <hstack gap="small" alignment="middle start">
	            <text size="small" weight="bold" color={COLORS.ink}>{t('pulse.title', lang)}</text>
	            <vstack grow />
	            <hstack gap="small" alignment="middle end">
	              <vstack backgroundColor={communityPulse.moodColor} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{communityPulse.moodScore} · {communityPulse.moodLabel}</text>
	              </vstack>
	              <vstack backgroundColor={communityPulse.reviewPressureColor} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{communityPulse.reviewPressureLabel}</text>
	              </vstack>
	              <vstack backgroundColor={communityPulse.disclosureClarityColor} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{communityPulse.disclosureClarityLabel}</text>
	              </vstack>
	            </hstack>
	          </hstack>
	          <hstack gap="small" alignment="middle start">
	            <text size="xsmall" weight="bold" color={COLORS.primary}>→ {t('pulse.nextMove', lang)}:</text>
	            <text size="xsmall" color={COLORS.ink} wrap>{communityPulse.nextMove}</text>
	          </hstack>
	        </vstack>

	        {dashboardQueueItem ? (
	          <vstack backgroundColor={COLORS.brandSoft} border="thin" borderColor={COLORS.brandSoftEdge} cornerRadius="medium" padding="small" gap="small">
	            <hstack alignment="middle start" gap="small">
	              <text size="medium" weight="bold" color={COLORS.brand}>{t('dashboard.queueWorkbench', lang)}</text>
	              <vstack grow />
	              <vstack backgroundColor={(() => { switch (dashboardQueuePolicyStatus) { case 'removal_candidate': return COLORS.danger; case 'needs_review': return COLORS.warning; case 'needs_disclosure': return COLORS.caution; case 'needs_label': return COLORS.secondary; default: return COLORS.success; } })()} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{policyStatusLabelForLanguage(dashboardQueuePolicyStatus, lang)}</text>
	              </vstack>
	            </hstack>
	            <text size="xsmall" color={COLORS.muted} wrap>{t('dashboard.queueWorkbenchDesc', lang)}</text>
	            <text size="medium" weight="bold" wrap>{dashboardQueueItem.title}</text>
	            <text size="xsmall" color={COLORS.muted} wrap>{dashboardQueuePreview.slice(0, 160)}</text>
	            <hstack gap="small">
	              {dashboardQueueReasons.slice(0, 2).map((reason, idx) => (
	                <vstack key={`dash-queue-reason-${idx}`} backgroundColor={COLORS.white} cornerRadius="small" padding="xsmall">
	                  <text size="xsmall" color={COLORS.caution} wrap>{reviewReasonLabel(reason, lang)}</text>
	                </vstack>
	              ))}
	            </hstack>
	            <hstack gap="small" alignment="middle start">
	              <button appearance="primary" size="small" onPress={askDashboardDisclosure}>{t('actions.askDisclosure', lang)}</button>
	              <button appearance="bordered" size="small" onPress={markDashboardQueueReviewed}>{t('actions.markReviewed', lang)}</button>
	              <button appearance="bordered" size="small" onPress={translateDashboardQueuePreview}>
	                {dashboardTranslationLoading ? t('queue.translating', lang) : t('queue.translatePreview', lang)}
	              </button>
	              <vstack grow />
	              <button appearance="bordered" size="small" onPress={async () => {
	                const post = await context.reddit.getPostById(dashboardQueueItem.postId);
	                context.ui.navigateTo(post);
	              }}>{t('actions.openPost', lang)}</button>
	            </hstack>
	            {dashboardTranslationError && <text size="xsmall" color={COLORS.caution}>{dashboardTranslationError}</text>}
	            {dashboardTranslation && dashboardTranslationPostId === dashboardQueueItem.postId && (
	              <vstack backgroundColor={COLORS.white} cornerRadius="small" padding="small" gap="small">
	                <text size="xsmall" weight="bold" color={COLORS.primary}>{t('queue.translationTitle', lang)} ({languageNameForAI(lang)})</text>
	                <text size="xsmall" wrap>{dashboardTranslation}</text>
	                <text size="xsmall" color={COLORS.muted}>{t('queue.translationSafety', lang)}</text>
	              </vstack>
	            )}
	          </vstack>
	        ) : (
	          <vstack backgroundColor={COLORS.successSoft} border="thin" borderColor={COLORS.successSoftEdge} cornerRadius="medium" padding="small" gap="small">
	            <hstack alignment="middle start" gap="small">
	              <text size="medium" weight="bold" color={COLORS.success}>{t('dashboard.queueWorkbench', lang)}</text>
	              <vstack grow />
	              <vstack backgroundColor={COLORS.success} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{t('queue.allClear', lang)}</text>
	              </vstack>
	            </hstack>
	            <text size="xsmall" color={COLORS.muted} wrap>{t('queue.newPostsAppear', lang)}</text>
	          </vstack>
	        )}
	
	        {/* Coexistence Visibility — always visible to keep the thesis on screen */}
	        <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" gap="small">
	          <hstack alignment="middle start" gap="small">
	            <text size="small" weight="bold" color={COLORS.ink}>{t('visibility.title', lang)}</text>
	            <vstack grow />
	            {participationTotal > 0 ? (
	              <text size="xsmall" color={COLORS.muted}>{participationTotal} {t('analytics.posts', lang)}</text>
	            ) : (
	              <text size="xsmall" color={COLORS.muted} wrap>{t('visibility.emptyHint', lang)}</text>
	            )}
	          </hstack>
	          <hstack gap="small">
	            <vstack grow backgroundColor={participationMix.human > 0 ? COLORS.success : COLORS.surfaceStrong} cornerRadius="small" padding="xsmall" alignment="middle center">
	              <text size="xsmall" weight="bold" color={participationMix.human > 0 ? COLORS.white : COLORS.muted}>{participationMix.human}</text>
	              <text size="xsmall" color={participationMix.human > 0 ? COLORS.white : COLORS.muted}>{t('visibility.human', lang)}</text>
	            </vstack>
	            <vstack grow backgroundColor={participationMix.ai_assisted > 0 ? COLORS.primary : COLORS.surfaceStrong} cornerRadius="small" padding="xsmall" alignment="middle center">
	              <text size="xsmall" weight="bold" color={participationMix.ai_assisted > 0 ? COLORS.white : COLORS.muted}>{participationMix.ai_assisted}</text>
	              <text size="xsmall" color={participationMix.ai_assisted > 0 ? COLORS.white : COLORS.muted}>{t('visibility.aiAssisted', lang)}</text>
	            </vstack>
	            <vstack grow backgroundColor={participationMix.ai_generated > 0 ? COLORS.brand : COLORS.surfaceStrong} cornerRadius="small" padding="xsmall" alignment="middle center">
	              <text size="xsmall" weight="bold" color={participationMix.ai_generated > 0 ? COLORS.white : COLORS.muted}>{participationMix.ai_generated}</text>
	              <text size="xsmall" color={participationMix.ai_generated > 0 ? COLORS.white : COLORS.muted}>{t('visibility.aiGenerated', lang)}</text>
	            </vstack>
	            <vstack grow backgroundColor={participationMix.unknown > 0 ? COLORS.secondary : COLORS.surfaceStrong} cornerRadius="small" padding="xsmall" alignment="middle center">
	              <text size="xsmall" weight="bold" color={participationMix.unknown > 0 ? COLORS.white : COLORS.muted}>{participationMix.unknown}</text>
	              <text size="xsmall" color={participationMix.unknown > 0 ? COLORS.white : COLORS.muted}>{t('visibility.unknown', lang)}</text>
	            </vstack>
	          </hstack>
	        </vstack>

      </vstack>
    );
}

/* ------------------------------------------------------------------ */
/*  Custom Post: Review Queue                                         */
/* ------------------------------------------------------------------ */

function renderReviewQueue(context: Devvit.Context): JSX.Element {
    const subredditId = context.subredditId;

    const { data: langRaw } = useAsync(async () => {
      return getPreferredLanguage(context);
    });

    const { data: allItems, loading } = useAsync(async () => {
      const keys = await context.redis.hKeys(ALL_REVIEW_KEYS(subredditId));
      const items: ReviewItem[] = [];
      for (const postId of keys) {
        const raw = await context.redis.get(REVIEW_KEY(subredditId, postId));
        if (raw) {
          try {
            const item = JSON.parse(raw) as ReviewItem;
            if (!isConsolePostTitle(item.title)) items.push(item);
          } catch {
            // ignore corrupt
          }
        }
      }
      // Sort by policyStatus priority (removal_candidate > needs_review > needs_disclosure > needs_label > compliant)
      const priority: Record<string, number> = {
        removal_candidate: 4,
        needs_review: 3,
        needs_disclosure: 2,
        needs_label: 1,
        compliant: 0,
      };
      items.sort((a, b) => priority[b.policyStatus] - priority[a.policyStatus]);
      return items;
    });

	    const [selectedId, setSelectedId] = useState<string>('');
	    const [filterStatus, setFilterStatus] = useState<string>('queued');
	    const [showNotes, setShowNotes] = useState<boolean>(false);
	    const [pageSize, setPageSize] = useState<number>(10);
	    const [translatedPreview, setTranslatedPreview] = useState<string>('');
	    const [translationSourceId, setTranslationSourceId] = useState<string>('');
	    const [translationLoading, setTranslationLoading] = useState<boolean>(false);
	    const [translationError, setTranslationError] = useState<string>('');
	    const [languageOverride, setLanguageOverride] = useState<SupportedLanguage | null>(null);

    const selected = (allItems || []).find((i) => i.id === selectedId) || (allItems || [])[0];

    const { data: modNotesRaw } = useAsync(async () => {
      if (!selected) return [];
      const raw = await context.redis.get(MODNOTES_KEY(subredditId, selected.postId));
      return raw ? JSON.parse(raw) : [];
    });

	    const modNotes: import('./types.js').ModNote[] = modNotesRaw || [];
	    const { data: aiConfigRaw } = useAsync(async () => {
	      return getModeratorAIConfig(context);
	    });
	    const aiConfig = aiConfigRaw || null;

	    const lang = languageOverride || langRaw || detectLanguage(context);

	    async function setConsoleLanguage(nextLang: SupportedLanguage): Promise<void> {
	      await context.redis.set(LANGUAGE_OVERRIDE_KEY(subredditId), nextLang);
	      setLanguageOverride(nextLang);
	      context.ui.showToast(languageSwitchToast(nextLang));
	    }

    if (loading) {
      return (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">{t('queue.loading', lang)}</text>
        </vstack>
      );
    }

    const reviewItems = (allItems || []).filter((item) => {
      if (filterStatus === 'all') return true;
      return item.status === filterStatus;
    });

    if (!reviewItems || reviewItems.length === 0) {
      return (
        <vstack height="100%" width="100%" alignment="middle center" gap="medium">
          <text size="xxlarge" weight="bold">{t('queue.title', lang)}</text>
          {renderLanguageSwitcher(lang, setConsoleLanguage)}
          <text size="medium" color={COLORS.success}>{t('queue.allClear', lang)}</text>
          <text size="small" color={COLORS.muted}>{t('queue.newPostsAppear', lang)}</text>
        </vstack>
      );
    }

    function policyStatusBadgeColor(status: string): string {
      switch (status) {
        case 'removal_candidate': return COLORS.danger;
        case 'needs_review': return COLORS.warning;
        case 'needs_disclosure': return COLORS.caution;
        case 'needs_label': return COLORS.secondary;
        default: return COLORS.success;
      }
    }

    function policyStatusLabel(status: string): string {
      return policyStatusLabelForLanguage(status, lang);
    }

    function signalBarColor(signalKey: keyof ReviewSignals): string {
      if (signalKey === 'missingDisclosure') return COLORS.warning;
      if (signalKey === 'similarToRecentPosts') return COLORS.caution;
      if (signalKey === 'repetitivePattern') return COLORS.secondary;
      if (signalKey === 'lowEffort') return COLORS.muted;
      return COLORS.secondary;
    }

    // Signal priority for visual ordering (NOT an AI score).
    // Higher = more urgent for moderator review.
	    function signalPriority(signalKey: keyof ReviewSignals): number {
	      if (signalKey === 'missingDisclosure') return 30;
	      if (signalKey === 'similarToRecentPosts') return 25;
	      if (signalKey === 'repetitivePattern') return 15;
	      if (signalKey === 'lowEffort') return 10;
	      return 5;
	    }

	    async function translateSelectedPreview(): Promise<void> {
	      if (!selected) return;
	      if (!aiConfig) {
	        context.ui.showToast(t('queue.translationMissingConfig', lang));
	        return;
	      }
	      if (translationLoading) return;
	      setTranslationLoading(true);
	      setTranslationError('');
	      try {
	        const source = `${selected.title}\n\n${selected.bodyPreview}`;
	        const translation = await translateReviewPreview(source, aiConfig, languageNameForAI(lang));
	        setTranslatedPreview(translation);
	        setTranslationSourceId(selected.id);
	      } catch {
	        setTranslationError(t('queue.translationFailed', lang));
	        context.ui.showToast(t('queue.translationFailed', lang));
	      } finally {
	        setTranslationLoading(false);
	      }
	    }

    return (
      <vstack height="100%" width="100%" backgroundColor={COLORS.surfaceMuted} padding="medium" gap="small">
        {/* Header */}
        <hstack alignment="middle start" gap="small">
          <vstack grow gap="none">
            <text size="xsmall" color={COLORS.mutedSubtle}>{t('loc.queue', lang)}</text>
            <hstack gap="small" alignment="middle start">
              <text size="xlarge" weight="bold" color={COLORS.ink}>{t('queue.title', lang)}</text>
              <vstack backgroundColor={reviewItems.length > 5 ? COLORS.danger : reviewItems.length > 0 ? COLORS.caution : COLORS.success} cornerRadius="small" padding="xsmall">
                <text size="xsmall" weight="bold" color={COLORS.white}>{reviewItems.length}</text>
              </vstack>
            </hstack>
            <text size="xsmall" color={COLORS.muted} wrap>{t('queue.priorityHint', lang)}</text>
          </vstack>
          {renderLanguageSwitcher(lang, setConsoleLanguage)}
        </hstack>

        {/* Filters */}
        <hstack gap="small">
          {(['queued', 'approved', 'labeled', 'reviewed', 'removed', 'all'] as const).map((status) => (
            <button
              key={`filter-${status}`}
              appearance={filterStatus === status ? 'primary' : 'bordered'}
              size="small"
              onPress={() => { setFilterStatus(status); setPageSize(10); }}
            >
              {statusLabel(status, lang)}
            </button>
          ))}
        </hstack>

        {/* Item list — max 3 visible to keep the page scroll-free */}
        <vstack gap="small">
          {reviewItems.slice(0, 3).map((item) => (
            <hstack
              key={item.id}
              backgroundColor={selected && item.id === selected.id ? COLORS.primarySoft : COLORS.surface}
              border="thin"
              borderColor={selected && item.id === selected.id ? COLORS.primary : COLORS.border}
              cornerRadius="small"
              padding="small"
              gap="small"
              onPress={() => setSelectedId(item.id)}
            >
              <vstack backgroundColor={policyStatusBadgeColor(item.policyStatus)} cornerRadius="small" padding="xsmall">
                <text size="xsmall" weight="bold" color={COLORS.white}>{policyStatusLabel(item.policyStatus)}</text>
              </vstack>
              <vstack grow gap="none">
                <text size="small" weight="bold" wrap color={COLORS.ink}>{item.title.slice(0, 60)}</text>
                <text size="xsmall" color={COLORS.muted}>{disclosureStatusLabel(item.disclosureStatus, lang)}</text>
              </vstack>
            </hstack>
          ))}
          {reviewItems.length > 3 && (
            <text size="xsmall" color={COLORS.muted}>+ {reviewItems.length - 3} {t('analytics.posts', lang)}</text>
          )}
        </vstack>

        {/* Selected item detail */}
        {selected && (
          <vstack gap="small" backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" grow>
            {/* Title + status badge */}
	            <hstack alignment="middle start" gap="small">
	              <text size="medium" weight="bold" wrap grow>{selected.title}</text>
	              <vstack backgroundColor={policyStatusBadgeColor(selected.policyStatus)} cornerRadius="small" padding="xsmall">
	                <text size="xsmall" weight="bold" color={COLORS.white}>{policyStatusLabel(selected.policyStatus)}</text>
	              </vstack>
	              <button appearance="bordered" size="small" onPress={async () => {
	                try {
	                  const post = await context.reddit.getPostById(selected.postId);
	                  context.ui.navigateTo(post);
	                } catch {
	                  context.ui.showToast(t('toast.errOpenPost', lang));
	                }
	              }}>{t('actions.openPost', lang)}</button>
	            </hstack>

            <text size="xsmall" color={COLORS.muted}>{disclosureStatusLabel(selected.disclosureStatus, lang)}</text>

	            <text size="small" color={COLORS.muted} wrap>{selected.bodyPreview.slice(0, 140)}</text>

	            {/* Reasons + Translate aligned */}
	            <hstack gap="small" alignment="middle start">
	              {selected.reasons.slice(0, 2).map((reason, idx) => (
	                <vstack key={`reason-${idx}`} backgroundColor={COLORS.cautionSoft} cornerRadius="small" padding="xsmall">
	                  <text size="xsmall" color={COLORS.caution} wrap>{reviewReasonLabel(reason, lang)}</text>
	                </vstack>
	              ))}
	              <vstack grow />
	              <button appearance="bordered" size="small" onPress={translateSelectedPreview}>
	                {translationLoading ? t('queue.translating', lang) : t('queue.translatePreview', lang)}
	              </button>
	            </hstack>
	            {translationError && <text size="xsmall" color={COLORS.caution}>{translationError}</text>}
	            {translatedPreview && translationSourceId === selected.id && (
	              <vstack backgroundColor={COLORS.primarySoft} cornerRadius="small" padding="small" gap="small">
	                <text size="xsmall" weight="bold" color={COLORS.primary}>{t('queue.translationTitle', lang)} ({languageNameForAI(lang)})</text>
	                <text size="xsmall" wrap>{translatedPreview}</text>
	                <text size="xsmall" color={COLORS.muted}>{t('queue.translationSafety', lang)}</text>
	              </vstack>
	            )}

	            <vstack grow />

            {/* Action Buttons — single row, clear hierarchy */}
            <hstack gap="small">
              <button appearance="success" size="medium" onPress={async () => {
                try {
                  const post = await context.reddit.getPostById(selected.postId);
                  await post.approve();
                  selected.status = 'approved';
                  selected.modDecision = {
                    action: 'approved',
                    modUsername: context.username || 'mod',
                    decidedAt: Date.now(),
                  };
                  await context.redis.set(REVIEW_KEY(subredditId, selected.postId), JSON.stringify(selected));
                  await incrementMetrics(context, subredditId, 'approvalsPerformed', 1);
                  await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
                  await incrementDaily(context, subredditId, 'approvalsPerformed');
                  await recordAction(context, subredditId, {
                    type: 'approved',
                    postTitle: selected.title,
                    postId: selected.postId,
                    modUsername: context.username || 'mod',
                    policyStatus: selected.policyStatus,
                    disclosureStatus: selected.disclosureStatus,
                  });
                  context.ui.showToast(t('toast.approved', lang));
                } catch (e) {
                  context.ui.showToast(t('toast.errApprove', lang));
                }
              }}>{t('actions.approve', lang)}</button>

              <button appearance="primary" onPress={async () => {
                try {
                  const subreddit = await context.reddit.getCurrentSubreddit();
                  const isGenerated = selected.disclosureStatus === 'ai_generated';
                  const labelText = isGenerated ? 'AI-Generated' : 'AI-Assisted';
                  const labelColor = isGenerated ? '#FF4500' : '#FFB000';
                  await context.reddit.setPostFlair({
                    subredditName: subreddit.name,
                    postId: selected.postId,
                    text: labelText,
                    backgroundColor: labelColor,
                    textColor: 'dark',
                  });
                  selected.status = 'labeled';
                  selected.modDecision = {
                    action: `labeled ${labelText.toLowerCase()}`,
                    modUsername: context.username || 'mod',
                    decidedAt: Date.now(),
                  };
                  await context.redis.set(REVIEW_KEY(subredditId, selected.postId), JSON.stringify(selected));
                  await incrementMetrics(context, subredditId, 'labelsApplied', 1);
                  await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
                  await incrementDaily(context, subredditId, 'labelsApplied');
                  await recordAction(context, subredditId, {
                    type: 'labeled',
                    description: `Post labeled as ${labelText}`,
                    postTitle: selected.title,
                    postId: selected.postId,
                    modUsername: context.username || 'mod',
                    policyStatus: selected.policyStatus,
                    disclosureStatus: selected.disclosureStatus,
                  });
                  context.ui.showToast(t('toast.labeled', lang));
                } catch (e) {
                  context.ui.showToast(t('toast.errLabel', lang));
                }
              }}>{t('actions.label', lang)}</button>

              <button appearance="bordered" onPress={async () => {
                try {
                  const post = await context.reddit.getPostById(selected.postId);
                  const policy = await getPolicy(context, subredditId);
                  const commentText = policy?.disclosureRequestTemplate || generateDisclosureRequest(policy || applyPreset(subredditId, 'balanced'));
                  await post.addComment({ text: commentText });
                  selected.status = 'asked_disclosure';
                  selected.modDecision = {
                    action: 'asked for disclosure',
                    modUsername: context.username || 'mod',
                    decidedAt: Date.now(),
                  };
                  await context.redis.set(REVIEW_KEY(subredditId, selected.postId), JSON.stringify(selected));
                  await incrementMetrics(context, subredditId, 'disclosureRequestsSent', 1);
                  await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
                  await incrementDaily(context, subredditId, 'disclosureRequestsSent');
                  await recordAction(context, subredditId, {
                    type: 'asked_disclosure',
                    postTitle: selected.title,
                    postId: selected.postId,
                    modUsername: context.username || 'mod',
                    policyStatus: selected.policyStatus,
                    disclosureStatus: selected.disclosureStatus,
                  });
                  context.ui.showToast(t('toast.askDisclosure', lang));
                } catch (e) {
                  context.ui.showToast(t('toast.errAskDisclosure', lang));
                }
              }}>{t('actions.askDisclosure', lang)}</button>

              <button appearance="bordered" onPress={async () => {
                try {
                  selected.status = 'reviewed';
                  selected.modDecision = {
                    action: 'marked reviewed',
                    modUsername: context.username || 'mod',
                    decidedAt: Date.now(),
                  };
                  await context.redis.set(REVIEW_KEY(subredditId, selected.postId), JSON.stringify(selected));
                  await incrementMetrics(context, subredditId, 'reviewedPosts', 1);
                  await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
                  await incrementDaily(context, subredditId, 'reviewedPosts');
                  await recordAction(context, subredditId, {
                    type: 'reviewed',
                    postTitle: selected.title,
                    postId: selected.postId,
                    modUsername: context.username || 'mod',
                    policyStatus: selected.policyStatus,
                    disclosureStatus: selected.disclosureStatus,
                  });
                  context.ui.showToast(t('toast.reviewed', lang));
                } catch (e) {
                  context.ui.showToast(t('toast.errReviewed', lang));
                }
	              }}>{t('actions.markReviewed', lang)}</button>
	              <vstack grow />
            <button appearance="destructive" onPress={async () => {
              try {
                const post = await context.reddit.getPostById(selected.postId);
                await post.remove(false);
                const policy = await getPolicy(context, subredditId);
                const reason = selected.reasons[0] || 'default';
                const commentText = policy?.removalReasonTemplate || generateRemovalReason(policy || applyPreset(subredditId, 'balanced'), reason);
                await post.addComment({ text: commentText });
                selected.status = 'removed';
                selected.modDecision = {
                  action: 'removed with reason',
                  modUsername: context.username || 'mod',
                  decidedAt: Date.now(),
                };
                await context.redis.set(REVIEW_KEY(subredditId, selected.postId), JSON.stringify(selected));
                await incrementMetrics(context, subredditId, 'removalsPerformed', 1);
                await incrementMetrics(context, subredditId, 'estimatedSecondsSaved', ONE_CLICK_ACTION_SECONDS);
                await incrementDaily(context, subredditId, 'removalsPerformed');
                await recordAction(context, subredditId, {
                  type: 'removed',
                  postTitle: selected.title,
                  postId: selected.postId,
                  reason,
                  modUsername: context.username || 'mod',
                  policyStatus: selected.policyStatus,
                  disclosureStatus: selected.disclosureStatus,
                });
                context.ui.showToast(t('toast.removed', lang));
              } catch (e) {
                context.ui.showToast(t('toast.errRemove', lang));
              }
	            }}>{t('actions.remove', lang)}</button>
            </hstack>
          </vstack>
        )}
      </vstack>
    );
}

/* ------------------------------------------------------------------ */
/*  Menu: Open Policy Editor                                          */
/* ------------------------------------------------------------------ */

Devvit.addMenuItem({
  label: 'Open Policy Editor',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const subredditName = subreddit.name;

    const post = await context.reddit.submitPost({
      subredditName,
      title: '⚙️ Coexistence Policy Editor',
      postData: { view: 'policy' },
      textFallback: {
        text: 'Coexistence Console policy editor for subreddit AI disclosure governance.',
      },
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading Policy Editor...</text>
        </vstack>
      ),
    });

    context.ui.showToast(`Created Policy Editor: ${post.permalink}`);
  },
});

/* ------------------------------------------------------------------ */
/*  Custom Post: Policy Editor                                        */
/* ------------------------------------------------------------------ */

function renderPolicyEditor(context: Devvit.Context): JSX.Element {
    const subredditId = context.subredditId;

    const { data: langRaw } = useAsync(async () => {
      return getPreferredLanguage(context);
    });

    const { data: policyRaw, loading, error } = useAsync(async () => {
      const policy = await getPolicy(context, subredditId);
      // Default to balanced if no policy
      return policy || applyPreset(subredditId, 'balanced');
    });

    const [languageOverride, setLanguageOverride] = useState<SupportedLanguage | null>(null);
    const lang = languageOverride || langRaw || detectLanguage(context);

    // New policy state
    const [disclosureReq, setDisclosureReq] = useState<string>('');
    const [aiGeneratedAction, setAiGeneratedAction] = useState<string>('');
    const [aiAssistedAction, setAiAssistedAction] = useState<string>('');
    const [unknownAction, setUnknownAction] = useState<string>('');
    const [similarityAction, setSimilarityAction] = useState<string>('');
    const [lowContextAction, setLowContextAction] = useState<string>('');
    const [tone, setTone] = useState<string>('');
    const [disclosureTemplate, setDisclosureTemplate] = useState<string>('');
    const [removalTemplate, setRemovalTemplate] = useState<string>('');
    const [message, setMessage] = useState<string>('');
    const [refreshKey, setRefreshKey] = useState<number>(0);
    const [copilotDrafts, setCopilotDrafts] = useState<{
      policy: string;
      disclosure: string;
      removal: string;
      sidebar: string;
      checklist: string;
      workflow: string;
      error: string;
    }>({ policy: '', disclosure: '', removal: '', sidebar: '', checklist: '', workflow: '', error: '' });
    const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
    const [aiCheckLoading, setAiCheckLoading] = useState<boolean>(false);
    const [aiCheckResult, setAiCheckResult] = useState<string>('');
    const [aiCheckError, setAiCheckError] = useState<string>('');

    const { data: aiConfigRaw } = useAsync(async () => {
      return getModeratorAIConfig(context);
    });
    const aiConfig = aiConfigRaw || null;

    async function setConsoleLanguage(nextLang: SupportedLanguage): Promise<void> {
      await context.redis.set(LANGUAGE_OVERRIDE_KEY(subredditId), nextLang);
      setLanguageOverride(nextLang);
      context.ui.showToast(languageSwitchToast(nextLang));
    }

    if (loading) {
      return (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">{t('policy.title', lang)}</text>
        </vstack>
      );
    }

    if (error) {
      return (
        <vstack height="100%" width="100%" alignment="middle center" gap="medium" padding="medium">
          <text size="large" weight="bold" color={COLORS.danger}>{t('policy.errorTitle', lang)}</text>
          <text size="small" color={COLORS.muted}>{t('policy.errorDesc', lang)}</text>
          <button appearance="bordered" onPress={() => setRefreshKey((k) => k + 1)}>{t('actions.refresh', lang)}</button>
        </vstack>
      );
    }

    const policy = policyRaw || applyPreset(subredditId, 'balanced');
    const currentDisclosureReq = disclosureReq || policy.disclosureRequirement || 'recommended';
    const currentAiGeneratedAction = aiGeneratedAction || policy.aiGeneratedAction || 'allow';
    const currentAiAssistedAction = aiAssistedAction || policy.aiAssistedAction || 'allow';
    const currentUnknownAction = unknownAction || policy.unknownAction || 'allow';
    const currentSimilarityAction = similarityAction || policy.similarityAction || 'off';
    const currentLowContextAction = lowContextAction || policy.lowContextAction || 'off';
    const currentTone = tone || policy.tone || 'neutral';
    const currentDisclosureTemplate = disclosureTemplate || policy.disclosureRequestTemplate || '';
    const currentRemovalTemplate = removalTemplate || policy.removalReasonTemplate || '';

    async function savePolicySettings(): Promise<void> {
      try {
        const newPolicy: SubredditPolicy = {
          ...policy,
          disclosureRequirement: currentDisclosureReq as SubredditPolicy['disclosureRequirement'],
          aiGeneratedAction: currentAiGeneratedAction as SubredditPolicy['aiGeneratedAction'],
          aiAssistedAction: currentAiAssistedAction as SubredditPolicy['aiAssistedAction'],
          unknownAction: currentUnknownAction as SubredditPolicy['unknownAction'],
          similarityAction: currentSimilarityAction as SubredditPolicy['similarityAction'],
          lowContextAction: currentLowContextAction as SubredditPolicy['lowContextAction'],
          tone: currentTone as SubredditPolicy['tone'],
          disclosureRequestTemplate: currentDisclosureTemplate,
          removalReasonTemplate: currentRemovalTemplate,
          generatedPolicyText: copilotDrafts.policy || policy.generatedPolicyText,
          generatedWorkflowText: copilotDrafts.workflow || policy.generatedWorkflowText,
          generatedReviewChecklist: copilotDrafts.checklist || policy.generatedReviewChecklist,
          sidebarText: copilotDrafts.sidebar || policy.sidebarText,
          updatedAt: Date.now(),
        };
        await savePolicy(context, newPolicy);
        setMessage(t('policy.saved', lang));
        context.ui.showToast(t('policy.saved', lang));
      } catch (e) {
        context.ui.showToast(t('policy.saveError', lang));
        setMessage(t('policy.saveError', lang));
      }
    }

    async function generateCopilotDrafts(): Promise<void> {
      if (!aiConfig) {
        context.ui.showToast(t('policy.copilotMissingConfig', lang));
        return;
      }
      setCopilotLoading(true);
      try {
        const languageName = languageNameForAI(lang);
        const draftPolicy: SubredditPolicy = {
          ...policy,
          disclosureRequirement: currentDisclosureReq as SubredditPolicy['disclosureRequirement'],
          aiGeneratedAction: currentAiGeneratedAction as SubredditPolicy['aiGeneratedAction'],
          aiAssistedAction: currentAiAssistedAction as SubredditPolicy['aiAssistedAction'],
          unknownAction: currentUnknownAction as SubredditPolicy['unknownAction'],
          similarityAction: currentSimilarityAction as SubredditPolicy['similarityAction'],
          lowContextAction: currentLowContextAction as SubredditPolicy['lowContextAction'],
          tone: currentTone as SubredditPolicy['tone'],
        };
        const drafts = await generatePolicyDraftPackage(currentTone, currentDisclosureReq, draftPolicy, aiConfig, languageName);
        setCopilotDrafts({ ...drafts, error: '' });
        setDisclosureTemplate(drafts.disclosure);
        setRemovalTemplate(drafts.removal);
        context.ui.showToast(t('policy.draftsGenerated', lang));
      } catch (e: any) {
        setCopilotDrafts({ policy: '', disclosure: '', removal: '', sidebar: '', checklist: '', workflow: '', error: e.message || 'Generation failed' });
        context.ui.showToast(t('policy.draftFailed', lang));
      } finally {
        setCopilotLoading(false);
      }
    }

    async function testAIConnection(): Promise<void> {
      if (!aiConfig) {
        setAiCheckError(t('policy.copilotMissingConfig', lang));
        context.ui.showToast(t('policy.copilotMissingConfig', lang));
        return;
      }
      if (aiCheckLoading) return;
      setAiCheckLoading(true);
      setAiCheckResult('');
      setAiCheckError('');
      try {
        const result = await generateConnectionCheck(aiConfig, languageNameForAI(lang));
        setAiCheckResult(result || t('policy.aiCheckSuccess', lang));
        context.ui.showToast(t('policy.aiCheckSuccess', lang));
      } catch (e: any) {
        const message = e?.message || t('policy.aiCheckFailed', lang);
        setAiCheckError(message);
        context.ui.showToast(t('policy.aiCheckFailed', lang));
      } finally {
        setAiCheckLoading(false);
      }
    }

    function applyPresetChoice(preset: 'gentle' | 'balanced' | 'strict'): void {
      const p = applyPreset(subredditId, preset);
      setDisclosureReq(p.disclosureRequirement || 'recommended');
      setAiGeneratedAction(p.aiGeneratedAction || 'allow');
      setAiAssistedAction(p.aiAssistedAction || 'allow');
      setUnknownAction(p.unknownAction || 'allow');
      setSimilarityAction(p.similarityAction || 'off');
      setLowContextAction(p.lowContextAction || 'off');
      setTone(p.tone || 'neutral');
      setDisclosureTemplate(p.disclosureRequestTemplate || '');
      setRemovalTemplate(p.removalReasonTemplate || '');
      setMessage(t(`policy.${preset}`, lang) + ' preset applied');
    }

    function setWorkflowChoice(settings: Partial<SubredditPolicy>, label: string): void {
      if (settings.disclosureRequirement) setDisclosureReq(settings.disclosureRequirement);
      if (settings.aiGeneratedAction) setAiGeneratedAction(settings.aiGeneratedAction);
      if (settings.aiAssistedAction) setAiAssistedAction(settings.aiAssistedAction);
      if (settings.unknownAction) setUnknownAction(settings.unknownAction);
      if (settings.similarityAction) setSimilarityAction(settings.similarityAction);
      if (settings.lowContextAction) setLowContextAction(settings.lowContextAction);
      if (settings.tone) setTone(settings.tone);
      setMessage(`${label} workflow applied. Review and save to activate.`);
    }

    function applyCommunityTypeChoice(type: 'advice' | 'technical' | 'creative' | 'education' | 'marketplace'): void {
      const workflows: Record<typeof type, Partial<SubredditPolicy>> = {
        advice: {
          disclosureRequirement: 'required_ai_assisted_and_generated',
          aiGeneratedAction: 'queue',
          aiAssistedAction: 'label',
          unknownAction: 'ask_disclosure',
          similarityAction: 'queue',
          lowContextAction: 'queue',
          tone: 'formal',
        },
        technical: {
          disclosureRequirement: 'recommended',
          aiGeneratedAction: 'queue',
          aiAssistedAction: 'label',
          unknownAction: 'ask_disclosure',
          similarityAction: 'queue',
          lowContextAction: 'queue',
          tone: 'neutral',
        },
        creative: {
          disclosureRequirement: 'required_ai_generated',
          aiGeneratedAction: 'label',
          aiAssistedAction: 'label',
          unknownAction: 'ask_disclosure',
          similarityAction: 'queue',
          lowContextAction: 'off',
          tone: 'friendly',
        },
        education: {
          disclosureRequirement: 'required_ai_assisted_and_generated',
          aiGeneratedAction: 'queue',
          aiAssistedAction: 'label',
          unknownAction: 'ask_disclosure',
          similarityAction: 'off',
          lowContextAction: 'queue',
          tone: 'neutral',
        },
        marketplace: {
          disclosureRequirement: 'required_ai_assisted_and_generated',
          aiGeneratedAction: 'remove',
          aiAssistedAction: 'queue',
          unknownAction: 'queue',
          similarityAction: 'queue',
          lowContextAction: 'queue',
          tone: 'strict',
        },
      };
      const labels: Record<typeof type, string> = {
        advice: 'Advice / Support',
        technical: 'Technical',
        creative: 'Creative',
        education: 'Education',
        marketplace: 'Marketplace',
      };
      setWorkflowChoice(workflows[type], labels[type]);
    }

	    const activeAIModel = describeAIConfig(aiConfig);
	    const workflowSummary = [
	      { label: t('policy.disclosure', lang), value: formatDisclosureRequirement(currentDisclosureReq, lang) },
	      { label: t('policy.aiGenerated', lang), value: formatPolicyAction(currentAiGeneratedAction, lang) },
	      { label: t('policy.aiAssisted', lang), value: formatPolicyAction(currentAiAssistedAction, lang) },
	      { label: t('policy.unknown', lang), value: formatPolicyAction(currentUnknownAction, lang) },
	      { label: t('policy.similar', lang), value: formatPolicyAction(currentSimilarityAction, lang) },
	      { label: t('policy.lowContext', lang), value: formatPolicyAction(currentLowContextAction, lang) },
	    ];
	    const draftCards = [
	      { label: t('policy.generatedPolicy', lang), value: copilotDrafts.policy || policy.generatedPolicyText || '' },
	      { label: t('policy.generatedDisclosure', lang), value: copilotDrafts.disclosure || currentDisclosureTemplate },
	      { label: t('policy.generatedRemoval', lang), value: copilotDrafts.removal || currentRemovalTemplate },
	      { label: t('policy.generatedSidebar', lang), value: copilotDrafts.sidebar || policy.sidebarText || '' },
	      { label: t('policy.generatedChecklist', lang), value: copilotDrafts.checklist || policy.generatedReviewChecklist || '' },
	      { label: t('policy.generatedWorkflow', lang), value: copilotDrafts.workflow || policy.generatedWorkflowText || '' },
	    ];
	    const hasDraftCards = draftCards.some((card) => card.value.trim().length > 0);

    const modeCards: { key: 'gentle' | 'balanced' | 'strict'; title: string; body: string }[] = [
      { key: 'gentle', title: t('policy.gentle', lang), body: t('policy.gentleDesc', lang) },
      { key: 'balanced', title: t('policy.balanced', lang), body: t('policy.balancedDesc', lang) },
      { key: 'strict', title: t('policy.strict', lang), body: t('policy.strictDesc', lang) },
    ];
    const communityChoices: { key: 'advice' | 'technical' | 'creative' | 'education' | 'marketplace'; label: string }[] = [
      { key: 'advice', label: t('policy.communityAdvice', lang) },
      { key: 'technical', label: t('policy.communityTechnical', lang) },
      { key: 'creative', label: t('policy.communityCreative', lang) },
      { key: 'education', label: t('policy.communityEducation', lang) },
      { key: 'marketplace', label: t('policy.communityMarketplace', lang) },
    ];
    const activeModeKey: 'gentle' | 'balanced' | 'strict' = (() => {
      if (currentDisclosureReq === 'optional') return 'gentle';
      if (currentAiGeneratedAction === 'remove' || currentTone === 'strict') return 'strict';
      return 'balanced';
    })();
    const workflowRows: { id: string; label: string; help: string; value: string; options: { value: string; label: string }[]; onPress: (v: any) => void }[] = [
      {
        id: 'disclosure',
        label: t('policy.disclosure', lang),
        help: t('policy.disclosureMode', lang),
        value: currentDisclosureReq,
        options: [
          { value: 'optional', label: formatDisclosureRequirement('optional', lang) },
          { value: 'recommended', label: formatDisclosureRequirement('recommended', lang) },
          { value: 'required_ai_generated', label: formatDisclosureRequirement('required_ai_generated', lang) },
          { value: 'required_ai_assisted_and_generated', label: formatDisclosureRequirement('required_ai_assisted_and_generated', lang) },
        ],
        onPress: (v: any) => setDisclosureReq(v),
      },
      {
        id: 'ai-generated',
        label: t('policy.aiGenerated', lang),
        help: t('policy.aiGenerated', lang),
        value: currentAiGeneratedAction,
        options: [
          { value: 'allow', label: formatPolicyAction('allow', lang) },
          { value: 'label', label: formatPolicyAction('label', lang) },
          { value: 'queue', label: formatPolicyAction('queue', lang) },
          { value: 'remove', label: formatPolicyAction('remove', lang) },
        ],
        onPress: (v: any) => setAiGeneratedAction(v),
      },
      {
        id: 'ai-assisted',
        label: t('policy.aiAssisted', lang),
        help: t('policy.aiAssisted', lang),
        value: currentAiAssistedAction,
        options: [
          { value: 'allow', label: formatPolicyAction('allow', lang) },
          { value: 'label', label: formatPolicyAction('label', lang) },
          { value: 'queue', label: formatPolicyAction('queue', lang) },
          { value: 'remove', label: formatPolicyAction('remove', lang) },
        ],
        onPress: (v: any) => setAiAssistedAction(v),
      },
      {
        id: 'unknown',
        label: t('policy.unknown', lang),
        help: t('policy.unknown', lang),
        value: currentUnknownAction,
        options: [
          { value: 'allow', label: formatPolicyAction('allow', lang) },
          { value: 'queue', label: formatPolicyAction('queue', lang) },
          { value: 'ask_disclosure', label: formatPolicyAction('ask_disclosure', lang) },
        ],
        onPress: (v: any) => setUnknownAction(v),
      },
      {
        id: 'similarity',
        label: t('policy.similar', lang),
        help: t('policy.similar', lang),
        value: currentSimilarityAction,
        options: [
          { value: 'off', label: formatPolicyAction('off', lang) },
          { value: 'queue', label: formatPolicyAction('queue', lang) },
        ],
        onPress: (v: any) => setSimilarityAction(v),
      },
      {
        id: 'low-context',
        label: t('policy.lowContext', lang),
        help: t('policy.lowContext', lang),
        value: currentLowContextAction,
        options: [
          { value: 'off', label: formatPolicyAction('off', lang) },
          { value: 'queue', label: formatPolicyAction('queue', lang) },
        ],
        onPress: (v: any) => setLowContextAction(v),
      },
      {
        id: 'tone',
        label: t('policy.tone', lang),
        help: t('policy.tone', lang),
        value: currentTone,
        options: [
          { value: 'friendly', label: formatTone('friendly', lang) },
          { value: 'neutral', label: formatTone('neutral', lang) },
          { value: 'formal', label: formatTone('formal', lang) },
          { value: 'strict', label: formatTone('strict', lang) },
        ],
        onPress: (v: any) => setTone(v),
      },
    ];

    return (
      <vstack height="100%" width="100%" backgroundColor={COLORS.surfaceMuted} padding="medium" gap="small">
        {/* Header */}
        <hstack alignment="middle start" gap="small">
          <vstack grow gap="none">
            <text size="xsmall" color={COLORS.mutedSubtle}>{t('loc.policy', lang)}</text>
            <text size="xlarge" weight="bold" color={COLORS.ink}>{t('policy.title', lang)}</text>
            <text size="xsmall" color={COLORS.muted} wrap>{t('policy.subtitle', lang)}</text>
          </vstack>
          {renderLanguageSwitcher(lang, setConsoleLanguage)}
        </hstack>

        {/* Step 1 + Step 2 — side-by-side starting points */}
        <hstack gap="small" alignment="top start">
          {/* Step 1: Mode */}
          <vstack grow backgroundColor={COLORS.surface} cornerRadius="medium" padding="small" gap="small" border="thin" borderColor={COLORS.border}>
            <text size="xsmall" weight="bold" color={COLORS.primary}>{t('policy.modeStep', lang)}</text>
            <hstack gap="small" alignment="top start">
              {modeCards.map((card) => {
                const active = card.key === activeModeKey;
                return (
                  <vstack
                    key={`mode-${card.key}`}
                    grow
                    backgroundColor={active ? COLORS.primarySoft : COLORS.surfaceMuted}
                    border="thin"
                    borderColor={active ? COLORS.primary : COLORS.border}
                    cornerRadius="medium"
                    padding="small"
                    gap="none"
                    onPress={() => applyPresetChoice(card.key)}
                  >
                    <text size="small" weight="bold" color={active ? COLORS.primary : COLORS.ink}>{card.title}</text>
                    <text size="xsmall" color={COLORS.muted} wrap>{card.body}</text>
                  </vstack>
                );
              })}
            </hstack>
          </vstack>
        </hstack>

        {/* Step 2: Community */}
        <vstack backgroundColor={COLORS.surface} cornerRadius="medium" padding="small" gap="small" border="thin" borderColor={COLORS.border}>
          <text size="xsmall" weight="bold" color={COLORS.primary}>{t('policy.communityStep', lang)}</text>
          <hstack gap="small">
            {communityChoices.map((c) => (
              <button
                key={`comm-${c.key}`}
                appearance="bordered"
                size="small"
                onPress={() => applyCommunityTypeChoice(c.key)}
              >{c.label}</button>
            ))}
          </hstack>
        </vstack>

        {/* Step 3: Workflow Rules — the board */}
        <vstack backgroundColor={COLORS.surface} cornerRadius="medium" padding="small" gap="small" border="thin" borderColor={COLORS.border}>
          <hstack alignment="middle start" gap="small">
            <text size="xsmall" weight="bold" color={COLORS.primary}>{t('policy.boardStep', lang)}</text>
            <vstack grow />
            <text size="xsmall" color={COLORS.muted} wrap>{t('policy.boardDesc', lang)}</text>
          </hstack>
          <vstack gap="small">
            {workflowRows.map((row) => (
              <hstack key={`row-${row.id}`} gap="small" alignment="middle start" backgroundColor={COLORS.surfaceMuted} cornerRadius="small" padding="xsmall">
                <vstack width="96px" alignment="middle start">
                  <text size="xsmall" weight="bold" color={COLORS.ink}>{row.label}</text>
                </vstack>
                <hstack gap="small" grow>
                  {row.options.map((opt) => (
                    <button
                      key={`row-${row.id}-${opt.value}`}
                      appearance={row.value === opt.value ? 'primary' : 'bordered'}
                      size="small"
                      onPress={() => row.onPress(opt.value)}
                    >{opt.label}</button>
                  ))}
                </hstack>
              </hstack>
            ))}
          </vstack>
        </vstack>

        {/* Save row */}
        <hstack gap="small" alignment="middle start">
          <button appearance="primary" size="medium" onPress={savePolicySettings}>{t('policy.save', lang)}</button>
          <button appearance="bordered" size="medium" onPress={() => context.ui.showToast(t('policy.discarded', lang))}>{t('policy.reset', lang)}</button>
          <vstack grow />
          {message ? (
            <text size="xsmall" color={COLORS.success} wrap>{message}</text>
          ) : (
            <text size="xsmall" color={COLORS.muted} wrap>{t('policy.unsavedHint', lang)}</text>
          )}
        </hstack>

        {/* Optional · AI Copilot */}
        <vstack backgroundColor={COLORS.surface} cornerRadius="medium" padding="small" gap="small" border="thin" borderColor={COLORS.border}>
          <hstack alignment="middle start" gap="small">
            <text size="xsmall" weight="bold" color={COLORS.primary}>{t('policy.copilotStep', lang)}</text>
            <vstack backgroundColor={COLORS.primary} cornerRadius="small" padding="xsmall">
              <text size="xsmall" weight="bold" color={COLORS.white}>{t('policy.aiBadge', lang)}</text>
            </vstack>
            <vstack grow />
            <text size="xsmall" color={aiConfig ? COLORS.success : COLORS.caution} wrap>{aiConfig ? activeAIModel : t('policy.aiNotConfigured', lang)}</text>
          </hstack>
          <text size="xsmall" color={COLORS.muted} wrap>{t('policy.copilotTagline', lang)}</text>
          <hstack gap="small" alignment="middle start">
            <button appearance="primary" size="small" onPress={async () => { if (!copilotLoading) await generateCopilotDrafts(); }}>
              {copilotLoading ? t('policy.generating', lang) : t('policy.generateDrafts', lang)}
            </button>
            <button appearance="bordered" size="small" onPress={testAIConnection}>
              {aiCheckLoading ? t('policy.aiChecking', lang) : t('policy.aiCheck', lang)}
            </button>
            <vstack grow />
            {aiCheckResult && <text size="xsmall" color={COLORS.success} wrap>{aiCheckResult}</text>}
            {aiCheckError && <text size="xsmall" color={COLORS.danger} wrap>{aiCheckError}</text>}
          </hstack>
          {copilotDrafts.error && <text size="xsmall" color={COLORS.danger} wrap>{t('policy.errorPrefix', lang)} {copilotDrafts.error}</text>}

          {hasDraftCards && (
            <vstack gap="small">
              <hstack alignment="middle start" gap="small">
                <text size="xsmall" weight="bold" color={COLORS.primary}>{t('policy.draftsTitle', lang)}</text>
                <vstack grow />
                <text size="xsmall" color={COLORS.muted} wrap>{t('policy.draftsHint', lang)}</text>
              </hstack>
              <hstack gap="small" alignment="top start">
                {draftCards.slice(0, 3).map((card) => card.value ? (
                  <vstack key={`draft-${card.label}`} grow backgroundColor={COLORS.surfaceMuted} cornerRadius="small" padding="xsmall" gap="none" border="thin" borderColor={COLORS.border}>
                    <text size="xsmall" weight="bold" color={COLORS.ink}>{card.label}</text>
                    <text size="xsmall" color={COLORS.muted} wrap>{card.value}</text>
                  </vstack>
                ) : null)}
              </hstack>
            </vstack>
          )}
        </vstack>
      </vstack>
    );
}

/* ------------------------------------------------------------------ */
/*  M4: User-Facing Disclosure Flow                                   */
/* ------------------------------------------------------------------ */

const disclosureFormKey = Devvit.createForm(
  {
    title: 'AI Content Disclosure',
    description: 'Help keep our community transparent by disclosing AI usage.',
    fields: [
      {
        type: 'string',
        name: 'title',
        label: 'Post Title',
        required: true,
      },
      {
        type: 'paragraph',
        name: 'body',
        label: 'Post Content',
        required: true,
      },
      {
        type: 'select',
        name: 'disclosure',
        label: 'How was this post created?',
        required: true,
        options: [
          { label: 'Written entirely by me (no AI)', value: 'human_written' },
          { label: 'AI-assisted (I used AI tools)', value: 'ai_assisted' },
          { label: 'AI-generated (AI created most)', value: 'ai_generated' },
        ],
      } as any,
    ],
    acceptLabel: 'Submit Post',
    cancelLabel: 'Cancel',
  },
  async (event, context) => {
    const { title, body, disclosure } = event.values;
    const selectedDisclosure = Array.isArray(disclosure) ? disclosure[0] : disclosure;
    const subreddit = await context.reddit.getCurrentSubreddit();

    const disclosureTag =
      selectedDisclosure === 'human_written'
        ? '[HUMAN]'
        : selectedDisclosure === 'ai_assisted'
        ? '[AI-ASSISTED]'
        : '[AI-GENERATED]';

    const fullTitle = `${disclosureTag} ${title}`;

    try {
      const post = await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: fullTitle,
        text: body,
      });

      // Store disclosure metadata in Redis
      await context.redis.set(
        `disclosure:${post.id}`,
        JSON.stringify({
          postId: post.id,
          disclosure: selectedDisclosure as string,
          submittedAt: Date.now(),
          username: context.username || 'unknown',
        })
      );

      // Also update metrics
      const subredditId = context.subredditId;
      await incrementMetrics(context, subredditId, 'postsScanned', 1);
      await incrementDaily(context, subredditId, 'postsScanned');

      context.ui.showToast('Posted with AI disclosure! Thank you for being transparent.');
    } catch (e) {
      context.ui.showToast('Error submitting post. Please try again.');
    }
  }
);

Devvit.addMenuItem({
  label: 'Submit Post with AI Disclosure',
  location: 'subreddit',
  onPress: async (event, context) => {
    context.ui.showForm(disclosureFormKey);
  },
});

/* ------------------------------------------------------------------ */
/*  M5: Analytics Dashboard                                           */
/* ------------------------------------------------------------------ */

function renderAnalytics(context: Devvit.Context): JSX.Element {
    const subredditId = context.subredditId;
    const { data: langRaw } = useAsync(async () => {
      return getPreferredLanguage(context);
    });
    const [languageOverride, setLanguageOverride] = useState<SupportedLanguage | null>(null);
    const lang = languageOverride || langRaw || detectLanguage(context);
    const [aiPulseSummary, setAiPulseSummary] = useState<string>('');
    const [aiPulseError, setAiPulseError] = useState<string>('');
    const [aiPulseLoading, setAiPulseLoading] = useState<boolean>(false);

    const { data: metricsRaw } = useAsync(async () => {
      const weekStart = getWeekStart(Date.now());
      const raw = await context.redis.get(METRICS_KEY(subredditId, weekStart));
      return raw ? JSON.parse(raw) : null;
    });

    const { data: prevMetricsRaw } = useAsync(async () => {
      const prevWeekStart = getWeekStart(Date.now()) - 7 * 24 * 60 * 60 * 1000;
      const raw = await context.redis.get(METRICS_KEY(subredditId, prevWeekStart));
      return raw ? JSON.parse(raw) : null;
    });

    const { data: dailyRaw } = useAsync(async () => {
      const raw = await context.redis.get(DAILY_KEY(subredditId));
      return raw ? JSON.parse(raw) : {};
    });

    const { data: actionLogRaw } = useAsync(async () => {
      const raw = await context.redis.get(ACTION_LOG_KEY(subredditId));
      return parseActionLog(raw);
    });

    const { data: queueCountRaw } = useAsync(async () => {
      const keys = await context.redis.hKeys(ALL_REVIEW_KEYS(subredditId));
      let count = 0;
      for (const postId of keys) {
        const raw = await context.redis.get(REVIEW_KEY(subredditId, postId));
        if (!raw) continue;
        try {
          const item = JSON.parse(raw) as ReviewItem;
          if (!isConsolePostTitle(item.title) && item.status === 'queued') count += 1;
        } catch {
          // ignore corrupt
        }
      }
      return count;
    });

    const actionLog: ActionLogEntry[] = actionLogRaw || [];
    const visibleActionLog = actionLog.filter((entry) => !isConsolePostTitle(entry.postTitle));
    const hasActionLog = actionLog.length > 0;
    const weekStart = getWeekStart(Date.now());
    const metrics: Metrics = hasActionLog
      ? buildMetricsFromActionLog(subredditId, visibleActionLog, weekStart)
      : normalizeMetrics(metricsRaw, subredditId, weekStart);

    const prevWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000;
    const prevMetrics: Metrics | null = hasActionLog
      ? buildMetricsFromActionLog(subredditId, visibleActionLog, prevWeekStart)
      : prevMetricsRaw ? normalizeMetrics(prevMetricsRaw, subredditId, prevWeekStart) : null;
    const daily = hasActionLog ? buildDailyFromActionLog(visibleActionLog) : dailyRaw || {};
    const participationMix = hasActionLog
      ? buildParticipationMix(visibleActionLog, weekStart)
      : { human: 0, ai_assisted: 0, ai_generated: 0, unknown: 0 };
    const participationTotal = Object.values(participationMix).reduce((sum, count) => sum + count, 0);
    const queueCount = queueCountRaw || 0;
    const communityPulse = buildCommunityPulse(metrics, participationMix, visibleActionLog, queueCount, lang);

    // Community Health Score: 0-100
    // Higher disclosure rate = healthier community
    // Lower removal rate = healthier community
    const totalPosts = Math.max(metrics.postsScanned, 1);
    const disclosureRate = (metrics.disclosureRequestsSent + metrics.labelsApplied) / totalPosts;
    const removalRate = metrics.removalsPerformed / totalPosts;
    const healthScore = Math.min(100, Math.round(
      40 + (disclosureRate * 100) * 0.6 - (removalRate * 100) * 0.3
    ));

    const healthColor = healthScore >= 80 ? COLORS.success : healthScore >= 50 ? COLORS.caution : COLORS.danger;
    const healthLabel = healthScore >= 80 ? t('health.excellent', lang) : healthScore >= 50 ? t('health.good', lang) : t('health.needsAttention', lang);

    // Weekly disclosure rate trend
    const disclosureThisWeek = metrics.disclosureRequestsSent + metrics.labelsApplied;
    const disclosureLastWeek = (prevMetrics?.disclosureRequestsSent || 0) + (prevMetrics?.labelsApplied || 0);
    const disclosureTrend = disclosureLastWeek > 0
      ? Math.round(((disclosureThisWeek - disclosureLastWeek) / disclosureLastWeek) * 100)
      : 0;

    async function generateAIPulse(): Promise<void> {
      if (aiPulseLoading) return;
      setAiPulseLoading(true);
      setAiPulseError('');
      try {
        const config = await getModeratorAIConfig(context);
        if (!config) {
          setAiPulseSummary(`AI summary unavailable; local fallback: ${communityPulse.summary} ${t('pulse.nextMove', lang)}: ${communityPulse.nextMove}`);
          setAiPulseError(t('pulse.aiMissingConfig', lang));
          context.ui.showToast(t('pulse.aiMissingConfigToast', lang));
          return;
        }
        const summary = await generateCommunityPulseSummary(communityPulse.facts, config, languageNameForAI(lang));
        setAiPulseSummary(summary);
        context.ui.showToast(t('pulse.aiSuccessToast', lang));
      } catch (e: any) {
        const message = e?.message || t('pulse.aiFailed', lang);
        setAiPulseSummary(`AI summary unavailable; local fallback: ${communityPulse.summary} ${t('pulse.nextMove', lang)}: ${communityPulse.nextMove}`);
        setAiPulseError(message);
        context.ui.showToast(t('pulse.aiFailed', lang));
      } finally {
        setAiPulseLoading(false);
      }
    }

    async function setConsoleLanguage(nextLang: SupportedLanguage): Promise<void> {
      await context.redis.set(LANGUAGE_OVERRIDE_KEY(subredditId), nextLang);
      setLanguageOverride(nextLang);
      context.ui.showToast(languageSwitchToast(nextLang));
    }

    return (
      <vstack gap="small" padding="medium" width="100%" height="100%" backgroundColor={COLORS.surfaceMuted}>
        <hstack alignment="middle start" gap="small">
          <vstack grow gap="none">
            <text size="xsmall" color={COLORS.mutedSubtle}>{t('loc.analytics', lang)}</text>
            <text size="xlarge" weight="bold" color={COLORS.ink}>{t('analytics.title', lang)}</text>
            <text size="xsmall" color={COLORS.muted}>{t('analytics.poweredBy', lang)}</text>
          </vstack>
          {renderLanguageSwitcher(lang, setConsoleLanguage)}
        </hstack>

        {/* Coexistence Visibility (Moved to top) */}
        <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" gap="small">
          <hstack gap="small" alignment="middle center">
            <vstack grow>
              <text size="small" weight="bold">{t('visibility.title', lang)}</text>
              <text size="xsmall" color={COLORS.muted}>{t('visibility.unknownNote', lang)}</text>
            </vstack>
            <vstack alignment="middle center">
              <text size="small" weight="bold" color={COLORS.brand}>{participationTotal}</text>
              <text size="xsmall" color={COLORS.muted}>{t('analytics.posts', lang)}</text>
            </vstack>
          </hstack>
          
          {/* Horizontal Bar Chart for Participation */}
          {participationTotal > 0 && (
            <hstack height="12px" width="100%" backgroundColor={COLORS.surfaceStrong} cornerRadius="small">
               {participationMix.human > 0 && (
                 <hstack width={`${(participationMix.human / participationTotal) * 100}%`} height="100%" backgroundColor={COLORS.success} />
               )}
               {participationMix.ai_assisted > 0 && (
                 <hstack width={`${(participationMix.ai_assisted / participationTotal) * 100}%`} height="100%" backgroundColor={COLORS.primary} />
               )}
               {participationMix.ai_generated > 0 && (
                 <hstack width={`${(participationMix.ai_generated / participationTotal) * 100}%`} height="100%" backgroundColor={COLORS.brand} />
               )}
               {participationMix.unknown > 0 && (
                 <hstack width={`${(participationMix.unknown / participationTotal) * 100}%`} height="100%" backgroundColor={COLORS.secondary} />
               )}
            </hstack>
          )}

          <hstack gap="small">
            <vstack grow backgroundColor={COLORS.success} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{participationMix.human}</text>
              <text size="xsmall" color={COLORS.white}>{t('visibility.human', lang)}</text>
              <text size="xsmall" color={COLORS.white}>{percentOf(participationTotal, participationMix.human)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.primary} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{participationMix.ai_assisted}</text>
              <text size="xsmall" color={COLORS.white}>{t('visibility.aiAssisted', lang)}</text>
              <text size="xsmall" color={COLORS.white}>{percentOf(participationTotal, participationMix.ai_assisted)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.brand} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{participationMix.ai_generated}</text>
              <text size="xsmall" color={COLORS.white}>{t('visibility.aiGenerated', lang)}</text>
              <text size="xsmall" color={COLORS.white}>{percentOf(participationTotal, participationMix.ai_generated)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.secondary} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{participationMix.unknown}</text>
              <text size="xsmall" color={COLORS.white}>{t('visibility.unknown', lang)}</text>
              <text size="xsmall" color={COLORS.white}>{percentOf(participationTotal, participationMix.unknown)}</text>
            </vstack>
          </hstack>
        </vstack>

        {/* Top Stats */}
        <hstack gap="small">
          <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" grow gap="none" alignment="middle center">
            <text size="xsmall" color={COLORS.muted}>{t('health.title', lang)}</text>
            <text size="xlarge" weight="bold" color={healthColor}>{healthScore}</text>
            <text size="xsmall" color={healthColor}>{healthLabel}</text>
          </vstack>
          <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" grow gap="none" alignment="middle center">
            <text size="xsmall" color={COLORS.muted}>{t('health.disclosureRate', lang)}</text>
            <text size="xlarge" weight="bold" color={COLORS.brand}>
              {Math.round((disclosureThisWeek / Math.max(totalPosts, 1)) * 100)}%
            </text>
            {disclosureTrend !== 0 && (
              <text size="xsmall" color={disclosureTrend > 0 ? COLORS.success : COLORS.danger}>
                {disclosureTrend > 0 ? '▲' : '▼'} {Math.abs(disclosureTrend)}%
              </text>
            )}
          </vstack>
          <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" grow gap="none" alignment="middle center">
            <text size="xsmall" color={COLORS.muted}>{t('dashboard.timeSaved', lang)}</text>
            <text size="xlarge" weight="bold" color={COLORS.success}>
              {formatTimeSaved(metrics.estimatedSecondsSaved)}
            </text>
            <text size="xsmall" color={COLORS.muted}>{t('analytics.actionsTimes30', lang)}</text>
          </vstack>
        </hstack>

        {/* Community Pulse + AI Pulse */}
        <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" gap="small">
          <hstack gap="small" alignment="middle center">
            <vstack grow>
              <text size="small" weight="bold">{t('pulse.title', lang)}</text>
              <text size="xsmall" color={COLORS.muted}>{t('pulse.analyticsSubtitle', lang)}</text>
            </vstack>
            <vstack alignment="middle end">
              <button appearance="bordered" size="small" onPress={generateAIPulse}>
                {aiPulseLoading ? t('pulse.aiLoading', lang) : t('pulse.aiButton', lang)}
              </button>
              <text size="xsmall" color={COLORS.muted}>{t('pulse.modAssistOnly', lang)}</text>
            </vstack>
          </hstack>
          <hstack gap="small">
            <vstack grow backgroundColor={communityPulse.moodColor} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{communityPulse.moodScore}</text>
              <text size="xsmall" color={COLORS.white}>{communityPulse.moodLabel} {t('pulse.moodSuffix', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={communityPulse.reviewPressureColor} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{communityPulse.reviewPressureLabel}</text>
              <text size="xsmall" color={COLORS.white}>{t('pulse.reviewPressure', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={communityPulse.disclosureClarityColor} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{communityPulse.disclosureClarityLabel}</text>
              <text size="xsmall" color={COLORS.white}>{t('pulse.disclosureClarity', lang)}</text>
            </vstack>
          </hstack>
          
          <hstack gap="small" alignment="middle start">
            <text size="xsmall" weight="bold" color={COLORS.primary}>→ {t('pulse.nextMove', lang)}:</text>
            <text size="xsmall" color={COLORS.primary} wrap>{communityPulse.nextMove}</text>
          </hstack>

          {aiPulseSummary && (
            <vstack backgroundColor={COLORS.white} cornerRadius="small" padding="small" gap="small">
              <text size="xsmall" weight="bold">{t('pulse.aiSummaryTitle', lang)}</text>
              <text size="xsmall" wrap>{aiPulseSummary}</text>
            </vstack>
          )}
          {aiPulseError && (
            <text size="xsmall" color={COLORS.caution}>{aiPulseError}</text>
          )}
        </vstack>

        {/* Action Distribution */}
        <vstack backgroundColor={COLORS.surface} border="thin" borderColor={COLORS.border} cornerRadius="medium" padding="small" gap="small">
          <hstack gap="small" alignment="middle start">
            <text size="small" weight="bold">{t('analytics.actionsThisWeek', lang)}</text>
            <vstack grow />
            <text size="xsmall" color={COLORS.success} weight="bold">{t('analytics.actionLogSource', lang)}</text>
          </hstack>
          <hstack gap="small">
            <vstack grow backgroundColor={COLORS.success} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.postsScanned}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.scanned', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.secondary} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.itemsQueued}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.queued', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.primary} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.labelsApplied}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.labeled', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.caution} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.disclosureRequestsSent}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.requests', lang)}</text>
            </vstack>
          </hstack>
          <hstack gap="small">
            <vstack grow backgroundColor={COLORS.success} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.approvalsPerformed}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.approved', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.secondary} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.reviewedPosts}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.reviewed', lang)}</text>
            </vstack>
            <vstack grow backgroundColor={COLORS.danger} cornerRadius="small" padding="small" alignment="middle center">
              <text size="small" weight="bold" color={COLORS.white}>{metrics.removalsPerformed}</text>
              <text size="xsmall" color={COLORS.white}>{t('analytics.removed', lang)}</text>
            </vstack>
          </hstack>
        </vstack>

      </vstack>
    );
}

Devvit.addMenuItem({
  label: 'Open Community Analytics',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      subredditName: subreddit.name,
      title: '📊 Community Analytics Dashboard',
      postData: { view: 'analytics' },
      textFallback: {
        text: 'Coexistence Console community analytics for AI disclosure and moderator actions.',
      },
      preview: (
        <vstack height="100%" width="100%" alignment="middle center" backgroundColor={COLORS.surface}>
          <text size="large" weight="bold">Loading Analytics...</text>
        </vstack>
      ),
    });
  },
});

Devvit.addCustomPostType({
  name: 'Coexistence Console',
  description: 'Unified moderator console for AI content disclosure, queue review, policy editing, and analytics',
  height: 'tall',
  render: (context) => {
    const view = getConsoleView(context);
    if (view === 'queue') return renderReviewQueue(context);
    if (view === 'policy') return renderPolicyEditor(context);
    if (view === 'analytics') return renderAnalytics(context);
    return renderDashboard(context);
  },
});

export default Devvit;

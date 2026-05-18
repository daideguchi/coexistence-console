import type { SubredditPolicy, PresetName } from './types.js';
import { PRESETS } from './types.js';

const POLICY_KEY = (subredditId: string) => `policy:${subredditId}`;

// Unified Redis context used by triggers, dashboard, and policy editor.
type RedisContext = { redis: { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<string>; } };

export async function getPolicy(context: RedisContext, subredditId: string): Promise<SubredditPolicy | undefined> {
  const raw = await context.redis.get(POLICY_KEY(subredditId));
  return raw ? JSON.parse(raw) as SubredditPolicy : undefined;
}

export async function savePolicy(context: RedisContext, policy: SubredditPolicy): Promise<void> {
  await context.redis.set(POLICY_KEY(policy.subredditId), JSON.stringify(policy));
}

export async function deletePolicy(context: RedisContext, subredditId: string): Promise<void> {
  await context.redis.set(POLICY_KEY(subredditId), '');
}

export function createDefaultPolicy(subredditId: string): SubredditPolicy {
  const now = Date.now();
  return {
    subredditId,
    // New fields
    disclosureRequirement: 'recommended',
    aiGeneratedAction: 'allow',
    aiAssistedAction: 'allow',
    unknownAction: 'allow',
    similarityAction: 'off',
    lowContextAction: 'off',
    tone: 'neutral',
    disclosureRequestTemplate: 'Hi! This community asks contributors to disclose when a post is AI-generated or substantially AI-assisted.\n\nPlease reply with whether this post is:\n- human-written\n- AI-assisted\n- AI-generated\n\nThis helps keep the community transparent while still allowing useful contributions.',
    removalReasonTemplate: 'Your post was removed because this community requires disclosure for AI-generated or substantially AI-assisted content.\n\nYou are welcome to resubmit with an appropriate disclosure label if the post follows the community rules.',
    // Legacy fields (backward compatibility)
    disclosureMode: 'recommended',
    aiGeneratedPolicy: 'allow',
    aiAssistedPolicy: 'allow',
    unknownPolicy: 'allow',
    similarityPolicy: 'off',
    lowEffortPolicy: 'off',
    defaultActionMode: 'label_only',
    trustedUserBypass: true,
    newUserSensitivity: 'low',
    publicTransparencyComment: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyPreset(subredditId: string, preset: PresetName): SubredditPolicy {
  const base = createDefaultPolicy(subredditId);
  const overrides = PRESETS[preset];
  return { ...base, ...overrides, updatedAt: Date.now() };
}

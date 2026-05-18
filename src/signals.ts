import type { SubredditPolicy, ReviewSignals, DisclosureStatus } from './types.js';

// Self-disclosure keywords - these are signals, NOT proof
const SELF_DISCLOSURE_TERMS = [
  'ai-assisted',
  'ai assisted',
  'ai-generated',
  'ai generated',
  'chatgpt',
  'claude',
  'gemini',
  'llm-assisted',
  'llm assisted',
  'generated with ai',
  'i used ai',
  'i used chatgpt',
  'i used claude',
  'ai helped',
  'ai wrote',
  'copilot',
  'github copilot',
  'cursor ai',
];

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','must','shall','can','need','dare','ought','used',
  'to','of','in','for','on','with','at','by','from','as','into',
  'through','during','before','after','above','below','between','under',
  'and','but','or','yet','so','if','because','although','though',
  'while','where','when','that','which','who','whom','whose','what',
  'this','these','those','i','you','he','she','it','we','they',
  'me','him','her','us','them','my','your','his','its','our','their',
]);

export type RecentPostSnippet = {
  postId: string;
  normalized: string;
  ngrams: string[];
};

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function removeStopWords(text: string): string {
  return text
    .split(' ')
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .join(' ');
}

export function makeNgrams(text: string, n: number): string[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  const grams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(' '));
  }
  return grams;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Estimate disclosure status from self-reported terms and flair.
 * Returns a signal, NOT a definitive classification.
 */
export function estimateDisclosureStatus(title: string, body: string, linkFlairText?: string): DisclosureStatus {
  const combined = (title + ' ' + body).toLowerCase();
  const flair = (linkFlairText || '').toLowerCase();

  // Check flair first (most reliable)
  if (flair.includes('ai-generated') || flair.includes('ai generated')) {
    return 'ai_generated';
  }
  if (flair.includes('ai-assisted') || flair.includes('ai assisted')) {
    return 'ai_assisted';
  }
  if (flair.includes('human-written') || flair.includes('human written')) {
    return 'human';
  }

  // Check self-disclosure terms in text
  for (const term of SELF_DISCLOSURE_TERMS) {
    if (combined.includes(term)) {
      // Determine if it's "generated" vs "assisted"
      if (term.includes('generated') || term.includes('wrote') || term.includes('wrote')) {
        return 'ai_generated';
      }
      return 'ai_assisted';
    }
  }

  return 'unknown';
}

/**
 * Check if post matches recent posts (repetition signal, NOT AI detection)
 */
export function checkSimilarity(
  title: string,
  body: string,
  recentSnippets: RecentPostSnippet[]
): { similar: boolean; similarCount: number; maxSim: number } {
  if (recentSnippets.length === 0) {
    return { similar: false, similarCount: 0, maxSim: 0 };
  }

  const normalized = normalizeText(title + ' ' + body);
  const filtered = removeStopWords(normalized);
  const ngrams = makeNgrams(filtered, 3);

  let maxSim = 0;
  let similarCount = 0;

  for (const snippet of recentSnippets) {
    const sim = jaccardSimilarity(ngrams, snippet.ngrams);
    if (sim > maxSim) maxSim = sim;
    if (sim > 0.5) similarCount++;
  }

  return { similar: maxSim > 0.5, similarCount, maxSim };
}

/**
 * Check for low-context signal (NOT low quality judgment)
 */
export function checkLowContext(title: string, body: string): boolean {
  const combined = title + ' ' + body;
  const wordCount = combined.split(/\s+/).filter((w) => w.length > 0).length;

  // Extremely short posts
  if (wordCount < 10) return true;

  // Title-only with very short title
  if (body.trim().length === 0 && title.length < 15) return true;

  // URL-only posts
  if (body.trim().startsWith('http') && wordCount < 5) return true;

  return false;
}

/**
 * Check for self-disclosure terms in text
 */
export function hasSelfDisclosureTerms(title: string, body: string): boolean {
  const combined = (title + ' ' + body).toLowerCase();
  return SELF_DISCLOSURE_TERMS.some((term) => combined.includes(term));
}

/**
 * Compute policy status and reasons - NO SCORE, NO AUTO-REMOVAL
 * Returns explainable signals and policy-based status.
 */
export function evaluatePost(
  title: string,
  body: string,
  policy: SubredditPolicy,
  disclosureStatus: DisclosureStatus,
  recentSnippets: RecentPostSnippet[]
): {
  signals: ReviewSignals;
  policyStatus: 'compliant' | 'needs_label' | 'needs_disclosure' | 'needs_review' | 'removal_candidate';
  reasons: string[];
  suggestedActions: Array<'approve' | 'apply_label' | 'ask_disclosure' | 'remove_with_reason' | 'mark_reviewed'>;
} {
  const signals: ReviewSignals = {
    missingDisclosure: false,
    similarToRecentPosts: false,
    repetitivePattern: false,
    lowEffort: false,
    newAccount: false,
  };

  const reasons: string[] = [];
  const suggestedActions: Array<'approve' | 'apply_label' | 'ask_disclosure' | 'remove_with_reason' | 'mark_reviewed'> = [];

  // --- Disclosure Check ---
  if (policy.disclosureRequirement === 'required_ai_assisted_and_generated') {
    if (disclosureStatus === 'unknown') {
      signals.missingDisclosure = true;
      reasons.push('Disclosure required for all AI-assisted and AI-generated content');
      suggestedActions.push('ask_disclosure');
    }
  } else if (policy.disclosureRequirement === 'required_ai_generated') {
    if (disclosureStatus === 'unknown' && hasSelfDisclosureTerms(title, body)) {
      // Has AI terms but no disclosure → ask for disclosure
      signals.missingDisclosure = true;
      reasons.push('AI-related terms found but disclosure is missing');
      suggestedActions.push('ask_disclosure');
    }
  }

  // --- Policy Action Mapping ---
  // aiGeneratedAction
  if (disclosureStatus === 'ai_generated') {
    if (policy.aiGeneratedAction === 'remove') {
      reasons.push('AI-generated content is not allowed under current policy');
      suggestedActions.push('remove_with_reason');
    } else if (policy.aiGeneratedAction === 'queue') {
      reasons.push('AI-generated content requires moderator review');
      suggestedActions.push('mark_reviewed');
    } else if (policy.aiGeneratedAction === 'label') {
      reasons.push('AI-generated content requires transparency label');
      suggestedActions.push('apply_label');
    }
    // 'allow' → no action needed
  }

  // aiAssistedAction
  if (disclosureStatus === 'ai_assisted') {
    if (policy.aiAssistedAction === 'remove') {
      reasons.push('AI-assisted content is not allowed under current policy');
      suggestedActions.push('remove_with_reason');
    } else if (policy.aiAssistedAction === 'queue') {
      reasons.push('AI-assisted content requires moderator review');
      suggestedActions.push('mark_reviewed');
    } else if (policy.aiAssistedAction === 'label') {
      reasons.push('AI-assisted content requires transparency label');
      suggestedActions.push('apply_label');
    }
  }

  // unknownAction
  if (disclosureStatus === 'unknown') {
    if (policy.unknownAction === 'remove') {
      reasons.push('Unknown disclosure status not allowed under current policy');
      suggestedActions.push('remove_with_reason');
    } else if (policy.unknownAction === 'queue') {
      reasons.push('Unknown disclosure status requires moderator review');
      suggestedActions.push('mark_reviewed');
    } else if (policy.unknownAction === 'ask_disclosure') {
      reasons.push('Community policy encourages disclosure');
      suggestedActions.push('ask_disclosure');
    }
    // 'allow' → no action needed
  }

  // --- Similarity Check ---
  if (policy.similarityAction !== 'off') {
    const { similar, similarCount } = checkSimilarity(title, body, recentSnippets);
    if (similar) {
      signals.similarToRecentPosts = true;
      reasons.push(`Similar structure to ${similarCount} recent post(s)`);
      if (!suggestedActions.includes('mark_reviewed')) {
        suggestedActions.push('mark_reviewed');
      }
    }
  }

  // --- Low Context Check ---
  if (policy.lowContextAction !== 'off') {
    if (checkLowContext(title, body)) {
      signals.lowEffort = true;
      reasons.push('Low-context post (short or generic)');
      if (!suggestedActions.includes('mark_reviewed')) {
        suggestedActions.push('mark_reviewed');
      }
    }
  }

  // Determine policy status
  let policyStatus: 'compliant' | 'needs_label' | 'needs_disclosure' | 'needs_review' | 'removal_candidate';

  if (suggestedActions.includes('remove_with_reason')) {
    policyStatus = 'removal_candidate';
  } else if (suggestedActions.includes('ask_disclosure')) {
    policyStatus = 'needs_disclosure';
  } else if (suggestedActions.includes('apply_label')) {
    policyStatus = 'needs_label';
  } else if (suggestedActions.includes('mark_reviewed')) {
    policyStatus = 'needs_review';
  } else {
    policyStatus = 'compliant';
  }

  // Default action if nothing triggered
  if (suggestedActions.length === 0) {
    suggestedActions.push('approve');
  }

  // Deduplicate suggested actions
  const uniqueActions = [...new Set(suggestedActions)];

  return { signals, policyStatus, reasons, suggestedActions: uniqueActions };
}

/**
 * Generate disclosure request comment text
 */
export function generateDisclosureRequest(policy: SubredditPolicy): string {
  const tone = policy.tone || 'neutral';

  const templates: Record<string, string> = {
    friendly: `Hi! This community asks contributors to disclose when a post is AI-generated or substantially AI-assisted.\n\nPlease reply with whether this post is:\n- human-written\n- AI-assisted\n- AI-generated\n\nThis helps keep the community transparent while still allowing useful contributions. Thank you!`,
    neutral: `This community requires disclosure for AI-generated or substantially AI-assisted content.\n\nPlease clarify whether this post is:\n- human-written\n- AI-assisted\n- AI-generated`,
    formal: `In accordance with this community's AI content policy, please disclose whether this post was created with AI assistance.\n\nOptions:\n- human-written\n- AI-assisted\n- AI-generated\n\nFailure to disclose may result in removal under community rules.`,
    strict: `This community requires disclosure for all AI-generated and AI-assisted content.\n\nState clearly:\n- human-written\n- AI-assisted\n- AI-generated\n\nPosts without disclosure will be removed.`,
  };

  return templates[tone] || templates.neutral;
}

/**
 * Generate removal reason text
 */
export function generateRemovalReason(policy: SubredditPolicy, reason: string): string {
  const tone = policy.tone || 'neutral';

  const baseReasons: Record<string, Record<string, string>> = {
    friendly: {
      default: `Your post was removed because it doesn't match this community's AI content policy.\n\nYou're welcome to resubmit with an appropriate disclosure if the post follows the community rules.`,
      missing_disclosure: `Your post was removed because this community asks contributors to disclose AI-generated or AI-assisted content.\n\nYou're welcome to resubmit with a disclosure label (human-written, AI-assisted, or AI-generated).`,
      ai_not_allowed: `This community doesn't allow AI-generated content. Human-written and AI-assisted posts are welcome with proper disclosure.`,
    },
    neutral: {
      default: `Your post was removed because this community requires disclosure for AI-generated or substantially AI-assisted content.\n\nYou are welcome to resubmit with an appropriate disclosure label if the post follows the community rules.`,
      missing_disclosure: `Your post was removed because disclosure is required for AI-generated or substantially AI-assisted content in this community.\n\nPlease resubmit with a disclosure label.`,
      ai_not_allowed: `AI-generated content is not permitted in this community.`,
    },
    formal: {
      default: `This post has been removed for non-compliance with the community AI content policy. Resubmission with proper disclosure is permitted.`,
      missing_disclosure: `This post was removed due to missing AI content disclosure, which is mandatory in this community.`,
      ai_not_allowed: `AI-generated content violates this community's policy.`,
    },
    strict: {
      default: `Removed: Does not comply with AI content policy.`,
      missing_disclosure: `Removed: Missing required AI content disclosure.`,
      ai_not_allowed: `Removed: AI-generated content is not allowed.`,
    },
  };

  const toneMap = baseReasons[tone] || baseReasons.neutral;

  if (reason.includes('disclosure')) return toneMap.missing_disclosure;
  if (reason.includes('not allowed') || reason.includes('not permitted')) return toneMap.ai_not_allowed;
  return toneMap.default;
}

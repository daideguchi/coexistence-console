// Coexistence Console — Core Types

export type DisclosureRequirement = 'optional' | 'recommended' | 'required_ai_generated' | 'required_ai_assisted_and_generated';
export type EnforcementAction = 'allow' | 'label' | 'queue' | 'remove';
export type UnknownAction = 'allow' | 'queue' | 'ask_disclosure' | 'remove';
export type SimilarityAction = 'off' | 'queue';
export type LowContextAction = 'off' | 'queue';
export type Tone = 'friendly' | 'neutral' | 'formal' | 'strict';

export type SubredditPolicy = {
  subredditId: string;
  // New fields
  disclosureRequirement: DisclosureRequirement;
  aiGeneratedAction: EnforcementAction;
  aiAssistedAction: EnforcementAction;
  unknownAction: UnknownAction;
  similarityAction: SimilarityAction;
  lowContextAction: LowContextAction;
  tone: Tone;
  generatedPolicyText?: string;
  generatedWorkflowText?: string;
  generatedReviewChecklist?: string;
  disclosureRequestTemplate: string;
  removalReasonTemplate: string;
  sidebarText?: string;
  // Legacy fields (for backward compatibility)
  disclosureMode?: 'required' | 'recommended' | 'off';
  aiGeneratedPolicy?: 'allow' | 'review' | 'remove';
  aiAssistedPolicy?: 'allow' | 'review' | 'remove';
  unknownPolicy?: 'allow' | 'review' | 'remove';
  similarityPolicy?: 'off' | 'review' | 'remove';
  lowEffortPolicy?: 'off' | 'review';
  defaultActionMode?: 'label_only' | 'queue' | 'remove';
  trustedUserBypass?: boolean;
  newUserSensitivity?: 'low' | 'medium' | 'high';
  publicTransparencyComment?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DisclosureStatus = 'human' | 'ai_assisted' | 'ai_generated' | 'unknown';
export type ReviewStatus = 'queued' | 'approved' | 'labeled' | 'removed' | 'asked_disclosure' | 'reviewed' | 'ignored';

export type ReviewSignals = {
  missingDisclosure: boolean;
  similarToRecentPosts: boolean;
  repetitivePattern: boolean;
  lowEffort: boolean;
  newAccount?: boolean;
};

export type PolicyStatus = 'compliant' | 'needs_label' | 'needs_disclosure' | 'needs_review' | 'removal_candidate';
export type SuggestedAction = 'approve' | 'apply_label' | 'ask_disclosure' | 'remove_with_reason' | 'mark_reviewed';

export type ReviewItem = {
  id: string;
  subredditId: string;
  postId: string;
  authorIdHash?: string;
  title: string;
  bodyPreview: string;
  createdAt: number;
  disclosureStatus: DisclosureStatus;
  status: ReviewStatus;
  policyStatus: PolicyStatus;
  signals: ReviewSignals;
  reasons: string[];
  suggestedActions: SuggestedAction[];
  modDecision?: {
    action: string;
    modUsername: string;
    decidedAt: number;
    note?: string;
  };
};

export type Metrics = {
  subredditId: string;
  weekStart: number;
  postsScanned: number;
  itemsQueued: number;
  labelsApplied: number;
  disclosureRequestsSent: number;
  approvalsPerformed: number;
  reviewedPosts: number;
  removalsPerformed: number;
  // Estimated time saved: calculated from actual mod actions.
  // Formula: one-click moderator actions x 30 seconds.
  estimatedSecondsSaved: number;
  estimatedMinutesSaved: number;
};

export type ModerationActionType =
  | 'scanned'
  | 'queued'
  | 'approved'
  | 'labeled'
  | 'asked_disclosure'
  | 'reviewed'
  | 'removed';

export type ActionLogEntry = {
  id: string;
  subredditId: string;
  postId: string;
  postTitle: string;
  type: ModerationActionType;
  reason?: string;
  modUsername?: string;
  policyStatus?: PolicyStatus;
  disclosureStatus?: DisclosureStatus;
  createdAt: number;
  estimatedSecondsSaved: number;
};

export type PresetName = 'gentle' | 'balanced' | 'strict';

export const PRESETS: Record<PresetName, Partial<SubredditPolicy>> = {
  gentle: {
    // New fields
    disclosureRequirement: 'optional',
    aiGeneratedAction: 'allow',
    aiAssistedAction: 'allow',
    unknownAction: 'allow',
    similarityAction: 'off',
    lowContextAction: 'off',
    tone: 'friendly',
    // Legacy fields
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
  },
  balanced: {
    // New fields
    disclosureRequirement: 'recommended',
    aiGeneratedAction: 'queue',
    aiAssistedAction: 'label',
    unknownAction: 'ask_disclosure',
    similarityAction: 'queue',
    lowContextAction: 'queue',
    tone: 'neutral',
    // Legacy fields
    disclosureMode: 'required',
    aiGeneratedPolicy: 'review',
    aiAssistedPolicy: 'allow',
    unknownPolicy: 'review',
    similarityPolicy: 'review',
    lowEffortPolicy: 'review',
    defaultActionMode: 'queue',
    trustedUserBypass: false,
    newUserSensitivity: 'medium',
    publicTransparencyComment: true,
  },
  strict: {
    // New fields
    disclosureRequirement: 'required_ai_assisted_and_generated',
    aiGeneratedAction: 'remove',
    aiAssistedAction: 'label',
    unknownAction: 'ask_disclosure',
    similarityAction: 'queue',
    lowContextAction: 'queue',
    tone: 'strict',
    // Legacy fields
    disclosureMode: 'required',
    aiGeneratedPolicy: 'review',
    aiAssistedPolicy: 'review',
    unknownPolicy: 'review',
    similarityPolicy: 'review',
    lowEffortPolicy: 'review',
    defaultActionMode: 'queue',
    trustedUserBypass: false,
    newUserSensitivity: 'high',
    publicTransparencyComment: true,
  },
};

export type DailyMetrics = {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
};

export type RecentAction = {
  id: string;
  type: ModerationActionType;
  description: string;
  postTitle: string;
  postId?: string;
  modUsername?: string;
  timestamp: number;
};

export type TrendIndicator = {
  value: number;
  direction: 'up' | 'down' | 'flat';
  label: string;
};

export type ModNote = {
  id: string;
  modUsername: string;
  text: string;
  createdAt: number;
};

export type FilterState = {
  statusFilter: ReviewStatus | 'all';
  minPriority: number;
  maxPriority: number;
  disclosureFilter: DisclosureStatus | 'all';
};

export const DISCLOSURE_LABELS = {
  human: 'Human-written',
  ai_assisted: 'AI-assisted',
  ai_generated: 'AI-generated',
  unknown: 'Unknown / Not disclosed',
  mod_reviewed: 'Mod-reviewed',
} as const;

export const ACTION_ICONS: Record<RecentAction['type'], string> = {
  scanned: '🔍',
  queued: '⚠️',
  approved: '✅',
  labeled: '🏷️',
  reviewed: '☑️',
  removed: '🗑️',
  asked_disclosure: '💬',
};

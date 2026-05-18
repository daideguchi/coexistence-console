# Devvit Rules Compliance Checklist

## Data & Privacy

- [x] **Data Minimization**: Only postId, subredditId, title/body preview, signal flags, mod actions, ActionLog rows, timestamps, and minimal fallback metrics are stored.
- [x] **No Profiling**: The app does not infer political, religious, health, or other sensitive personal characteristics.
- [x] **No Surveillance**: The app does not build long-term user dossiers or track users across subreddits.
- [x] **No ML Training**: Reddit data is not used to train external models.
- [x] **Deletion Handling**: PostDelete and CommentDelete triggers remove related stored data.
- [x] **TTL**: Review, recent-snippet, ActionLog, activity, and fallback metrics keys use `expire()` for automatic cleanup.

## Behavior & Safety

- [x] **No Vote/Karma Manipulation**: The app does not upvote, downvote, or manipulate karma.
- [x] **No Ban Automation**: The app does not automatically ban users.
- [x] **No Spam**: The app does not mass-post content or create spam.
- [x] **No Block Evasion**: The app does not help users bypass blocks or bans.
- [x] **No Automated Punishment by Default**: Default action mode is "label_only" or "queue". Auto-remove is opt-in only.
- [x] **Transparent Naming**: App name is "Coexistence Console" with clear description.

## AI & Content Signals

- [x] **No AI Accusations**: Language uses "signal," "possible," "needs review" — never "detected as AI" or "fake user."
- [x] **Moderator-First**: All signals are review aids. Final decisions are left to moderators.
- [x] **No External LLM for Signals**: All moderation signals are computed locally with rule-based heuristics.
- [x] **Optional LLM Is Moderator-Assist Only**: The verified Devvit runtime path uses Gemini only for moderator-facing policy draft support and aggregate Community Pulse summaries when the app has a key. OpenAI remains a Devvit-compliant fallback domain if configured. Cloudflare and Fireworks are local/direct research paths only unless Reddit approves those domains; no external LLM is used for review signals or enforcement.
- [x] **Fetch Policy Boundary Recorded**: Reddit's current HTTP Fetch Policy allows only `api.openai.com` and `generativelanguage.googleapis.com` as AI provider domains. The app does not depend on Fireworks for live Devvit runtime behavior.

## App Store Requirements

- [x] **App Listing**: README.md and submission materials prepared.
- [x] **Moderator Instructions**: Tool Overview explains safe and responsible usage.
- [x] **Privacy Policy**: Covered in privacy-and-safety.md.

## Review for Submission

| Check | Status |
|-------|--------|
| Devvit Rules read and understood | ✅ |
| No disallowed functionality | ✅ |
| Deletion event handling implemented | ✅ |
| Data TTL set | ✅ |
| Clear app name and description | ✅ |
| Moderator-facing documentation | ✅ |
| Root README for app review | ✅ |

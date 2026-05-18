# Coexistence Console

> Governance rails for today's human moderators, and tomorrow's AI moderators too.

Coexistence Console is a Devvit moderation app for communities where human-written, AI-assisted, AI-generated, and unknown-disclosure participation coexist.

It is built for the Reddit Mod Tools and Migrated Apps Hackathon, Best New Mod Tool category.

日本語で読む: [README.ja.md](README.ja.md)

## Quick Review

Start here if you are judging or manually testing the project.

- Public review repository: https://github.com/daideguchi/coexistence-console-submission
- Demo video: [media/demo-video-v050-overview.mp4](media/demo-video-v050-overview.mp4)
- Japanese Dashboard screenshot: [media/fresh-v047-ja-dashboard.png](media/fresh-v047-ja-dashboard.png)
- Policy Editor Workflow Board: [media/fresh-v047-ja-policy.png](media/fresh-v047-ja-policy.png)
- Live Gemini policy drafts: [media/fresh-v028-live-ai-policy-drafts.png](media/fresh-v028-live-ai-policy-drafts.png)
- Submission prep checklist: [SUBMISSION_PREP.md](SUBMISSION_PREP.md)

Core verification commands:

```bash
npm install
npm run build
npx devvit view
npm run dashboard:verify
npm run queue:verify
npm run japanese:verify
node ops/verify-ai-live.mjs
```

## One-Sentence Pitch

AI moderation is not just a detection problem. It is a governance problem.

Coexistence Console helps subreddit moderators turn AI-content uncertainty into clear community policy, explainable review workflows, transparent moderator actions, and ActionLog-based analytics while keeping humans in control.

## Why This Exists

Reddit is valuable because humans can talk freely, argue, ask for help, share expertise, and build community culture. AI is now entering that same space. Some users will disclose AI assistance, some will not, and many posts will be ambiguous.

The moderator problem is not "prove whether this was written by AI." That is brittle and unfair. The real problem is:

- What does this community allow?
- When should AI use be disclosed?
- Which posts need labels, review, or removal?
- How do moderators explain decisions consistently?
- How do communities preserve useful AI-assisted contributions without letting low-context generated content degrade trust?

Coexistence Console treats AI participation as a visibility and governance challenge, not an accusation workflow.

## What It Is Not

Coexistence Console is not an AI detector.

It does not display "AI detected," "confirmed AI," "fake human," "bot detected," or "ban recommended." The app intentionally uses explainable moderation language such as:

- missing disclosure
- needs label
- policy mismatch
- self-disclosed AI-assisted
- self-disclosed AI-generated
- low-context post
- similar to recent posts
- needs moderator review
- unknown disclosure

Unknown disclosure is visibility for moderator review, not proof of deception.

## Product Workflow

1. Policy Editor
   Moderators choose AI-friendly, Balanced, Strict, or Custom governance. They can also match the workflow to community types such as advice/support, technical, creative, education, marketplace, and general discussion.

2. AI Policy Copilot
   Optional Gemini-backed drafting helps moderators write policy text, disclosure rules, removal reasons, sidebar/wiki copy, review checklists, and recommended workflow settings. Generated text is a draft only. A moderator must review and save it.

3. Rule-Based Review Queue
   Real subreddit posts are scanned with deterministic rules. Queue reasons are explainable policy signals, not AI certainty scores.

4. Moderator Actions
   Moderators can approve, apply label, ask disclosure, mark reviewed, or remove with reason. Actions target real `postId` values and are written to the canonical ActionLog.

5. Analytics
   Dashboard and Analytics views are derived from ActionLog and Redis state. Counts are not mock data. The app shows scanned posts, queue items, labels applied, disclosure requests sent, removals, approvals, reviewed posts, and estimated time saved.

6. Multilingual Moderation
   The moderator UI supports Auto, English, Japanese, Spanish, and French. Queue workbench translation helps a moderator understand post content across languages.

7. Community Pulse
   Aggregate moderation signals are summarized into mood, review pressure, disclosure clarity, and a suggested next move. AI is used here for moderator-facing summary text, not post scoring.

## Live Devvit App

- App name: `super-consolex`
- Devvit app page: https://developers.reddit.com/apps/super-consolex
- Playtest subreddit: `r/super_consolex_dev`
- Public review repository: https://github.com/daideguchi/coexistence-console-submission
- Latest uploaded version verified with `npx devvit view`: `0.0.50`
- Uploaded: May 18, 2026, 5:47:22 PM

### Playtest Views

- Dashboard: https://www.reddit.com/r/super_consolex_dev/comments/1td71v6/coexistence_console_dashboard/?playtest=super-consolex
- Policy Editor: https://www.reddit.com/r/super_consolex_dev/comments/1td74wd/coexistence_policy_editor/?playtest=super-consolex
- Review Queue: https://www.reddit.com/r/super_consolex_dev/comments/1tgd2w7/coexistence_review_queue/?playtest=super-consolex
- Analytics: https://www.reddit.com/r/super_consolex_dev/comments/1td754t/community_analytics_dashboard/?playtest=super-consolex

If a playtest URL requires a fresh session, install/playtest the app and use the subreddit mod menu to create the Dashboard, Review Queue, Policy Editor, and Analytics custom posts.

If a Reddit playtest URL returns `403`, it usually means the browser is not logged into an account with playtest access or the playtest session is not active. For public review, use the demo video and screenshots in this repository; for live testing, run `npx devvit playtest super_consolex_dev`.

## Language Support

Coexistence Console supports multilingual moderator workflows.

- In-app UI languages: Auto, English, Japanese, Spanish, French.
- Install setting: `ui_language`.
- In-console language switcher: the live UI includes language buttons such as `EN` and `日本語`.
- Verified command: `npm run japanese:verify`.
- For people reading the repository, Japanese documentation is available at [README.ja.md](README.ja.md).

Fallback: if a viewer cannot access the app language setting, browser translation still works for the README and Devpost page.

## Award-Grade UX Pass

Version `0.0.50` rebuilt the experience around moderator clarity.

- Layered visual system: `surfaceMuted` page background, `surface` cards, thin borders, softer brand/success tones.
- Dashboard Next-Step Hero: the first screen tells the moderator what to do now, such as "1 post is waiting for review" or "All clear."
- Policy Editor Workflow Board: a 3-step flow replaces the old chip grid.
  - Pick a starting mode.
  - Match your community.
  - Tune workflow rules in a board with labeled rows.
- Locator strip on every view: Mod Tools / Coexistence Console / Review Queue / Policy Editor / Community Analytics.
- Consistent card hierarchy across Dashboard, Queue, Policy, and Analytics.
- EN / JA / ES / FR i18n strings for the redesigned workflow.

## Screenshots For Submission

Use these current proof files from `media/`:

- `media/fresh-v044-dashboard.png` - English Dashboard with Next-Step Hero, KPI row, Queue Workbench, and locator.
- `media/fresh-v044-dashboard-translation.png` - Translate Preview from the Dashboard workbench.
- `media/fresh-v044-queue-page.png` - English Review Queue with locator, count badge, and action row.
- `media/fresh-v047-ja-dashboard.png` - Japanese Dashboard with the review-waiting hero.
- `media/fresh-v047-ja-policy.png` - Japanese Policy Editor with the 3-step Workflow Board.
- `media/fresh-v047-ja-queue.png` - Japanese Review Queue.
- `media/fresh-v047-ja-analytics.png` - Japanese Analytics.
- `media/fresh-v028-live-ai-policy-drafts.png` - Real Gemini-backed policy draft generation.
- `media/fresh-v028-live-ai-pulse.png` - Real Gemini-backed AI Pulse summary.

### Demo Gallery

Latest overview video:

[media/demo-video-v050-overview.mp4](media/demo-video-v050-overview.mp4)

Japanese Dashboard:

![Japanese Dashboard](media/fresh-v047-ja-dashboard.png)

Policy Editor Workflow Board:

![Japanese Policy Editor](media/fresh-v047-ja-policy.png)

Review Queue:

![Review Queue](media/fresh-v044-queue-page.png)

Live Gemini Policy Drafts:

![Live AI Policy Drafts](media/fresh-v028-live-ai-policy-drafts.png)

Analytics:

![Japanese Analytics](media/fresh-v047-ja-analytics.png)

## AI Usage Boundary

The app uses AI only where it is useful and safe for moderators:

- Policy draft support
- Disclosure request copy
- Removal reason copy
- Sidebar/wiki explanation copy
- Moderator checklist and workflow suggestions
- Aggregate Community Pulse narration
- Moderator-facing translation preview

The app does not use an LLM to classify posts, accuse users, score users, enforce rules, or decide removals.

### Runtime AI Providers

- Verified Devvit runtime provider: Google Gemini through `generativelanguage.googleapis.com`.
- Optional Devvit-compliant fallback domain: `api.openai.com`, only if an app-level OpenAI key is configured.
- Cloudflare Workers AI support exists in code for direct/local testing, but `api.cloudflare.com` is not enabled in `devvit.json` because Reddit's current Devvit HTTP fetch allowlist for AI providers is Google Gemini and OpenAI.
- Fireworks is local smoke-test only via `npm run fireworks:smoke`; it is not wired into the live Devvit runtime.

### App Settings

Installation-level settings:

- `ui_language`: `auto`, `en`, `ja`, `es`, `fr`
- `preset`: `gentle`, `balanced`, `strict`
- `disclosure_mode`: `required`, `recommended`, `off`

App-level AI settings:

- `ai_provider`: default `gemini`
- `gemini_api_key`
- `gemini_model`: default `gemini-3.1-flash-lite`; smart option in code is `gemini-3.1-pro-preview` if quota allows
- `openai_api_key`
- `openai_model`: default `gpt-4.1-mini`
- `cloudflare_account_id`
- `cloudflare_api_token`
- `cloudflare_model`: default `@cf/moonshotai/kimi-k2.6`

Do not commit provider keys. Secrets belong in Devvit app settings or ignored local env files.

## Data Model And ActionLog

ActionLog is the source of truth for moderation analytics.

Each row can include:

- `postId`
- post title/preview
- action type
- moderator username when available
- policy status
- disclosure status
- explainable reason
- timestamp
- estimated seconds saved

Logged event types include:

- scanned
- queued
- approved
- labeled
- disclosure-requested
- reviewed
- removed

Estimated time saved is deterministic:

```text
estimated time saved = one-click moderator actions x 30 seconds
```

Scanning and queue creation are logged for transparency but do not add saved time. One-click moderator actions are approve, apply label, ask disclosure, mark reviewed, and remove with reason.

## Privacy And Safety

- Stores only post IDs, post previews, policy signals, moderator actions, timestamps, hashed author IDs, aggregate metrics, and optional moderator-reviewed policy drafts.
- Uses Redis TTLs and delete triggers for cleanup.
- Does not build user profiles.
- Does not track users across subreddits.
- Does not infer sensitive personal attributes.
- Does not train models on Reddit data.
- Does not sell or share Reddit data.
- Does not use post content for LLM classification or scoring.

See:

- `docs/privacy-and-safety.md`
- `docs/devvit-compliance.md`
- `docs/product-narrative-ai-coexistence.md`

## Repository Map

- `src/main.tsx` - Devvit entry point, settings, custom post routing, dashboard, queue, policy editor, analytics, triggers, moderator actions, Redis writes.
- `src/policy.ts` - policy persistence under subreddit scope.
- `src/signals.ts` - deterministic review signal evaluation.
- `src/copilot.ts` - Gemini/OpenAI/Cloudflare AI provider clients for moderator-assist drafting and summaries.
- `src/i18n.ts` - EN/JA/ES/FR localization strings.
- `src/types.ts` - shared policy, queue, action, and analytics types.
- `ops/verify-dashboard-live.mjs` - live Dashboard verifier.
- `ops/verify-queue-live.mjs` - live Review Queue verifier.
- `ops/verify-japanese-live.mjs` - EN/JA/ES/FR verifier.
- `ops/verify-ai-live.mjs` - live Gemini AI verifier for Test AI, Generate Drafts, and AI Pulse.
- `ops/verify-fireworks-local.mjs` - local Fireworks smoke test only.
- `00_HANDOFF.md` - running implementation and verification history.

## Install And Test

```bash
npm install
npm run build
npx devvit upload
npx devvit playtest super_consolex_dev
npm run dashboard:verify
npm run queue:verify
npm run japanese:verify
node ops/verify-ai-live.mjs
```

Use the subreddit mod menu to create the Dashboard, Review Queue, Policy Editor, and Analytics views.

For local smoke testing only:

```bash
npm run fireworks:smoke
```

Fireworks is not used as the live Devvit AI provider.

## Latest Verification

Current README-pass verification:

```bash
npm run build                                  # passed
npx devvit view                                # super-consolex v0.0.50, uploaded 2026-05-18 17:47:22
npm run dashboard:verify                       # passed; tagline, Queue Workbench, Translate Preview, translation success
npm run queue:verify                           # passed; real Review Queue post and controls
npm run japanese:verify                        # passed; Dashboard / Queue / Policy / Analytics all Japanese
node ops/verify-ai-live.mjs                    # passed (Test AI / Generate Drafts / AI Pulse)
```

Current live app metadata verified with `npx devvit view`:

```text
App name: super-consolex
Owner: u/MaleficentPay8678
Version: 0.0.50
Uploaded: 5/18/2026, 5:47:22 PM
```

## Demo Story

Recommended 60-second demo:

1. Open the Japanese Dashboard. The hero immediately shows whether a post is waiting for review, while KPIs and Coexistence Visibility show that this is about governance, not detection.
2. Use Queue Workbench to ask for disclosure, label, or preview translation. This demonstrates real moderator action and real ActionLog writes.
3. Open Review Queue. Show explainable reasons such as missing disclosure or low context, and avoid any claim of AI certainty.
4. Open Policy Editor. Switch policy mode, choose a community type, tune Workflow Board rules, and run Generate Drafts.
5. Open Analytics. Show that approvals, labels, disclosure requests, removals, reviewed posts, and estimated time saved come from ActionLog.

## Submission Language

Short Devpost version:

> Coexistence Console gives today's human moderators, and tomorrow's AI-assisted moderators, the policy, disclosure, review, and audit rails needed to govern AI-era communities without pretending to perfectly detect AI.

Longer version:

> Coexistence Console is an AI-assisted governance layer for Reddit moderators. As AI-assisted and AI-generated content becomes normal, moderators need more than unreliable AI detection. They need clear community policies, disclosure norms, explainable review workflows, consistent moderator actions, and analytics that show how moderation work is being handled. Coexistence Console uses AI where it is safest and most useful: helping moderators draft AI-content policies, disclosure rules, removal reasons, and user-facing explanations. Enforcement remains deterministic, transparent, and moderator-controlled.

# Submission Prep - Coexistence Console

Status: final QA release candidate. Devpost submission is the final human action.

## Current State

- App: `super-consolex`
- Playtest subreddit: `r/super_consolex_dev`
- Verified uploaded app version: `0.0.54`
- Private GitHub repo: `https://github.com/daideguchi/coexistence-console-private`
- Public review repo: `https://github.com/daideguchi/coexistence-console`
- Latest private preparation commit: see `git log -1 --oneline` in this repo.
- README is the judge-facing product source of truth.
- Japanese README is available at `README.ja.md`.
- Current demo video is `media/demo-video-v050-overview.mp4`.
- `00_HANDOFF.md` is the internal engineering history and may contain private operational context. Do not publish it publicly without review.

## Verified Commands

```bash
npm run build
npx devvit view
npm run dashboard:verify
npm run queue:verify
npm run japanese:verify
node ops/verify-ai-live.mjs
```

Latest verification result: all passed on 2026-05-19 JST.

## Submission Assets

Use the following files first:

- `media/fresh-v044-dashboard.png`
- `media/fresh-v044-dashboard-translation.png`
- `media/fresh-v044-queue-page.png`
- `media/fresh-v047-ja-dashboard.png`
- `media/fresh-v047-ja-policy.png`
- `media/fresh-v047-ja-queue.png`
- `media/fresh-v047-ja-analytics.png`
- `media/fresh-v050-live-ai-triage.png`
- `media/fresh-v028-live-ai-policy-drafts.png`
- `media/fresh-v028-live-ai-pulse.png`
- `media/demo-preview-v050.gif`
- `media/demo-video-v050-overview.mp4`

## Human QA Before Devpost Submit

- Open all four playtest URLs from `README.md`.
- If a Reddit URL returns `403`, confirm the browser is logged into the Reddit account with playtest access and that `npx devvit playtest super_consolex_dev` is running.
- Verify Japanese Dashboard / Policy Editor readability.
- Click at least one queue action and confirm Analytics changes.
- Run AI Policy Copilot `Test AI`, `Generate Drafts`, Review Queue `Suggest label`, and Analytics `AI Pulse`.
- Confirm no app copy says "AI detected", "confirmed AI", "bot detected", or "ban recommended".
- Confirm the demo story says governance / coexistence visibility, not AI detection.

## Public Release Checklist

Before making the GitHub repository public or attaching it to Devpost:

- Review `00_HANDOFF.md` for private billing/account/support details.
- Keep `.env`, `.fireworks.active.local.env`, service-account JSON files, and local billing notes out of Git.
- Do not publish `docs/gemini-credit-check-*`, `docs/google-cloud-credit-appeal-*`, or local Google credit-route scripts.
- Confirm screenshots do not expose private keys, billing screens, or unrelated accounts.
- Re-run the verification commands after any final UI changes.

## Human Submit Boundary

- Do not buy AI credits, enable auto reload, or change billing settings from this repo flow.
- Devpost final submit should be done only after DD reviews the public repo, screenshots, and demo video.

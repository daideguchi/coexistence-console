# Coexistence Console — Development Roadmap

**Project**: Reddit Mod Tools Hackathon 2026  
**App**: super-consolex  
**Philosophy**: Moderator-first. No shortcuts. Production-quality UI.

---

## Milestones

### M0: Foundation ✅ DONE
- [x] Project scaffold (TypeScript, Devvit CLI)
- [x] Core types & policy engine
- [x] Signal detection (text analysis, n-grams, templates)
- [x] Basic triggers: PostSubmit, PostDelete, CommentDelete
- [x] Upload to Devvit App Directory
- [x] Playtest subreddit created

### M1: Dashboard Renaissance 🔄 IN PROGRESS
**Goal**: A dashboard that moderators actually want to check daily

- [ ] **Stats Cards**: Posts scanned, Queue size, Labels applied, Time saved — with trend indicators (↑↓)
- [ ] **Weekly Chart**: Bar chart showing daily post volume + AI-flagged ratio
- [ ] **Top Authors Table**: Most frequent submitters, their disclosure rate, action history
- [ ] **Recent Activity Feed**: Last 10 actions with timestamps, mod names
- [ ] **Quick Actions**: "Clear Queue", "Export Metrics", "Adjust Policy" buttons
- [ ] **Visual Polish**: Icons (using Devvit text icons), color-coded severity badges, proper spacing

### M2: Review Queue Power-Up
**Goal**: A moderation queue that feels like a professional ticketing system

- [ ] **Item Cards**: Expandable cards with full post preview, signal breakdown bars, action history
- [ ] **Filtering**: By status (queued/approved/removed/labeled), by score range, by disclosure status
- [ ] **Sorting**: By score (default), by date, by author
- [ ] **Bulk Actions**: Select multiple → Approve All / Label All / Remove All
- [ ] **Inline Preview**: Show post body inline without clicking through to Reddit
- [ ] **Mod Notes**: Add per-item moderator notes (stored in Redis)
- [ ] **Keyboard Shortcuts**: A=Approve, L=Label, R=Remove, N=Next item
- [ ] **Severity Colors**: Score <30 = green, 30-60 = yellow, 60-80 = orange, 80+ = red

### M3: Policy Editor
**Goal**: Let moderators build their own AI governance policy without touching code

- [ ] **Visual Policy Builder**: Sliders for sensitivity thresholds
- [ ] **Rule Mapping**: Link subreddit rules to Coexistence actions
- [ ] **Custom Keywords**: Community-specific phrases to flag (e.g., local meme formats)
- [ ] **Auto-Action Configuration**: Per-severity action mapping
- [ ] **Disclosure Requirements**: Toggle required/recommended/off + custom message templates
- [ ] **Preset Comparison**: Side-by-side view of Gentle/Balanced/Strict presets
- [ ] **Policy History**: Save/load previous policy versions

### M4: User-Facing Disclosure Flow
**Goal**: Users disclose BEFORE posting, not after being caught

- [ ] **Pre-Submit Form**: Optional disclosure checkbox in post creation (when enabled)
- [ ] **Flair Integration**: Auto-apply disclosure flair to posts
- [ ] **Disclosure Reminder**: Auto-comment for posts missing disclosure (polite, educational)
- [ ] **User Dashboard**: Users can see their own disclosure history (hashed ID)
- [ ] **Grace Period**: "You have 24 hours to add a disclosure label" option

### M5: Analytics & Insights
**Goal**: Prove the tool saves time and improves community health

- [ ] **Time Saved Calculator**: Configurable minutes-per-action, weekly/monthly rollup
- [ ] **Community Health Score**: Composite score based on disclosure rate, mod action diversity
- [ ] **False Positive Tracking**: Mods can mark "this was actually human-written" → improve scoring
- [ ] **Export**: CSV export of all review items for external analysis
- [ ] **Comparative Metrics**: "Your community's disclosure rate vs. similar subreddits" (anonymized)

### M6: Polish & Production Hardening
**Goal**: Ready for real subreddits with 100k+ subscribers

- [ ] **Error Boundaries**: Every async call wrapped with user-friendly error states
- [ ] **Loading States**: Skeleton loaders for all data-dependent components
- [ ] **Empty States**: "Queue is empty — great job!" with celebration animation
- [ ] **Responsive**: Works on mobile mod tools (smaller layouts)
- [ ] **Accessibility**: Color contrast, text sizes, screen reader labels
- [ ] **Rate Limiting**: Respect Reddit API limits in all batch operations
- [ ] **Data Retention**: Auto-purge old review items (configurable, default 90 days)
- [ ] **Performance**: Paginate large queues, lazy-load dashboard data

---

## Current Focus: M1 Dashboard Renaissance

### Files to modify
- `src/main.tsx` — Custom Post: Dashboard (lines 290-359)
- `src/types.ts` — Add new metric types
- `src/signals.ts` — Add trend calculation helpers

### Design Principles
1. **Information density**: Moderators have limited time. Show the most important data first.
2. **Action-oriented**: Every metric should suggest an action.
3. **Trust-building**: Show "why" behind every number. Make the AI transparent.
4. **Delight**: Small animations, color-coded status, clear feedback.

---

## Implementation Order (Session by Session)

| Session | Milestone | Deliverable |
|---------|-----------|-------------|
| Current | M1 | Dashboard stats cards + weekly chart + recent feed |
| Next | M1 | Quick actions + visual polish (icons, colors, spacing) |
| Next | M2 | Item cards + filtering + sorting |
| Next | M2 | Bulk actions + inline preview + mod notes |
| Next | M3 | Policy editor UI (sliders, keywords, presets) |
| Next | M3 | Rule mapping + policy history |
| Next | M4 | Pre-submit disclosure form |
| Next | M4 | Flair integration + grace period |
| Next | M5 | Analytics + export |
| Next | M6 | Error boundaries + loading states + empty states |
| Final | M6 | Mobile responsive + final polish + Devpost submission |

---

## Success Criteria

A moderator using this tool should be able to:
1. **In 5 seconds**: Understand today's queue status from the dashboard
2. **In 30 seconds**: Review and action a flagged post
3. **In 2 minutes**: Customize their community's AI policy
4. **Never**: Feel confused about why a post was flagged
5. **Never**: Have to leave Reddit to configure the tool

---

**Updated**: 2026-05-12 08:01 JST  
**Next session starts**: M3 Policy Editor

## Completed Milestones

- ✅ M0 Foundation (2026-05-12 ~05:30)
- ✅ M1 Dashboard Renaissance (2026-05-12 ~07:30)  
  - Stat cards with trends, weekly chart, activity feed, quick actions
- ✅ M2 Review Queue Power-Up (2026-05-12 ~08:00)
  - Status filters, signal breakdown bars, mod notes, error boundaries
- ✅ **Devpost Submission** (2026-05-12 08:01 JST)
  - Project submitted with Tool Overview, Project Impact, Feedback Award
- ✅ M3 Policy Editor (2026-05-12 ~08:05)
  - Visual preset selector (Gentle/Balanced/Strict)
  - Disclosure mode toggle (Required/Recommended/Off)
  - Default action selector (Label Only/Review Queue/Auto Remove)
  - New account sensitivity (Low/Medium/High)
  - Trusted user bypass toggle
  - Save/Reset with Redis persistence
  - New Mod Tools menu: "Open Policy Editor"
- ✅ **i18n Framework + Localization** (2026-05-12 ~08:10)
  - `src/i18n.ts`: Translation engine with `detectLanguage()` and `t()`
  - Supported languages: English (default) + Japanese
  - All Dashboard, Queue, and Policy Editor text localized
  - Time formatting localized (just now / minutes ago / hours ago / days ago)
  - Severity labels, action buttons, policy presets all translated
- ✅ M4 User-Facing Disclosure Flow (2026-05-12 ~08:35)
  - `Devvit.createForm` AI Disclosure Form: Title, Body, Disclosure Level dropdown
  - Disclosure options: Human-written / AI-assisted / AI-generated
  - Auto-tags post title with [HUMAN] / [AI-ASSISTED] / [AI-GENERATED]
  - Stores disclosure metadata in Redis (`disclosure:{postId}`)
  - New Subreddit Menu: "Submit Post with AI Disclosure" (all users)
  - Auto-increments metrics on disclosure submission
- ✅ M5 Analytics Dashboard (2026-05-12 ~09:00)
  - Community Health Score (0-100): disclosure rate vs removal rate
  - Disclosure Rate with week-over-week trend indicator
  - Time Saved visualization (weekly cumulative)
  - Weekly Activity bar chart (last 7 days)
  - Action Distribution grid: Scanned / Labeled / Requests / Removed
  - New Mod Tools menu: "Open Community Analytics"
- ✅ M6 Production Hardening (2026-05-12 ~09:15)
  - Dashboard error boundaries: capture error from all 5 useAsync calls
  - Unified error state with fallback message
  - Empty chart state: "No data yet. Posts will appear after scanning."
  - Policy Editor error handling: load error + save error with localized messages
  - Policy Editor save try-catch with toast feedback
  - Queue Pagination: Load More button with pageSize state (10 → 20 → 30...)
  - All new UI text fully localized (English + Japanese)

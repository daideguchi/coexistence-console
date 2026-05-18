# Quick Start — 操作方法

## 1. アプリを開く

```bash
cd /Users/dd/000_AI組織/__hackason/coexistence-console
npx devvit playtest super_consolex_dev --since 1m
```

ブラウザが開いたら、**Mod Tools** ボタン（subredditの右上）をクリック。

## 2. 各機能の開き方

| 機能 | 開き方 |
|------|--------|
| **Dashboard** | subreddit右上の「…」→ "Open Coexistence Console" → 新規投稿が作成される → その投稿をクリック |
| **Review Queue** | subreddit右上の「…」→ "Open Coexistence Queue" → 新規投稿 → クリック |
| **Policy Editor** | subreddit右上の「…」→ "Open Policy Editor" → 新規投稿 → クリック |
| **Analytics** | subreddit右上の「…」→ "Open Community Analytics" → 新規投稿 → クリック |
| **Disclosure Form** | Subreddit メニュー（…）→ "Submit Post with AI Disclosure" |

## 3. テスト投稿を作る（データを入れる）

Dashboardが空っぽなら、まず投稿を作る：

1. 普通に新規投稿（「Create Post」）
2. タイトルに "AI" や "generated" を含める
3. 投稿後、subreddit右上の「…」→ "Open Coexistence Queue" で確認

## 4. 各画面でできること

### Dashboard
- Next-Step Hero（今見るべき状態）
- Queue / Scanned / Time Saved のKPI
- Queue Workbench、Coexistence Visibility、Community Pulse

### Review Queue
- 上部のボタンでフィルター（Queued / Approved / Labeled / Removed / All）
- リストの1件をクリック → 詳細と説明可能なreview reasonsを確認
- **Label** ボタン → 投稿へラベルを適用
- **Ask Disclosure** ボタン → 開示依頼
- **Remove** ボタン → 理由付きで削除
- **Approve / Mark Reviewed** ボタン → 承認または確認済みにする

### Policy Editor
- AI-friendly / Balanced / Strict のプリセットボタン
- Disclosure Requirement と content typeごとの action を変更
- AI Policy Copilot はGemini設定時に moderator-facing draft/summary を生成
- **Save Policy** で保存

### Analytics
- ActionLog由来の scanned / queued / labeled / requests / approved / reviewed / removed
- Estimated time saved（one-click actions × 30 seconds）
- Coexistence Visibility と Community Pulse
- AI Pulse は集計済みmoderation signalsだけを要約

### Disclosure Form
- タイトル、本文を入力
- AI開示レベルを選択（Human / AI-Assisted / AI-Generated）
- 投稿タイトルに自動で [HUMAN] / [AI-ASSISTED] / [AI-GENERATED] が付く

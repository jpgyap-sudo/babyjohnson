# CLAUDE.md — Baby Johnson Project

Global instructions and all accumulated patterns live in `~/.claude/CLAUDE.md`
and `~/.claude/guides/` — they are auto-loaded at every session start.
This file contains only project-specific overrides for Baby Johnson.

---

## This Project

**Baby Johnson** — AI-powered baby care tracker for a 2-year-old in the Philippines.
Caregivers log food, sleep, activities, vitamins via Telegram group chat.
Parents get daily reminders, weekly analysis, and AI-generated meal plans.

## Stack

| Layer | Tech |
|---|---|
| Hosting | Vercel (Hobby — daily crons only) |
| DB | Supabase (PostgreSQL) |
| AI | Claude Sonnet (`claude-sonnet-4-6`) |
| Bot | Telegram Bot API |
| Timezone | PHT (UTC+8) — all cron times converted from UTC |
| Runtime | Node.js ESM → compiled to CJS by Vercel |

## MCP Connections (configured in `.mcp.json`)

- `supabase` — full DB access via `mcp__supabase__*`
- `vercel` — deploy + logs via `mcp__vercel__*`

## Key Files

```
api/telegram.js         Main bot — dashboard, commands, conversation state
api/reminders.js        Per-minute via cron-job.org (NOT vercel.json)
api/weekly-analysis.js  Sunday noon PHT → Sunday 4am UTC
api/mealplan.js         Monday 7am PHT → Sunday 11pm UTC
api/debug.js            Always check after deploy
lib/supabase.js         Uses SERVICE_KEY (not anon key)
```

## Cron Setup

Vercel `vercel.json` (daily only on Hobby):
- `/api/mealplan` → `0 23 * * 0` (Mon 7am PHT)
- `/api/weekly-analysis` → `0 4 * * 0` (Sun noon PHT)

Per-minute reminders: cron-job.org → `/api/reminders` every minute.

## Required Env Vars

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_GROUP_CHAT_ID
```

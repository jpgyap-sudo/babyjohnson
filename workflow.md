# workflow.md — Baby Johnson Care App

## System Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│     Web App UI      │     │   Telegram Group    │
│   /api/assistant    │     │   /api/telegram     │
└────────┬────────────┘     └────────┬────────────┘
         │                           │
         ▼                           ▼
    Claude AI parses intent     Two input modes:
    (single or bulk action)     - @mention → direct command
                                - Passive → auto-log from chat
         │                           │
         ▼                           ▼
    ┌────────────────────────────────────┐
    │           Supabase Database        │
    └────────────────────────────────────┘
         │
         ▼
    Telegram confirmation sent to group
```

---

## Flow 1 — Web App Assistant

```
User types message in app
  → /api/assistant receives it
  → Fast-path keyword check (schedule / food / vitamins / activity)
      → If matched: query Supabase directly, return result
  → Else: Claude parses intent → returns JSON action
      → Single: add_food / add_vitamin / add_schedule / add_routine
               add_reminder / add_activity / show_* / chat
      → Bulk: 2+ items → loop inserts into Supabase
  → Response returned to app UI
```

---

## Flow 2 — Telegram @Mention

```
User tags @bot in group message
  → /api/telegram detects @mention
  → Claude (handleMention) parses intent → JSON action
      → add_food / add_schedule / add_routine / add_reminder
        add_activity / show_* / show_preferences / chat
      → chat: general question → Claude answers directly
      → limitation: feature doesn't exist yet
          → Log to app_suggestions table
          → Ask group: "Add this to the dev backlog?" [Yes / No]
      → bulk: 2+ items → loop inserts
  → Telegram reply sent to group
```

---

## Flow 3 — Telegram Passive Logging

```
Anyone sends a message in the group (no @mention needed)
  → /api/telegram reads the message
  → Claude (parseMessageWithAI) classifies it:
      → food: log to food_logs
          → Fire context reminders with trigger = "food"
      → vitamin: upsert to vitamin_logs
      → activity: log to activity_logs
          (bath, brush teeth, play, sleep, outing, etc.)
      → schedule: log to schedule (today only)
      → preference: Johnson likes/dislikes something
          → Insert to johnson_preferences (status = pending)
          → Ask group: "Add to favorites/dislikes?" [Yes / No]
      → context_reminder: "remind us to X whenever Y happens"
          → Insert to context_reminders (active = false)
          → Ask group: "Set this reminder?" [Yes / No]
      → query_food / query_vitamins / query_activity
        query_schedule / query_preferences
          → Query Supabase → reply to group
      → none: unrelated chat, ignored silently
```

---

## Flow 4 — Scheduled Cron Jobs

### Every minute — Routine Reminders (`/api/reminders`)

```
Cron fires at HH:MM
  → Check reminders table for entries matching current time
      → Send Telegram alert for each
  → Check master_schedule for activities due at current time
      → If not yet notified today:
          → Send Telegram with [✅ Yes done / ⏰ Not yet] buttons
          → Log to master_schedule_log (completed = null)
          → Fire any context_reminders matching this activity
```

### Monday 7am PHT — Weekly Meal Plan (`/api/mealplan`)

```
Cron fires Monday 7:00 PHT
  → Claude generates 7-day meal plan (breakfast → dinner)
    and grocery list grouped by category
  → Upsert to meal_plans table (keyed by week_start)
  → Send Telegram: "This week's meal plan is ready!"
```

### Sunday noon PHT — Weekly Analysis (`/api/weekly-analysis`)

```
Cron fires Sunday 12:00 PHT
  → Pull last 7 days: food_logs, vitamin_logs,
    schedule, master_schedule_log, johnson_profile
  → Claude analyzes patterns → returns:
      weekly_summary    → sent to Telegram group
      highlights        → sent to Telegram group
      profile_updates   → upserted to johnson_profile
      app_suggestions   → inserted to app_suggestions
```

---

## Flow 5 — Button Confirmations (Inline Keyboard)

```
User taps a Telegram inline button
  → /api/telegram receives callback_query

  ctx_yes_ / ctx_no_   → Activate or delete context_reminder
  pref_yes_ / pref_no_ → Confirm or reject johnson_preferences entry
  suggest_y_ / suggest_n_ → Accept or reject app_suggestions entry
  done_ / skip_        → Mark master_schedule_log as completed or skipped
```

---

## Learning Loop

```
Weekly Analysis
  → profile_updates → johnson_profile (what Claude has learned about Johnson)
  → app_suggestions → developer reviews in Insights tab

Passive Telegram logging
  → preferences confirmed by parents → johnson_preferences
  → context reminders confirmed by parents → context_reminders (active = true)

Limitation detection (Telegram @mention)
  → app_suggestions → developer reviews
```

---

## Database Tables (Quick Reference)

| Table | Written by | Read by |
|---|---|---|
| `food_logs` | assistant, telegram | weekly-analysis, queries |
| `vitamin_logs` | assistant, telegram | weekly-analysis, queries |
| `activity_logs` | assistant, telegram | queries |
| `schedule` | assistant, telegram | reminders, queries |
| `master_schedule` | assistant, telegram | reminders, weekly-analysis |
| `master_schedule_log` | reminders | weekly-analysis |
| `reminders` | assistant, telegram | reminders cron |
| `context_reminders` | telegram (passive) | reminders cron, telegram |
| `johnson_preferences` | telegram (passive) | queries |
| `johnson_profile` | weekly-analysis | weekly-analysis |
| `meal_plans` | mealplan cron | app UI |
| `app_suggestions` | telegram, weekly-analysis | developer / Insights tab |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Vercel (serverless + cron) |
| Database | Supabase (PostgreSQL) |
| AI | Claude Sonnet (`claude-sonnet-4-6`) |
| Bot | Telegram Bot API |
| Timezone | PHT (UTC+8) |

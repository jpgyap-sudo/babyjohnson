# feature.md - Baby Johnson Product Feature Map

## Product Readiness

Yes, this app is smart enough to be useful now. It has three important layers:

- Caregiver logging: web forms, web AI chat, Telegram dashboard buttons, Telegram mentions, and passive Telegram auto-logging.
- Smart memory: confirmed preferences, weekly profile learning, context reminders, and app suggestions.
- Operations: cron reminders, weekly analysis, meal plans, recipe generation, and a debug endpoint.

The main product risk is not intelligence. It is confidence: every smart feature needs a clear test path, expected database writes, and a quick way to debug failures.

---

## Core Promise

Baby Johnson Care should help busy caregivers record daily care with the least typing possible, then turn that history into useful reminders, summaries, meal ideas, and learned patterns.

Every feature should satisfy these rules:

- One caregiver action should produce one clear confirmation.
- Anything that changes routines, preferences, or automatic reminders should require parent approval unless done directly in the web app.
- All times should be Philippine time, formatted as `HH:MM`.
- Logs should always include `date`, `time`, and `source` when the table supports them.
- AI output should be parsed into known actions, not stored as vague chat unless the user is only asking a general question.

---

## Feature Inventory

| Area | Feature | Entry Points | Writes | Reads | Smart Behavior | Test Priority |
|---|---|---|---|---|---|---|
| Food | Log meal, drink, snack | Web Food tab, web AI, Telegram dashboard, mention, passive chat | `food_logs` | Food tab, calendar, weekly analysis | Detect food from natural language and ask portion after dashboard eating | P0 |
| Food | Portion update | Telegram dashboard portion buttons | `food_logs.portion` | Food views, weekly analysis | Uses original food log row from tap flow | P0 |
| Vitamins | Add vitamin master list | Web Vitamins tab | `vitamins` | Vitamins tab | Lets caregiver build checklist | P1 |
| Vitamins | Mark vitamin taken | Web Vitamins tab, web AI, Telegram dashboard, mention, passive chat | `vitamin_logs` | Vitamins tab, weekly analysis | Upserts one vitamin per day | P0 |
| Activities | Log activity | Web Activity tab, web AI, Telegram dashboard, mention, passive chat | `activity_logs` | Activity tab, queries | Handles bath, play, reading, poop, note, sleep | P0 |
| Sleep | Track sleep duration | Telegram dashboard | `caregiver_actions`, `activity_logs` | Activity tab, weekly analysis if included later | Starts at button tap and logs duration when awake button is tapped | P0 |
| Schedule | Add one-time schedule | Web Schedule tab, web AI, Telegram mention, passive chat | `schedule` | Schedule tab, queries | Today-only events | P0 |
| Routine | Add repeating routine | Web Routine tab, web AI, Telegram mention | `master_schedule` | Routine tab, reminder cron | Repeats daily and sends due reminder | P0 |
| Routine | Confirm routine completion | Telegram reminder buttons | `master_schedule_log` | Routine tab, weekly analysis | Done/not-yet response updates completion status | P0 |
| Reminders | Time-based reminder | Web Reminders tab, web AI, Telegram mention | `reminders` | Reminder cron | Sends Telegram alert at matching PHT time | P0 |
| Reminders | Context reminder | Web Reminders tab, passive Telegram request | `context_reminders` | Food logging, routine cron | Passive Telegram requires confirmation before activation | P1 |
| Preferences | Like/dislike detection | Passive Telegram, web Likes tab | `johnson_preferences` | Likes tab, meal plan, recipe, queries | Passive Telegram requires confirmation before saving | P0 |
| Meal Plan | Weekly AI meal plan | Web Meal Plan tab, Monday cron | `meal_plans` | Meal Plan tab, Telegram query | Uses confirmed preferences and profile facts | P1 |
| Recipes | On-demand recipe | Web Recipes tab | Browser local storage for saved recipes | Recipes tab | Uses Claude for toddler-safe recipe ideas | P2 |
| Weekly Intelligence | Weekly summary and learning | Sunday cron | `johnson_profile`, `app_suggestions` | Insights tab, Telegram report | Learns from last 7 days and cites the period | P1 |
| Limitation Logging | Backlog suggestion | Telegram mention | `app_suggestions` | Insights tab | Detects requests the app cannot do yet and asks family to confirm | P1 |
| Debugging | Health check | `/api/debug` | None, except Telegram debug ping | Debug response, Telegram group | Checks env, Supabase, dashboard tables, Telegram bot/send | P0 |

---

## Acceptance Criteria

### P0: Must Work Every Day

- Food logging creates a `food_logs` row with today's PHT date, a usable time, food name, type, portion if known, and source.
- Vitamin logging creates or updates one `vitamin_logs` row per date and vitamin name.
- Activity logging creates an `activity_logs` row with activity, date, time, notes, and source.
- Today's schedule shows both `schedule` rows for today and active `master_schedule` rows.
- Routine reminders do not send duplicates for the same routine item and date.
- Telegram dashboard flows preserve the button tap time, especially eating, sleep, poop, and vitamins.
- Parent approval buttons update or reject pending preferences, context reminders, and app suggestions.
- `/api/debug` returns useful status without exposing full secret values.

### P1: Smart Features

- Passive Telegram ignores unrelated messages silently.
- Passive Telegram logs obvious food, vitamin, activity, schedule, and query messages.
- Passive preference detection creates `johnson_preferences.status = pending` and asks for confirmation.
- Context reminder detection creates `context_reminders.active = false` and asks for confirmation.
- Weekly analysis uses the last 7 days and writes profile updates with category and confidence.
- Meal plan generation avoids confirmed dislikes and considers confirmed likes.
- Limitation requests become `app_suggestions.status = draft` or `pending` after confirmation.

### P2: Nice To Have

- Recipe ideas are toddler-safe and easy for caregivers to understand.
- Saved recipes remain available in browser local storage.
- Calendar history makes it easy to see food/vitamin days.
- Insights let a parent mark suggestions implemented or dismissed.

---

## Known Debug Checkpoints

| Check | Why It Matters | How To Verify |
|---|---|---|
| `conversation_state` exists | Dashboard multi-step flows need it | Run `/api/debug` |
| `caregiver_actions` exists | Sleep duration and dashboard audit trail need it | Run `/api/debug` |
| `master_schedule_log.activity` schema | `api/reminders.js` inserts `activity`, and `api/weekly-analysis.js` reads it | Confirm the column exists or remove/update that usage |
| `schedule.date` is always set | Today's schedule queries filter by date | Add schedule from web AI and Telegram, then inspect `schedule` |
| PHT date handling | Wrong date breaks daily logs | Compare app date with Manila time around midnight |
| Telegram Markdown fallback | Unescaped AI text can break Telegram messages | Send messages with symbols like `_`, `*`, `[`, `]` |
| Claude JSON parsing | AI features depend on valid JSON | Test ambiguous and bulk messages |
| Cron protection | Reminders should not duplicate | Run `/api/reminders?test=1` twice and check `master_schedule_log` |

---

## Suggested Product Improvements

These are not blockers, but they would make the app feel more reliable:

- Add a small automated smoke-test script for endpoint JSON parsing and Supabase connectivity.
- Add a non-production `TEST_MODE` or `DRY_RUN` flag so cron routes can be tested without sending real family Telegram messages.
- Add structured server logs around every AI parse result and database write error.
- Add an admin-only debug page that shows recent failed actions, pending confirmations, cron runs, and last weekly analysis result.
- Add database migrations for every table instead of relying on one SQL setup file.
- Add a test fixture seed file with fake Johnson logs for local testing.

---

## Release Checklist

Before deploying a change:

- `/api/debug` is healthy.
- Web tabs load without console errors.
- One food, vitamin, activity, schedule, routine, and reminder can be created.
- Telegram `/dashboard` opens the button grid.
- One dashboard eating flow completes with portion.
- One dashboard sleep flow logs duration.
- One passive food message auto-logs and confirms.
- One parent approval button works for a pending preference or context reminder.
- `/api/reminders?test=1` sends at most one test routine reminder and creates one log.
- Weekly analysis can run on test data without JSON parse failure.

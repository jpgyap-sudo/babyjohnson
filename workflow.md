# workflow.md - Testable Baby Johnson Workflows

This file describes how the app should run, how to test each flow, and where to look when something breaks.

## System Map

```text
Web app UI
  -> public/index.html
  -> /api/config for Supabase client config
  -> direct Supabase reads/writes for normal tabs
  -> /api/assistant for natural-language actions

Telegram group
  -> /api/telegram
  -> /dashboard button flows
  -> @mention command flows
  -> passive auto-logging flows
  -> inline approval buttons

Cron jobs
  -> /api/reminders every minute
  -> /api/mealplan Monday 7:00 AM PHT
  -> /api/weekly-analysis Sunday 12:00 PM PHT

Storage and intelligence
  -> Supabase tables for logs, routines, reminders, profile, suggestions
  -> Claude for parsing, meal plans, recipes, weekly analysis
  -> Telegram messages for family confirmations and reports
```

---

## Local/Preview Setup

1. Install dependencies:

```bash
npm install
```

2. Set environment variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_GROUP_CHAT_ID
ANTHROPIC_API_KEY
```

3. Run locally:

```bash
npm run dev
```

4. Open the app:

```text
http://localhost:3000
```

5. Run the debug endpoint:

```text
GET /api/debug
```

Expected debug health:

- Env variables show partial values, not `NOT SET`.
- `supabase.ok` is true.
- `dashboard_tables.conversation_state` is `OK`.
- `dashboard_tables.caregiver_actions` is `OK`.
- `telegram_bot.ok` is true.
- `telegram_send.ok` is true.

---

## Flow 1: Web Tabs

### Purpose

Parents can manually add, view, edit, or remove daily care records from the web app.

### Main Tabs

| Tab | Main Tables | Minimum Test |
|---|---|---|
| Food Log | `food_logs` | Add rice, verify it appears, delete it |
| Vitamins | `vitamins`, `vitamin_logs` | Add Vitamin D, check it taken today, uncheck/check |
| Schedule | `schedule` | Add today-only event, verify today's schedule |
| Calendar | `food_logs`, `vitamin_logs` | Select a day with logs and verify history |
| Reminders | `reminders`, `context_reminders` | Add reminder and toggle active |
| Meal Plan | `meal_plans` | Generate plan, edit one meal, refresh |
| AI | `/api/assistant` | Send "Johnson ate banana at 9am" |
| Routine | `master_schedule`, `master_schedule_log` | Add routine, toggle active |
| Activity Log | `activity_logs` | Add bath/play/sleep note and verify by date |
| Likes | `johnson_preferences` | Add confirmed like/dislike |
| Recipes | `/api/recipe`, local storage | Generate and save recipe |
| Insights | `johnson_profile`, `app_suggestions` | Load profile and mark suggestion resolved |

### Debug Path

- If a tab is blank, check `/api/config` and browser console.
- If writes fail, check Supabase row-level security and anon key permissions.
- If AI tabs fail, check `ANTHROPIC_API_KEY` and `/api/assistant` response.

---

## Flow 2: Web AI Assistant

### Input

The user sends natural language through the AI tab, floating chat, or schedule assistant box.

### Processing

```text
POST /api/assistant
  -> validate message
  -> compute today and current time in PHT
  -> use fast-path query checks for schedule, food, vitamins, activities
  -> otherwise ask Claude for strict JSON
  -> execute single action or bulk actions
  -> return { type, reply, data? }
```

### Supported Actions

`add_food`, `add_vitamin`, `add_activity`, `add_schedule`, `add_routine`, `add_reminder`, `show_food`, `show_vitamins`, `show_activity`, `show_schedule`, `show_routine`, `bulk`, `chat`.

### Test Messages

| Message | Expected Type | Expected Result |
|---|---|---|
| `Johnson ate banana at 9am` | `add_food` | Row in `food_logs` |
| `gave him Vitamin D` | `add_vitamin` | Upsert in `vitamin_logs` |
| `Johnson took a nap at 1pm` | `add_activity` | Row in `activity_logs` |
| `Doctor appointment at 3pm today` | `add_schedule` | Row in `schedule` for today |
| `Add bath every day at 7pm` | `add_routine` | Row in `master_schedule` |
| `Remind me vitamins at 8am` | `add_reminder` | Row in `reminders` |
| `What did Johnson eat today?` | `show_food` | List from `food_logs` |
| `Breakfast 8, nap 1, bath 7` | `bulk` | Multiple rows inserted |

### Debug Path

- If reply is raw text, Claude returned invalid JSON.
- If the UI does not refresh, check `sendChat()` type handling in `public/index.html`.
- If schedule rows do not appear, verify `schedule.date` is being inserted.

---

## Flow 3: Telegram Dashboard

### Input

Caregiver sends `/dashboard` in the Telegram group and taps buttons.

### Processing

```text
/api/telegram receives message
  -> /dashboard sends inline button grid
  -> dash_* callback stores conversation state or logs immediately
  -> text replies complete pending state
  -> bot confirms in one short message
```

### Dashboard Tests

| Button Flow | Expected Writes | Expected Confirmation |
|---|---|---|
| Eating -> type food -> portion | `food_logs`, `caregiver_actions` optional | Logged food, then updated portion |
| Sleeping -> Nap -> Awake | `caregiver_actions`, `activity_logs` | Sleep duration |
| Playing -> type activity | `activity_logs` | Playing logged |
| Reading -> type book | `activity_logs` | Reading logged |
| Bath | `caregiver_actions`, `activity_logs` | Bath logged |
| Poop -> type | `caregiver_actions`, `activity_logs` | Poop type logged |
| Vitamins -> preset | `vitamin_logs`, `caregiver_actions` | Vitamin logged |
| Vitamins -> Other -> type | `vitamin_logs`, `caregiver_actions` | Custom vitamin logged |
| Note -> type note | `activity_logs` | Note logged |

### Debug Path

- If second-step text is ignored, inspect `conversation_state`.
- If times look wrong, compare `clicked_at` with the confirmation time.
- If callbacks spin forever, check `answerCallback()` and Telegram logs in Vercel.

---

## Flow 4: Telegram @Mention

### Input

A family member tags the bot in the group.

### Processing

```text
Message mentions bot username
  -> remove @bot mention
  -> Claude handleMention returns JSON
  -> known actions write/query Supabase
  -> chat answers directly
  -> limitation logs a suggestion and asks for approval
```

### Test Messages

| Message | Expected Result |
|---|---|
| `@bot log Johnson ate chicken rice` | Food log |
| `@bot what did Johnson eat today?` | Food list |
| `@bot add bath every day at 7pm` | Routine row |
| `@bot show Johnson preferences` | Confirmed preferences list |
| `@bot can you track medicine inventory?` | App suggestion draft + approval buttons |

### Debug Path

- If mention is ignored, check `getMe`, bot username, and Telegram message entities.
- If a command becomes chat, inspect Claude JSON output in server logs.
- If suggestion approval fails, inspect `app_suggestions` status and callback data.

---

## Flow 5: Telegram Passive Logging

### Input

Anyone sends a normal message in the group without tagging the bot.

### Processing

```text
/api/telegram receives message
  -> skip dashboard and pending conversation state
  -> Claude parseMessageWithAI classifies message
  -> known care events are logged
  -> unrelated messages return no reply
  -> preference/context reminder candidates require parent approval
```

### Passive Tests

| Message | Expected Type | Expected Result |
|---|---|---|
| `Johnson ate banana and rice` | `food` | `food_logs` row + short confirmation |
| `gave Vitamin C` | `vitamin` | `vitamin_logs` upsert |
| `Johnson had a bath` | `activity` | `activity_logs` row |
| `dentist at 3pm today` | `schedule` | `schedule` row |
| `Johnson loves mango` | `preference` | Pending preference + approval buttons |
| `remind us to eat with Johnson whenever he eats` | `context_reminder` | Pending context reminder + approval buttons |
| `what did he eat today?` | `query_food` | Food summary |
| `good morning everyone` | `none` | No reply |

### Debug Path

- If unrelated chat gets logged, tighten the passive parser prompt.
- If real care messages are missed, add examples to the parser prompt.
- If approvals do not work, check `pref_yes_`, `pref_no_`, `ctx_yes_`, and `ctx_no_` callback handling.

---

## Flow 6: Inline Button Confirmations

### Callback Types

| Prefix | Meaning | Expected Write |
|---|---|---|
| `ctx_yes_` | Activate context reminder | `context_reminders.active = true` |
| `ctx_no_` | Reject context reminder | Delete or deactivate pending reminder |
| `pref_yes_` | Confirm preference | `johnson_preferences.status = confirmed` |
| `pref_no_` | Reject preference | `johnson_preferences.status = rejected` |
| `suggest_y_` | Accept app suggestion | `app_suggestions.status = pending` |
| `suggest_n_` | Reject app suggestion | `app_suggestions.status = rejected` |
| `done_` | Routine completed | `master_schedule_log.completed = true` |
| `skip_` | Routine not done yet | `master_schedule_log.completed = false` |
| `dash_` | Dashboard flow | Depends on selected dashboard action |

### Debug Path

- Confirm callback data length stays within Telegram limits.
- Check whether edited Telegram messages still render after Markdown fallback.
- Verify callback handlers always return `200 OK` so Telegram does not retry.

---

## Flow 7: Reminder Cron

### Input

Vercel cron calls `/api/reminders` every minute.

### Processing

```text
GET /api/reminders
  -> compute PHT today and HH:MM
  -> send active reminders where time == HH:MM
  -> find active routine items due at HH:MM
  -> skip any already logged today
  -> send done/not-yet buttons
  -> insert master_schedule_log row with completed = null
  -> fire matching active context reminders
```

### Test

```text
GET /api/reminders?test=1
```

Expected:

- Sends the first active routine item instead of waiting for exact current time.
- Creates one `master_schedule_log` row for today.
- A second test call should not duplicate the same routine log.

### Debug Path

- If routine reminders duplicate, inspect unique constraint on `master_schedule_log(master_schedule_id, date)`.
- If no routine sends, confirm at least one `master_schedule.active = true`.
- If the route errors, verify `master_schedule_log` schema matches code. Current code inserts/reads `activity`; make sure that column exists or update the code/schema.

---

## Flow 8: Meal Plan Cron

### Input

Vercel cron calls `/api/mealplan` Monday 7:00 AM PHT, or the web app calls it when a parent clicks generate.

### Processing

```text
GET /api/mealplan
  -> read confirmed preferences
  -> read profile facts
  -> ask Claude for JSON meal plan
  -> set week_start to Monday PHT
  -> upsert meal_plans row
  -> send Telegram notification
```

### Test

```text
GET /api/mealplan
```

Expected:

- `meal_plans.week_start` is the current Monday.
- `plan` parses as JSON.
- Meal Plan tab can render all days and grocery list.

### Debug Path

- If JSON parsing fails, inspect raw Claude text in route error logs.
- If Telegram notification fails, test `/api/debug`.
- If preferences are ignored, confirm they have `status = confirmed`.

---

## Flow 9: Weekly Intelligence

### Input

Vercel cron calls `/api/weekly-analysis` Sunday 12:00 PM PHT.

### Processing

```text
GET /api/weekly-analysis
  -> read last 7 days of food, vitamins, schedule, routine completion, profile
  -> ask Claude for weekly summary, highlights, profile updates, app suggestions
  -> upsert profile updates
  -> insert app suggestions
  -> send Telegram weekly report
```

### Test

```text
GET /api/weekly-analysis
```

Expected:

- JSON response includes `success: true`.
- `johnson_profile` has new or updated facts.
- `app_suggestions` has pending suggestions when useful.
- Telegram group receives a report that names the 7-day period.

### Debug Path

- If route fails, check Claude JSON parsing first.
- If routine lines show missing activity, verify `master_schedule_log.activity` exists or join routine logs to `master_schedule`.
- If insights tab is empty, confirm rows exist and status/category values match UI expectations.

---

## Flow 10: Debugging Ladder

Use this order when something breaks:

1. Environment: run `/api/debug` and check for missing env variables.
2. Database: verify the target table exists and the column names match code.
3. Telegram: verify bot identity and send permission with `/api/debug`.
4. Endpoint: call the route directly and inspect JSON response.
5. AI parse: check whether Claude returned valid JSON and a supported `type`.
6. UI refresh: check whether the frontend reloads the affected table after the action.
7. Timezone: confirm the row's `date` and `time` are PHT, not browser/UTC by accident.

---

## Database Quick Reference

| Table | Written By | Read By | Notes |
|---|---|---|---|
| `food_logs` | Web, assistant, Telegram, dashboard | Food tab, calendar, weekly analysis, queries | Core daily log |
| `vitamins` | Web | Vitamins tab | Master checklist |
| `vitamin_logs` | Web, assistant, Telegram, dashboard | Vitamins tab, weekly analysis, queries | Unique by date/name |
| `activity_logs` | Web, assistant, Telegram, dashboard | Activity tab, queries | Freeform activity history |
| `schedule` | Web, assistant, Telegram | Schedule tab, queries | Today-only events need `date` |
| `master_schedule` | Web, assistant, Telegram | Routine tab, reminders | Repeating daily routine |
| `master_schedule_log` | Reminders, callbacks | Routine tab, weekly analysis | Completion per routine/date |
| `reminders` | Web, assistant, Telegram | Reminder cron | Time-based Telegram alerts |
| `context_reminders` | Web, passive Telegram | Food logs, routine cron | Passive-created reminders need approval |
| `johnson_preferences` | Web, passive Telegram | Likes tab, meal plan, queries | Passive-created preferences need approval |
| `johnson_profile` | Weekly analysis | Insights, meal plan | Learned facts |
| `meal_plans` | Meal plan cron/web action | Meal Plan tab, Telegram query | JSON string |
| `app_suggestions` | Weekly analysis, limitation logging | Insights tab | Product backlog ideas |
| `conversation_state` | Telegram dashboard | Telegram dashboard | Pending multi-step replies |
| `caregiver_actions` | Telegram dashboard | Debug/audit, sleep flow | Tap audit trail |

---

## Pre-Deployment Smoke Test

Run these before production deploy:

1. `/api/debug` is healthy.
2. Add food from the web Food tab.
3. Add food through web AI.
4. Add activity through Activity tab.
5. Add routine and call `/api/reminders?test=1`.
6. Tap routine done/not-yet button in Telegram.
7. Run `/dashboard` and complete eating with portion.
8. Run `/dashboard` and complete sleep with awake button.
9. Send passive Telegram food message.
10. Send passive preference message and approve it.
11. Generate meal plan from web.
12. Run weekly analysis on test data.

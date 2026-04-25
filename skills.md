# skills.md — Baby Johnson Care App Skills

## Food Logging
**Trigger:** Any message about eating, drinking, snacking, or milk.

- Detects food name, food type (`food` / `drink` / `snack`), portion, time, and notes.
- Logs to `food_logs` table.
- After logging, fires any active context reminders linked to the `food` trigger.
- On query ("what did Johnson eat today?"), returns the full food log for today.

**Examples:** "Johnson had rice and chicken", "gave him apple juice at lunch", "had a banana snack at 3pm"

---

## Vitamin Logging
**Trigger:** Any message about vitamins, supplements, or medicine.

- Detects vitamin/supplement name and time taken.
- Upserts to `vitamin_logs` — one entry per vitamin per day, no duplicates.
- On query, returns all vitamins taken today.

**Examples:** "gave Johnson Vitamin C", "he took his multivitamin this morning"

---

## Activity Logging
**Trigger:** Any message about something Johnson did.

- Logs activity name, time, and optional notes.
- Logs to `activity_logs` table.
- Covers: bath, brushing teeth, playing, school, nap, sleep, reading, outdoor play, travel, and any other activity.
- On query ("what did Johnson do today?"), returns the activity log. Supports "yesterday" queries.

**Examples:** "Johnson had his bath", "he brushed his teeth at 7pm", "took a nap at 1:30"

---

## Schedule Skill
**Trigger:** Any message about a one-time event or appointment today.

- Adds a one-time entry to `schedule` (today only).
- Separate from the daily routine — use for doctor visits, outings, special events.
- On query, returns today's combined routine + schedule.

**Examples:** "doctor appointment at 3pm today", "going to grandma's at 5pm"

---

## Routine Skill
**Trigger:** Any message about adding a repeating daily activity.

- Adds a recurring entry to `master_schedule` (repeats every day).
- Routine reminders are sent automatically via cron at the scheduled time.
- On query, returns the current master daily routine.

**Examples:** "Add bath time every day at 7pm", "set breakfast for 7:30 every morning"

---

## Reminder Skill
**Trigger:** Any message asking to be reminded about something at a specific time.

- Creates a time-based entry in `reminders` table.
- Sent to the Telegram group at the exact scheduled time via cron.

**Examples:** "remind me about vitamins at 8am", "remind us to check Johnson's temperature at 6pm"

---

## Context Reminder Skill
**Trigger:** A suggestion to do something whenever a specific activity happens.

- Detects the trigger activity (e.g., Meal, Nap, Bath, School) and the reminder message.
- Asks the group for confirmation before activating.
- Once active, fires automatically whenever the matching activity is logged or scheduled.

**Examples:**
- "please eat with Johnson when he eats" → fires on every meal
- "dim the lights when he naps" → fires when Nap appears in the schedule
- "play soft music during bath time" → fires when Bath is scheduled

---

## Preference Skill
**Trigger:** Any message indicating Johnson likes or dislikes something.

- Detects item name, type (`like` / `dislike`), and category (`food` / `drink` / `activity` / `place` / `other`).
- Asks the group for confirmation before saving.
- Once confirmed, stored in `johnson_preferences`.
- On query ("what does Johnson like?"), returns confirmed preferences by type and category.

**Examples:** "Johnson loves chicken adobo", "he hates bitter melon", "he doesn't like loud places"

---

## Meal Plan Skill
**Trigger:** Cron job every Monday 7am PHT.

- Generates a 7-day meal plan (breakfast, morning snack, lunch, afternoon snack, dinner).
- Personalized using Johnson's confirmed food preferences and current profile.
- Also generates a full grocery list grouped by category.
- Saves to `meal_plans` table, notifies the group via Telegram.

---

## Recipe Skill
**Trigger:** Direct request from the web app UI.

- Generates a single toddler-safe recipe on demand based on a user prompt.
- Personalized using Johnson's confirmed food preferences (avoids dislikes, incorporates likes).
- Returns recipe name, ingredients with amounts, and simple cooking steps.

**Examples:** "soft chicken recipe", "rice porridge for lunch", "snack ideas"

---

## Query / Show Skills
All query skills are available via Telegram @mention or the web app.

| Command intent | What it returns |
|---|---|
| "what did Johnson eat today?" | Full food log for today |
| "did he take his vitamins?" | Vitamins logged today |
| "what's on the schedule today?" | Routine + one-time events combined |
| "show me the daily routine" | Master schedule only |
| "what did Johnson do today/yesterday?" | Activity log |
| "what does Johnson like/dislike?" | Confirmed preferences |

---

## Weekly Insight Skill
**Trigger:** Cron job every Sunday noon PHT.

- Analyzes last 7 days of food, vitamins, schedule, and routine completion.
- Produces:
  - **Weekly summary** — friendly 2–3 sentence overview sent to Telegram
  - **Highlights** — key patterns from the week
  - **Profile updates** — new facts saved to `johnson_profile`
  - **App suggestions** — improvement ideas saved to `app_suggestions`

---

## Smart Learning Skill
The agent builds a running profile of Johnson from confirmed logs over time.

**What it learns:**
- Food preferences (likes, dislikes, what he eats well)
- Sleep patterns (nap times, duration, wake times)
- Behavior (moods, energy levels, reactions)
- Health notes (symptoms, wellness observations)
- Routine patterns (what works consistently)
- Development milestones (skills, interests)

**Rules:**
- Never invent or assume data — only learn from confirmed logs.
- Suggestions require parent approval before changing routines or preferences.
- No medical diagnoses. Health observations only.
- When explaining a pattern, always cite the timeframe: "From the last 7 days, I noticed..."

---

## Telegram Caregiver Dashboard Skill
**Trigger:** Type `/dashboard` in the Telegram group.

Sends a one-tap button grid so caregivers log activities without typing:

```
👶 What is Johnson doing now?

[🍽 Eating]   [😴 Sleeping]
[🎮 Playing]  [📚 Reading]
[🚿 Bath]     [💩 Poop]
[💊 Vitamins] [📝 Note]
```

**Rules:**
- The exact button-tap time is always used for the log — not the time of the text reply.
- Each button triggers a smart follow-up question.
- Ask only one question at a time. Use buttons for choices, text for open replies.
- Confirm every log with a short friendly message.
- If a caregiver @mentions the bot while a reply is pending, clear the pending state and handle the mention instead.

**Smart flows per button:**

| Button | Follow-up | What gets logged |
|---|---|---|
| 🍽 Eating | "What is Johnson eating?" → then [All / Half / Few bites / Refused] | `food_logs` + `caregiver_actions` |
| 😴 Sleeping | [💤 Nap / 🌙 Bedtime] → shows [☀️ Johnson is awake!] button | `activity_logs` (with duration) + `caregiver_actions` |
| 🎮 Playing | "What is he playing?" | `activity_logs` + `caregiver_actions` |
| 📚 Reading | "What is he reading?" | `activity_logs` + `caregiver_actions` |
| 🚿 Bath | Immediate log, no question | `activity_logs` + `caregiver_actions` |
| 💩 Poop | [✅ Normal / 💧 Soft / 🪨 Hard / 💦 Watery] | `activity_logs` + `caregiver_actions` |
| 💊 Vitamins | [☀️ Vitamin D / 🌈 Multivitamin / ✏️ Other] | `vitamin_logs` + `caregiver_actions` |
| 📝 Note | "What's the note?" | `activity_logs` + `caregiver_actions` |

**Sleep duration tracking:**
1. Caregiver taps Sleeping → selects Nap or Bedtime → bot logs sleep start and shows [☀️ Johnson is awake!] button.
2. Caregiver taps Wake up → bot calculates exact duration and logs it.

**Context reminders:**
After the Eating flow logs food, the bot automatically fires any active context reminders with trigger `food`.

---

## Limitation Detection
When the Telegram bot is asked to do something it can't do yet:

- Sends a friendly reply explaining the limitation.
- Automatically logs the request to `app_suggestions`.
- Asks the group: "Want me to add this to the dev backlog?" with Yes/No buttons.

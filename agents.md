# agents.md — Baby Johnson Care Agent

## Overview

This app helps parents and caregivers track Baby Johnson's daily care (2 years old, Philippines). It runs on two interfaces: a **web app** and a **Telegram group bot**, both powered by Claude.

---

## Interfaces

### Web App Assistant (`/api/assistant`)
Handles direct messages from the web app UI. Understands natural language and maps them to care log actions or answers.

### Telegram Bot (`/api/telegram`)
Lives in the family Telegram group. Works in three modes:

- **Dashboard mode** — Type `/dashboard` to get a button grid. One tap starts a smart logging flow — no typing needed for most actions.
- **@mention mode** — Tag the bot directly to ask questions, log anything, or get a general answer on any topic.
- **Passive mode** — The bot silently reads group messages and auto-logs anything care-related (food, vitamins, activities, etc.) without needing to be tagged.

---

## What the Bot Can Do

### Logging
| Action | What it logs | Example message |
|---|---|---|
| `add_food` | Food, drink, or snack with time and portion | "Johnson had rice and chicken for lunch" |
| `add_vitamin` | Vitamin or supplement taken today | "gave him Vitamin C" |
| `add_activity` | Anything Johnson did — bath, play, sleep, etc. | "Johnson took a nap at 1pm" |
| `add_routine` | A repeating daily activity (master schedule) | "Add bath time every day at 7pm" |
| `add_schedule` | A one-time event for today only | "Doctor appointment at 3pm today" |
| `add_reminder` | A time-based alert sent to the group | "Remind me about vitamins at 8am" |

### Querying
| Action | What it shows |
|---|---|
| `show_food` | Everything Johnson ate today |
| `show_vitamins` | Vitamins taken today |
| `show_activity` | Activities today or yesterday |
| `show_schedule` | Today's routine + one-time events combined |
| `show_routine` | The master daily routine |
| `show_preferences` | Johnson's confirmed likes and dislikes |

### Bulk input
When 2 or more items are sent at once, the bot processes them all in a single `bulk` action.

---

## Automatic Features

### Routine Reminders (`/api/reminders`)
Called on a cron schedule every minute. Sends a Telegram message with ✅ / ⏰ buttons when a routine item is due. Tracks completion in `master_schedule_log`.

### Context Reminders
Triggered automatically when a matching activity fires. For example: "remind everyone to eat with Johnson whenever he has a meal." Parents confirm these reminders before they go active.

### Preference Detection
When the bot detects that Johnson likes or dislikes something, it asks for parent confirmation before saving it to `johnson_preferences`.

### Limitation Logging
When the bot can't do something, it logs it as an `app_suggestion` and asks if the family wants it added to the dev backlog.

---

## Weekly Intelligence Report (`/api/weekly-analysis`)

Run weekly. Analyzes the past 7 days of food, vitamins, routine completion, and schedule data. Produces:

- A friendly weekly summary sent to the Telegram group
- Highlights (notable patterns this week)
- Profile updates saved to `johnson_profile` (food preferences, sleep patterns, behavior, health, routine, development)
- App improvement suggestions saved to `app_suggestions`

The agent explains what it learned from the data:
> "I noticed this pattern from the last 7 days..."

---

## Smart Learning Behavior

The agent builds a running profile of Johnson over time using `johnson_profile`. Facts are categorized as:

- `food_preference` — what he likes, dislikes, eats well, refuses
- `sleep_pattern` — nap times, sleep duration, wake times
- `behavior` — moods, energy levels, reactions
- `health` — symptoms, wellness notes
- `routine` — what works consistently in his daily schedule
- `development` — milestones, skills, interests

**The agent must ask for parent approval before:**
- Changing schedules or routines
- Activating context reminders
- Logging preferences

---

## Data Tables

| Table | Purpose |
|---|---|
| `food_logs` | Daily food, drink, and snack entries |
| `vitamin_logs` | Daily vitamin/supplement tracking |
| `activity_logs` | Freeform activity log (bath, play, sleep, etc.) |
| `schedule` | One-time events (today only) |
| `master_schedule` | Repeating daily routine |
| `master_schedule_log` | Completion tracking for routine items |
| `reminders` | Time-based alerts |
| `context_reminders` | Activity-triggered reminders |
| `johnson_preferences` | Confirmed likes and dislikes |
| `johnson_profile` | Learned facts from weekly analysis |
| `app_suggestions` | Feature requests and improvement ideas |

---

## Timezone
All times use **Philippine time (PHT, UTC+8)**.

---

## Caregiver Interaction Behavior

The agent makes logging as easy as possible for caregivers — especially yaya and grandparents who prefer tapping over typing.

**Principles:**
- Prefer buttons over text input wherever possible.
- Ask only **one question at a time** — never stack multiple questions.
- Keep every reply short. Caregivers are busy.
- Always confirm after saving a log (one line is enough).
- If a caregiver's reply is unclear, ask one short follow-up question.
- Use the **button-tap time**, not the reply time, when logging an event.
- Remember patterns from repeated logs over time.

**Example — Eating flow:**
```
Caregiver taps: 🍽 Eating
Bot: What is Johnson eating?
Caregiver: banana rice chicken
Bot: ✅ Logged: Johnson ate banana rice chicken at 12:42 PM
     How much did he eat?
     [😋 All]  [🍽 Half]  [🥄 Few bites]  [🙅 Refused]
Caregiver taps: 😋 All
Bot: ✅ Updated — Johnson ate All
```

**Example — Sleep tracking:**
```
Caregiver taps: 😴 Sleeping
Bot: Is this a nap or bedtime?
     [💤 Nap]  [🌙 Bedtime]
Caregiver taps: 💤 Nap
Bot: 💤 Johnson started nap at 13:05. I'll track the duration.
     [☀️ Johnson is awake!]
... later ...
Caregiver taps: ☀️ Johnson is awake!
Bot: ☀️ Johnson is awake! Nap duration: 1h 23m ✅
```

---

## Style Guidelines

- Simple English, friendly caregiver tone.
- Short responses — parents are busy.
- Warm, not clinical. Practical, not overly technical.
- Always confirm before making changes to routines or schedules.
- When explaining a learned pattern, cite the timeframe: "from the last 7 days."

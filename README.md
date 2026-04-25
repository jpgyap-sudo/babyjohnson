# Baby Johnson Care App

An AI-powered care tracker for Baby Johnson — a 2-year-old toddler in the Philippines. Caregivers log food, vitamins, activities, and routines through a web app or a Telegram group bot. Claude handles natural language, learns Johnson's patterns over time, and sends the family smart weekly reports.

---

## Features

| Feature | Description |
|---|---|
| Food logging | Log meals, drinks, and snacks with portion and time |
| Vitamin logging | Track daily vitamins and supplements |
| Activity logging | Log bath, play, school, nap, travel, and anything Johnson does |
| Daily routine | Set repeating daily activities with automated reminders |
| One-time schedule | Add today-only events like doctor visits |
| Time-based reminders | Set alerts sent to the Telegram group at a specific time |
| Context reminders | Auto-fire reminders when a specific activity happens (e.g., "remind everyone to eat with Johnson when he has a meal") |
| Preferences | Track Johnson's food and activity likes/dislikes with parent confirmation |
| Meal plan | AI-generated weekly meal plan personalized to Johnson's preferences, delivered every Monday |
| Recipe generator | On-demand toddler-safe recipes tailored to Johnson's tastes |
| Weekly AI report | Sunday analysis of patterns, highlights, and app improvement suggestions |
| Smart learning | Builds a running profile of Johnson from confirmed logs over time |
| Limitation detection | Logs unbuilt feature requests from the Telegram group to the dev backlog |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | [Vercel](https://vercel.com) (serverless functions + cron jobs) |
| Database | [Supabase](https://supabase.com) (PostgreSQL) |
| AI | [Anthropic Claude](https://anthropic.com) (`claude-sonnet-4-6`) |
| Bot | Telegram Bot API |
| Timezone | Philippine Time — PHT (UTC+8) |

---

## API Endpoints

| Endpoint | Trigger | Purpose |
|---|---|---|
| `POST /api/assistant` | Web app UI | Parse and execute care log actions |
| `POST /api/telegram` | Telegram webhook | Handle group messages and button taps |
| `GET /api/reminders` | Cron every minute | Send routine notifications and time-based reminders |
| `GET /api/mealplan` | Cron Monday 7am PHT | Generate personalized weekly meal plan |
| `GET /api/weekly-analysis` | Cron Sunday noon PHT | Run weekly pattern analysis and send report |
| `POST /api/recipe` | Web app UI | Generate a toddler-safe recipe on demand |
| `GET /api/config` | Web app UI | Return Supabase URL and anon key to the frontend |
| `GET /api/debug` | Manual | Check Supabase connection and master schedule |

---

## Database Tables

| Table | Purpose |
|---|---|
| `food_logs` | Daily food, drink, and snack entries |
| `vitamin_logs` | Daily vitamin/supplement tracking |
| `activity_logs` | Freeform activity log |
| `schedule` | One-time events (today only) |
| `master_schedule` | Repeating daily routine |
| `master_schedule_log` | Completion tracking for routine reminders |
| `reminders` | Time-based alerts |
| `context_reminders` | Activity-triggered reminders |
| `johnson_preferences` | Confirmed likes and dislikes |
| `johnson_profile` | Facts learned from weekly analysis |
| `meal_plans` | Weekly meal plans keyed by Monday date |
| `app_suggestions` | Feature requests and improvement ideas |

---

## Setup & Deployment

### 1. Prerequisites
- [Vercel](https://vercel.com) account (Pro plan required for per-minute cron)
- [Supabase](https://supabase.com) project
- [Telegram bot](https://t.me/BotFather) token and a group chat ID
- [Anthropic API key](https://console.anthropic.com)

### 2. Clone and install

```bash
git clone https://github.com/jpgyap-sudo/babyjohnson.git
cd babyjohnson
npm install
```

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_GROUP_CHAT_ID=your-group-chat-id
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Add the same variables to your Vercel project under **Settings → Environment Variables**.

### 4. Deploy to Vercel

```bash
npm run dev       # local development
vercel deploy     # deploy to preview
vercel --prod     # deploy to production
```

### 5. Set Telegram webhook

After deploying, register the webhook so Telegram sends messages to your app:

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram
```

Replace `<YOUR_BOT_TOKEN>` and `your-app.vercel.app` with your actual values.

---

## Cron Jobs

Configured in `vercel.json`. All times are UTC (app converts to PHT internally).

| Endpoint | Schedule (UTC) | Fires at (PHT) |
|---|---|---|
| `/api/reminders` | `* * * * *` | Every minute |
| `/api/mealplan` | `0 23 * * 0` | Monday 7:00am |
| `/api/weekly-analysis` | `0 4 * * 0` | Sunday 12:00pm |

> **Note:** Per-minute cron requires Vercel Pro or higher.

---

## Documentation

| File | Contents |
|---|---|
| [`agents.md`](agents.md) | Full agent behavior, data tables, and interface reference |
| [`workflow.md`](workflow.md) | All 5 system flows with diagrams |
| [`skills.md`](skills.md) | Every skill with triggers and examples |
| [`.env.example`](.env.example) | Required environment variables |

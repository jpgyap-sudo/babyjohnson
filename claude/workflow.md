# workflow.md — Build & Debug Workflow Guide

How to design, build, and debug Claude-powered apps. Based on real patterns from production.

---

## Standard App Architecture

```
Input channels
  ├── Web app UI          → /api/assistant
  ├── Telegram message    → /api/telegram (webhook)
  ├── Telegram button tap → /api/telegram (callback_query)
  └── Cron job            → /api/reminders, /api/weekly-analysis, etc.

Processing
  ├── Fast-path (regex keyword match) — no AI, instant
  ├── Conversation state check — pending multi-step reply
  ├── Claude AI parse — intent + data extraction
  └── Direct DB query — show/list operations

Output
  ├── Supabase write
  ├── Telegram message (text or buttons)
  └── HTTP response (JSON)
```

---

## Phase 1 — Design Before Coding

Answer these before writing any code:

**1. What are the input channels?**
- Web UI only? Telegram group? Both?
- Will caregivers/users type or tap buttons?
- Is there a passive listener (reads all messages)?

**2. What data gets logged?**
- Define every table with: name, columns, data types, unique constraints
- Which tables need `date` (for day-based queries)?
- Which need `status` (pending/confirmed/rejected)?

**3. What does the user see?**
- Text reply? Inline buttons? Both?
- Does anything need confirmation before saving?

**4. What runs on a schedule?**
- Reminders at specific times → needs per-minute cron (Pro) or external cron
- Weekly reports → once a week, fine on Hobby plan

---

## Phase 2 — Build Order

Build in this order. Each phase is testable before the next:

```
1. DB tables (Supabase SQL)
2. /api/debug endpoint (verify connectivity)
3. Core logging skill (insert one row)
4. Core query skill (read and format that row)
5. AI parsing (add Claude, test with real messages)
6. Confirmation flows (buttons + callbacks)
7. Scheduled jobs (cron)
8. Interactive dashboard (conversation state)
9. Learning/profile system (weekly analysis)
```

---

## Phase 3 — Deployment

### Vercel deployment checklist

- [ ] All env vars set in Vercel dashboard (Settings → Environment Variables)
- [ ] `vercel.json` crons use UTC times (not local time)
- [ ] Hobby plan: no crons that run more than once per day
- [ ] Per-minute reminders: use cron-job.org (free) to hit `/api/reminders`
- [ ] GitHub repo connected in Vercel for auto-deploy (Settings → Git)
- [ ] After manual `vercel --prod`, verify with `/api/debug`

### Telegram webhook setup

```
https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://your-app.vercel.app/api/telegram
```

Run this once. After re-deploy, the webhook URL stays the same.

### Required env vars (standard set)

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY       ← use this in lib/supabase.js (not anon key)
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_GROUP_CHAT_ID
```

---

## Phase 4 — Debugging

### The debug-first rule

**Always add `/api/debug` before testing anything in Telegram.** It should:
1. Show all env vars (first 10 chars, not full value)
2. Query a Supabase table and return row count + error
3. Call `getMe` on the Telegram API
4. Attempt to send a test message to GROUP_ID
5. Check if new tables exist

If `/api/debug` shows all green but the bot isn't responding, the issue is in routing.

### Bot not responding to commands

**Checklist in order:**

```
1. Is the Vercel deployment actually updated?
   → Hit /api/debug — does it return the latest format?
   → If not: run `vercel --prod` manually

2. Are env vars set?
   → Check /api/debug output for 'NOT SET' values

3. Can the bot send messages?
   → Does /api/debug send the test ping to the group?
   → If not: check BOT_TOKEN and GROUP_ID

4. Is the command being received?
   → Add /test command — if it responds, routing works
   → If not: check GROUP_ID matches the group

5. Is there a stuck conversation state?
   → Commands must be checked BEFORE conversation state
   → Add clearConversationState() at top of command handler

6. Is there a silent Telegram API error?
   → Always check data.ok after every Telegram API call
   → Throw on !data.ok so try/catch surfaces the error
```

### Silent failure pattern (most common bug)

```javascript
// ❌ WRONG — fails silently if data.ok is false
const data = await fetch(url).then(r => r.json());
return data?.result?.message_id;

// ✅ RIGHT — surfaces the error
const data = await fetch(url).then(r => r.json());
if (!data.ok) throw new Error(`TG: ${data.description}`);
return data.result.message_id;
```

### Critical path vs optional path

```javascript
// ❌ WRONG — optional operation blocks critical path
await pinMessage(chatId, messageId);   // if this fails, user sees nothing

// ✅ RIGHT — optional operation is fire-and-forget
pinMessage(chatId, messageId).catch(() => {});  // failure doesn't block
await sendDashboard(chatId);  // this is what the user needs
```

### Supabase table doesn't exist yet

Wrap all Supabase calls that might hit missing tables:

```javascript
// ❌ WRONG — crashes if table missing
await supabase.from('new_table').select('*');

// ✅ RIGHT — returns null if table missing
try {
  const { data } = await supabase.from('new_table').select('*').maybeSingle();
  return data;
} catch { return null; }
```

### Timezone bugs

The app processes all times in PHT (UTC+8). Always convert cron schedules:

```javascript
// Always use this for current PHT time
const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
const today   = pht.toISOString().slice(0, 10);   // "YYYY-MM-DD"
const nowTime = pht.toISOString().slice(11, 16);   // "HH:MM"
```

### Conversation state eating commands

```javascript
// WRONG order — state check before command check
const convState = await getConversationState(userId);
// ... handle state ...
if (text.startsWith('/dashboard')) { ... }   // never reached if state exists

// CORRECT order — commands first, always
if (text.startsWith('/dashboard')) {
  clearConversationState(userId).catch(() => {});  // fire and forget
  // ... handle command ...
  return res.status(200).send('OK');
}
const convState = await getConversationState(userId);
```

---

## Standard File Structure

```
/api
  assistant.js        Web app AI handler
  telegram.js         Telegram webhook + bot logic
  reminders.js        Cron-triggered: time-based notifications
  weekly-analysis.js  Cron-triggered: weekly AI report
  mealplan.js         Cron-triggered: meal plan generation
  recipe.js           On-demand: recipe generator
  debug.js            Debug endpoint (always include)
  config.js           Returns public env vars to frontend

/lib
  supabase.js         Supabase client (use SERVICE_KEY not ANON_KEY)

/public
  index.html          Frontend (if any)

/supabase
  *.sql               Migration files — run in Supabase SQL editor

/claude
  agents.md           Agent design patterns (this repo)
  skills.md           Skill design patterns (this repo)
  workflow.md         Build & debug workflow (this repo)

.env.example          Template for required env vars
.mcp.json             MCP server connections (gitignored)
vercel.json           Cron job config
```

---

## MCP Setup

Always configure both at project scope in `.mcp.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "YOUR_TOKEN"]
    },
    "vercel": {
      "type": "sse",
      "url": "https://mcp.vercel.com/sse"
    }
  }
}
```

MCP servers load at session start. After editing `.mcp.json`, restart Claude Code.

---

## New App Checklist

Copy and work through this for every new app:

### Setup
- [ ] Create Supabase project, copy URL + keys
- [ ] Create Vercel project, connect GitHub repo
- [ ] Set all env vars in Vercel dashboard
- [ ] Create `.env.local` locally from `.env.example`
- [ ] Configure `.mcp.json` with Supabase + Vercel
- [ ] Create Telegram bot via BotFather, get token
- [ ] Add bot to group, get GROUP_CHAT_ID
- [ ] Set Telegram webhook

### Build
- [ ] Write Supabase tables SQL in `/supabase/`
- [ ] Run SQL in Supabase SQL editor
- [ ] Build `/api/debug` first — verify all connections
- [ ] Build core skill (log + query)
- [ ] Test with real messages before adding AI
- [ ] Add AI parsing
- [ ] Add confirmation flows
- [ ] Add scheduled jobs
- [ ] Add dashboard / interactive flows

### Pre-launch
- [ ] All env vars confirmed in `/api/debug`
- [ ] Telegram ping test works from `/api/debug`
- [ ] Add `/test` command — verify command routing
- [ ] Test fast-path and AI-path separately
- [ ] Check cron times are UTC equivalents of local times
- [ ] Verify new tables exist via `/api/debug`
- [ ] Write `README.md` with setup steps for next time

---

## Lessons Learned (Hard Way)

| Bug | Root cause | Fix |
|---|---|---|
| `/dashboard` not appearing | Conversation state checked before command | Always check commands first |
| Bot silent after deploy | Vercel not auto-deploying from GitHub | Connect repo in Vercel settings, or `vercel --prod` |
| Reminders never firing | No cron schedule in vercel.json | Add to vercel.json or use cron-job.org |
| Cron firing at wrong time | Used local time instead of UTC | Convert: PHT 7am Mon = UTC 11pm Sun |
| Button logs wrong time | Used reply time instead of tap time | Store `clicked_at` on tap, use it on reply |
| Telegram error invisible | `data.ok` not checked | Always check `if (!data.ok) throw` |
| DB error crashes dashboard | Missing try/catch around Supabase | Wrap all DB calls, fire-and-forget optionals |
| `/dashboard` logs "/dashboard" as food | State intercepts command text | Check commands before conversation state |
| Pinning blocks dashboard | `await` on optional operation | Make pinning fire-and-forget |
| Old code still running | Deployment failed silently | Check `/api/debug` returns latest format |

---

## Self-Improvement Protocol

This file grows every session. The Lessons Learned table and checklists are the living record of everything that went wrong and how to prevent it.

### When to update this file
| Trigger | What to add |
|---|---|
| New bug fixed | Add row to Lessons Learned table |
| Deployment step missed or gotcha hit | Add to deployment checklist |
| New app built with a different architecture | Update Standard App Architecture diagram |
| Debug step that wasn't in the checklist caught the issue | Add to the debug checklist |
| New tool or service added to the stack | Update Standard File Structure + MCP Setup |
| New app checklist item discovered | Add to New App Checklist |

### How to update
At session end, run through what happened:
1. Did anything break that a checklist item would have caught?
2. Was there a debugging step that isn't in the "Bot not responding" checklist?
3. Did a deployment step fail that should be documented?

Add one-line rows to the Lessons Learned table. Don't write paragraphs.
Commit with: `Update workflow.md — [what was learned]`

### Self-improvement is non-negotiable
The guides must be smarter after every session than before.
If nothing was added: either the session was trivial (no new patterns), or the update was skipped.
Skipping the update is the only way these guides stop being useful.

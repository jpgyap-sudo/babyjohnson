# agents.md — Claude Agent Design Guide

A reusable reference for building AI agents with Claude. Based on real patterns from production apps.

---

## Core Agent Architecture

Every agent needs three things defined upfront:

1. **What it receives** — user message, button tap, scheduled trigger, webhook
2. **What it decides** — intent classification, data extraction, action routing
3. **What it does** — write to DB, send a message, call an API, ask a follow-up

---

## Claude API Call Pattern

Always structure Claude calls to return **JSON only**. Never ask Claude to return prose when you need structured data.

```javascript
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,            // keep low for classification tasks
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  })
});

const d = await r.json();
if (d.error) return fallback(d.error.message);

const txt = d.content?.[0]?.text || '{}';
let parsed;
try {
  parsed = JSON.parse(txt.replace(/```json|```/g, '').trim());
} catch {
  return fallback(txt);   // Claude returned prose — treat as chat reply
}
```

**Token budgets:**
| Task | max_tokens |
|---|---|
| Intent classification | 300–500 |
| Single action with reply | 500 |
| Long answer / chat | 1000–2000 |
| Weekly analysis / report | 2000–4000 |

---

## JSON Action Schema

Design one schema and use it everywhere. The agent returns this from every call.

```
Single action:
{
  "type": "add_X" | "show_X" | "chat" | "bulk" | "limitation",
  "reply": "Short confirmation or full answer",
  "data": { ...action-specific fields }
}

Bulk (2+ items):
{
  "type": "bulk",
  "reply": "Added N items",
  "actions": [
    { "type": "add_X", "data": { ... } }
  ]
}
```

**Always include a `limitation` type.** When the user asks for something the app can't do yet:
```json
{
  "type": "limitation",
  "reply": "I can't do that yet, but I've logged it as a suggestion.",
  "data": { "title": "...", "description": "...", "reason": "..." }
}
```
Log it to an `app_suggestions` table and ask if they want it added to the backlog.

---

## Fast-Path vs AI-Path

Not every message needs Claude. Always check common patterns first.

```javascript
// Fast path — no AI call needed
const msgLower = message.toLowerCase();
if (/\b(what|show|list)\b/.test(msgLower) && /\b(schedule|routine)\b/.test(msgLower)) {
  return querySchedule();
}

// AI path — everything else
const parsed = await callClaude(message);
```

**Rule:** If you can detect the intent with regex in < 5ms, don't pay for a Claude call.

Fast-path candidates:
- "what did X do today" → query logs
- "show schedule" → query schedule
- "what did X eat" → query food logs

---

## Conversation State Pattern

Use this for any multi-step interaction (button → question → answer → confirm).

**DB table:**
```sql
create table conversation_state (
  id                uuid primary key default gen_random_uuid(),
  telegram_user_id  text not null unique,   -- one state per user
  action_type       text,                   -- what flow is active
  step              text,                   -- current step in flow
  clicked_at        timestamptz,            -- original event time (NOT reply time)
  extra             jsonb default '{}',     -- intermediate data
  created_at        timestamptz default now()
);
```

**Helpers:**
```javascript
async function setConversationState(userId, state) {
  try {
    await supabase.from('conversation_state')
      .upsert({ telegram_user_id: userId, ...state }, { onConflict: 'telegram_user_id' });
  } catch {}
}

async function getConversationState(userId) {
  try {
    const { data } = await supabase.from('conversation_state')
      .select('*').eq('telegram_user_id', userId).maybeSingle();
    return data;
  } catch { return null; }
}

async function clearConversationState(userId) {
  try {
    await supabase.from('conversation_state').delete().eq('telegram_user_id', userId);
  } catch {}
}
```

**Critical rules:**
- Always expire states older than 10 minutes
- Always check for commands (`/command`) BEFORE checking state — commands must never be blocked
- Clear state when user @mentions the bot mid-flow

```javascript
// Expire stale state
if (convState) {
  const ageMs = Date.now() - new Date(convState.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) {
    await clearConversationState(userId);
    convState = null;
  }
}
```

---

## Telegram Bot Patterns

### Message handler order (never change this order)

```
1. callback_query (button taps) — handle and return
2. Bot command check (/command) — ALWAYS before conversation state
3. Conversation state check — handles pending replies
4. @mention check — direct AI interaction
5. Passive parsing — auto-log from group chat
```

If `/command` is checked after conversation state, a stuck state will swallow commands silently.

### Always check Telegram API responses

```javascript
const data = await res.json();
if (!data.ok) throw new Error(`TG: ${data.description}`);
```

Silent failures are the #1 cause of "bot not responding" bugs.

### Fire-and-forget for optional operations

```javascript
// Pinning a message is optional — don't let it block the main flow
fetch(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true })
}).catch(() => {});
```

### Button timestamp rule

**Always record the button-tap time, not the reply time.** Store `clicked_at` in conversation state and use it for all logs.

```javascript
// When button is tapped:
await setConversationState(userId, { clicked_at: new Date().toISOString(), ... });

// When caregiver replies with text:
const logTime = state.clicked_at  // use this, not Date.now()
```

### Group restriction
```javascript
if (chatId !== GROUP_ID) return res.status(200).send('OK');
if (msg.from?.is_bot) return res.status(200).send('OK');
```

### Callback data length limit
Telegram `callback_data` max = **64 bytes**. UUIDs are 36 chars. Plan accordingly:
- `dash_wk_` (8) + UUID (36) = 44 ✓
- `dash_portion_all_` (17) + UUID (36) = 53 ✓

---

## Error Handling Rules

| Operation | Pattern |
|---|---|
| Critical (main reply) | `await` + `try/catch` + send error to user |
| Optional (pinning, cleanup) | fire-and-forget `.catch(() => {})` |
| DB in critical path | `try/catch`, return null on failure |
| Telegram sendMessage | always check `data.ok` |

Never let an optional operation block the main user-facing response.

---

## Agent Behavior Rules

- Ask only **one question at a time**
- Prefer **buttons** over text input where choices are known
- Always **confirm** after writing to the database
- When explaining a learned pattern, cite the timeframe: "From the last 7 days..."
- Never invent data — only use confirmed logs
- Use `limitation` type when a feature doesn't exist yet
- Ask parent/admin approval before changing schedules or saved preferences

---

## Supabase Patterns

```javascript
// Upsert (no duplicates)
await supabase.from('logs').upsert(
  { date, name, value },
  { onConflict: 'date,name' }
);

// Safe query (table might not exist yet)
try {
  const { data } = await supabase.from('table').select('*').maybeSingle();
  return data;
} catch { return null; }

// Parallel queries
const [{ data: a }, { data: b }] = await Promise.all([
  supabase.from('table_a').select('*'),
  supabase.from('table_b').select('*')
]);
```

---

## Debug Endpoint Template

Always include `/api/debug` in every app. It should check:

1. All env vars (first 10 chars — safe to share)
2. DB connectivity + table existence
3. External service identity (e.g. Telegram `getMe`)
4. Attempt to send a test message to the target channel

# skills.md — Skill Design Guide

How to design, categorize, and implement skills for Claude-powered apps.

---

## Skill Categories

| Category | Description | Example |
|---|---|---|
| **Log** | Write an event to the database | "Johnson ate rice" → insert food_log |
| **Query** | Read and return data | "What did Johnson eat today?" |
| **Interactive** | Multi-step button/text flow | Dashboard → tap Eating → type food |
| **Scheduled** | Cron-triggered, no user input | Weekly analysis, meal plan generation |
| **AI-powered** | Requires Claude to interpret | Passive parsing, pattern detection |
| **Learning** | Updates profile from confirmed data | Weekly profile updates |

---

## Skill Definition Template

For every skill, define these before writing any code:

```
Skill: [Name]
Trigger: [What starts it — message keyword, button tap, cron, webhook]
Input: [What data it needs]
Fast-path?: [Can regex handle this without Claude?]
Steps: [List each step in order]
Tables written: [Which Supabase tables it inserts/updates]
Tables read: [Which Supabase tables it queries]
Output: [What the user sees — message, buttons, nothing]
Confirmation required?: [Does the user need to approve before saving?]
```

---

## Fast-Path Skill (no AI needed)

Use when the intent is clear from keywords.

```javascript
// Pattern: keyword detection → direct DB query → formatted reply
const msgLower = message.toLowerCase();
const isQuery = /\b(what|show|tell|list|check)\b/.test(msgLower);

if (isQuery && /\b(food|eat|ate|meal)\b/.test(msgLower)) {
  const { data } = await supabase.from('food_logs')
    .select('*').eq('date', today).order('time');
  return formatFoodLog(data);
}
```

**When to use:**
- Query intents with clear keywords
- Simple lookups with predictable patterns
- Time-critical paths (saves ~1-2 seconds vs AI call)

---

## AI-Powered Skill

Use when intent is ambiguous or input is freeform.

```javascript
// Pattern: Claude classifies → route to handler → write to DB

// System prompt must specify exact JSON schema
const systemPrompt = `
Classify this message. Respond ONLY with valid JSON:
{
  "type": "food" | "activity" | "vitamin" | "none",
  "data": { ... },
  "confirmation": "Short friendly confirmation or null"
}`;

const parsed = await callClaude(message, systemPrompt);
if (parsed.type === 'food') await logFood(parsed.data);
```

**System prompt rules:**
- Say "Respond ONLY with valid JSON, no markdown" — every time
- Define the exact schema inline in the prompt
- List all valid `type` values explicitly
- Include example `data` shapes for each type as comments

---

## Interactive Skill (button → text → confirm)

Use for caregiver dashboards, multi-step forms.

```
Flow design:
1. Button tap → save clicked_at to conversation_state → ask question
2. Text reply → check conversation_state → process reply → clear state → confirm
3. Optional follow-up → buttons with UUIDs in callback_data
```

```javascript
// Step 1: button tap
if (data === 'dash_eat') {
  await setConversationState(userId, {
    action_type: 'eating',
    step: 'food_name',
    clicked_at: new Date().toISOString()  // save NOW, use later
  });
  await sendTelegram(chatId, 'What is he eating?');
}

// Step 2: text reply
if (state.action_type === 'eating' && state.step === 'food_name') {
  const logTime = new Date(state.clicked_at).toISOString().slice(11, 16); // button time
  await supabase.from('food_logs').insert({ time: logTime, name: text, ... });
  await clearConversationState(userId);
  await sendWithButtons(chatId, `✅ Logged at ${logTime}. How much?`, portionButtons);
}
```

---

## Scheduled Skill (cron)

Use for reports, reminders, generated content.

```javascript
// Pattern: pull data → AI analyzes → write results → notify group
export default async function handler(req, res) {
  const [{ data: logs }, { data: profile }] = await Promise.all([
    supabase.from('logs').select('*').gte('date', weekAgo),
    supabase.from('profile').select('*')
  ]);

  const analysis = await callClaude(formatDataForAnalysis(logs, profile));

  // Write learnings back
  for (const update of analysis.profile_updates) {
    await supabase.from('profile').upsert(update, { onConflict: 'category,fact' });
  }

  // Notify
  await sendTelegram(chatId, formatReport(analysis));
  return res.status(200).json({ success: true });
}
```

**Vercel cron limits:**
- Hobby plan: daily only (once per day max)
- Pro plan: per-minute (`* * * * *`)
- External cron (cron-job.org): free, per-minute, hits your `/api/endpoint`

**Cron UTC conversion:**
```
Monday 7am PHT (UTC+8) = Sunday 11pm UTC → "0 23 * * 0"
Sunday noon PHT         = Sunday 4am UTC  → "0 4 * * 0"
```

---

## Confirmation Skill Pattern

Use when saving preferences, schedules, or any persistent change.

```javascript
// 1. Insert with status = 'pending'
const { data: inserted } = await supabase.from('preferences')
  .insert({ item, pref_type, status: 'pending' }).select().single();

// 2. Send confirmation buttons
await sendWithButtons(chatId, `Want to save "${item}" as a ${pref_type}?`, [[
  { text: '✅ Yes', callback_data: `pref_yes_${inserted.id}` },
  { text: '❌ No',  callback_data: `pref_no_${inserted.id}` }
]]);

// 3. Handle callback
if (data.startsWith('pref_yes_')) {
  const id = data.slice(9);
  await supabase.from('preferences').update({ status: 'confirmed' }).eq('id', id);
  await editMessage(chatId, messageId, `✅ Saved!`);
}
if (data.startsWith('pref_no_')) {
  const id = data.slice(8);
  await supabase.from('preferences').update({ status: 'rejected' }).eq('id', id);
  await editMessage(chatId, messageId, `_Skipped._`);
}
```

---

## Learning Skill Pattern

Use for building user/subject profiles from logs over time.

```javascript
// Weekly: pull logs → Claude extracts facts → upsert to profile
const analysis = await callClaude(`
  Based on these logs, extract observable facts.
  Respond with: { "profile_updates": [{ "category": "...", "fact": "...", "confidence": "low|medium|high" }] }
`);

for (const u of analysis.profile_updates) {
  await supabase.from('profile').upsert(
    { category: u.category, fact: u.fact, confidence: u.confidence },
    { onConflict: 'category,fact' }
  );
}
```

Profile categories to define upfront:
- `food_preference` — likes/dislikes
- `sleep_pattern` — timing, duration
- `behavior` — moods, reactions
- `routine` — what works consistently
- `development` — milestones, skills

---

## Skill Checklist

Before shipping any skill:

- [ ] Does it have a fast-path check if intent is predictable?
- [ ] Does it use `clicked_at` (not `now()`) for event timestamps?
- [ ] Are all DB writes wrapped in try/catch?
- [ ] Does the confirmation message cite what was saved and when?
- [ ] For multi-step: is conversation state cleared after completion?
- [ ] For multi-step: is there a 10-minute expiry on stuck states?
- [ ] For cron: is the UTC equivalent of the local time correct?
- [ ] Is there a `/api/debug` endpoint to verify the skill works in production?

---

## Self-Improvement Protocol

This file grows every session. After any session where a new skill type is built or a pattern is discovered:

### When to update this file
| Trigger | What to add |
|---|---|
| New skill category built (not in the table) | Add row to Skill Categories table |
| New button flow pattern used | Add to Interactive Skill section |
| New cron pattern or UTC gotcha | Add to Scheduled Skill section |
| New learning/profile category discovered | Add to profile categories list |
| Skill checklist item missed and caused a bug | Add the item to Skill Checklist |
| Better fast-path regex pattern found | Update Fast-Path Skill example |

### How to update
At the end of a session where new skills were built, check each skill against the existing patterns:
- Is there a pattern here that should be reusable?
- Did the checklist catch everything, or did something slip through?
- Was a new skill category invented that belongs in the table?

Edit inline — don't create new sections for single patterns, add to existing ones.
Commit with: `Update skills.md — [what changed]`

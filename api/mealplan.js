import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: GROUP_ID, text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  const res2 = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Generate a healthy weekly meal plan for Baby Johnson, a 2-year-old toddler. Include breakfast, morning snack, lunch, afternoon snack, and dinner for Monday through Sunday. Also generate a complete grocery list grouped by category (Produce, Proteins, Dairy, Grains, etc.).

Respond ONLY with a valid JSON object (no markdown):
{
  "week_start": "YYYY-MM-DD",
  "days": [
    {
      "day": "Monday",
      "meals": {
        "breakfast": "...",
        "morning_snack": "...",
        "lunch": "...",
        "afternoon_snack": "...",
        "dinner": "..."
      }
    }
  ],
  "grocery_list": {
    "Produce": ["item1", "item2"],
    "Proteins": ["..."],
    "Dairy": ["..."],
    "Grains": ["..."],
    "Other": ["..."]
  }
}`
      }]
    })
  });

  const d = await res2.json();
  const txt = d.content?.[0]?.text || '{}';
  let plan;
  try { plan = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
  catch { return res.status(500).json({ error: 'Parse failed' }); }

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);
  plan.week_start = monday.toISOString().slice(0, 10);

  await supabase.from('meal_plans').upsert(
    { week_start: plan.week_start, plan: JSON.stringify(plan) },
    { onConflict: 'week_start' }
  );

  await sendTelegram(
    `🍽️ *Johnson's Meal Plan for the week of ${plan.week_start} is ready!*\n\nOpen the app to view the full plan and grocery list. You can edit any meals directly in the app.`
  );

  return res.status(200).json({ success: true, week_start: plan.week_start });
}

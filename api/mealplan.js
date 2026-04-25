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
  const [{ data: prefs }, { data: profile }] = await Promise.all([
    supabase.from('johnson_preferences').select('pref_type, item, category').eq('status', 'confirmed'),
    supabase.from('johnson_profile').select('category, fact').order('updated_at', { ascending: false })
  ]);

  const likes = (prefs || []).filter(p => p.pref_type === 'like').map(p => p.item);
  const dislikes = (prefs || []).filter(p => p.pref_type === 'dislike').map(p => p.item);
  const profileFacts = (profile || []).map(p => `[${p.category}] ${p.fact}`).join('\n');

  const prefContext = [
    likes.length ? `Foods Johnson loves: ${likes.join(', ')}.` : '',
    dislikes.length ? `Foods to avoid (Johnson dislikes): ${dislikes.join(', ')}.` : '',
    profileFacts ? `\nJohnson's profile:\n${profileFacts}` : ''
  ].filter(Boolean).join(' ');

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
        content: `Generate a healthy weekly meal plan for Baby Johnson, a 2-year-old toddler in the Philippines.${prefContext ? '\n\n' + prefContext : ''}\n\nIncorporate his favorite foods where appropriate and avoid anything he dislikes. Include breakfast, morning snack, lunch, afternoon snack, and dinner for Monday through Sunday. Also generate a complete grocery list grouped by category (Produce, Proteins, Dairy, Grains, etc.).\n\nRespond ONLY with a valid JSON object (no markdown):\n{\n  "week_start": "YYYY-MM-DD",\n  "days": [\n    {\n      "day": "Monday",\n      "meals": {\n        "breakfast": "...",\n        "morning_snack": "...",\n        "lunch": "...",\n        "afternoon_snack": "...",\n        "dinner": "..."\n      }\n    }\n  ],\n  "grocery_list": {\n    "Produce": ["item1", "item2"],\n    "Proteins": ["..."],\n    "Dairy": ["..."],\n    "Grains": ["..."],\n    "Other": ["..."]\n  }\n}`
      }]
    })
  });

  const d = await res2.json();
  const txt = d.content?.[0]?.text || '{}';
  let plan;
  try { plan = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
  catch { return res.status(500).json({ error: 'Parse failed' }); }

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
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

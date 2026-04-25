import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

async function parseMessageWithAI(message, photoCaption) {
  const content = photoCaption || message;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a baby care tracker assistant. Parse this message about baby Johnson (2 years old) and extract structured data.

Message: "${content}"

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "type": "food" | "vitamin" | "schedule" | "none",
  "data": {
    // if food: { "name": "...", "portion": "...", "food_type": "food|drink|snack", "time": "HH:MM or null", "notes": "..." }
    // if vitamin: { "name": "...", "time": "HH:MM or null" }
    // if schedule: { "activity": "...", "time": "HH:MM" }
    // if none: {}
  },
  "confirmation": "Short friendly confirmation message to send back in the group chat"
}`
      }]
    })
  });
  const d = await res.json();
  const txt = d.content?.[0]?.text || '{}';
  try { return JSON.parse(txt.replace(/```json|```/g, '').trim()); }
  catch { return { type: 'none', data: {}, confirmation: null }; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const body = req.body;
  const msg = body?.message;
  if (!msg) return res.status(200).send('OK');

  const chatId = msg.chat?.id?.toString();
  const text = msg.text || '';
  const caption = msg.caption || '';
  const hasPhoto = !!msg.photo;
  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toTimeString().slice(0, 5);

  // Only process from the monitored group
  if (chatId !== GROUP_ID) return res.status(200).send('OK');

  // Skip bot messages
  if (msg.from?.is_bot) return res.status(200).send('OK');

  const content = caption || text;
  if (!content && !hasPhoto) return res.status(200).send('OK');

  const parsed = await parseMessageWithAI(content, hasPhoto ? caption : null);

  if (parsed.type === 'food' && parsed.data?.name) {
    await supabase.from('food_logs').insert({
      date: today,
      time: parsed.data.time || nowTime,
      name: parsed.data.name,
      food_type: parsed.data.food_type || 'food',
      portion: parsed.data.portion || '',
      notes: parsed.data.notes || '',
      source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
  }

  else if (parsed.type === 'vitamin' && parsed.data?.name) {
    await supabase.from('vitamin_logs').upsert({
      date: today,
      vitamin_name: parsed.data.name,
      taken: true,
      time_taken: parsed.data.time || nowTime,
      source: 'telegram'
    }, { onConflict: 'date,vitamin_name' });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
  }

  else if (parsed.type === 'schedule' && parsed.data?.activity) {
    await supabase.from('schedule').insert({
      time: parsed.data.time,
      activity: parsed.data.activity,
      date: today,
      source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `📅 ${parsed.confirmation}`);
  }

  return res.status(200).send('OK');
}

import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

let BOT_USERNAME = null;

async function getBotUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  const data = await res.json();
  BOT_USERNAME = '@' + data.result.username;
  return BOT_USERNAME;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

async function handleMention(message, senderName, today, nowTime) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are the assistant bot for Baby Johnson's family care app. Today is ${today}, current time is ${nowTime}.

You can perform these actions when asked:
- Answer baby care questions (nutrition, health, milestones, recipes)
- Log food/drink/snack entries
- Add schedule items for today
- Set reminders
- Show today's food log or schedule (reply with show_food or show_schedule type)

Respond ONLY with valid JSON (no markdown):
{
  "type": "chat" | "add_food" | "add_schedule" | "add_reminder" | "show_food" | "show_schedule",
  "reply": "Friendly message to send back to the group",
  "data": {
    // add_food: { "name": "...", "food_type": "food|drink|snack", "portion": "...", "time": "HH:MM or null" }
    // add_schedule: { "time": "HH:MM", "activity": "..." }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // chat / show_food / show_schedule: {}
  }
}`,
      messages: [{ role: 'user', content: `${senderName}: ${message}` }]
    })
  });

  const d = await res.json();
  if (d.error) return { type: 'error', reply: `⚠️ API error: ${d.error.message}` };

  const txt = d.content?.[0]?.text || '{}';
  try {
    return JSON.parse(txt.replace(/```json|```/g, '').trim());
  } catch {
    return { type: 'chat', reply: txt };
  }
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
      model: 'claude-sonnet-4-6',
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
  const senderName = msg.from?.first_name || 'Someone';

  if (chatId !== GROUP_ID) return res.status(200).send('OK');
  if (msg.from?.is_bot) return res.status(200).send('OK');

  const content = caption || text;
  if (!content && !hasPhoto) return res.status(200).send('OK');

  // Check if bot is @mentioned
  const botUsername = await getBotUsername();
  const entities = msg.entities || msg.caption_entities || [];
  const isMentioned = entities
    .filter(e => e.type === 'mention')
    .some(e => content.slice(e.offset, e.offset + e.length).toLowerCase() === botUsername.toLowerCase());

  if (isMentioned) {
    const cleanMessage = content.replace(new RegExp(botUsername, 'gi'), '').trim();
    const action = await handleMention(cleanMessage || '(no message)', senderName, today, nowTime);

    if (action.type === 'add_food' && action.data?.name) {
      await supabase.from('food_logs').insert({
        date: today,
        time: action.data.time || nowTime,
        name: action.data.name,
        food_type: action.data.food_type || 'food',
        portion: action.data.portion || '',
        source: 'telegram'
      });
    }

    if (action.type === 'add_schedule' && action.data?.time && action.data?.activity) {
      await supabase.from('schedule').insert({
        date: today,
        time: action.data.time,
        activity: action.data.activity,
        color: '#7F77DD',
        source: 'telegram'
      });
    }

    if (action.type === 'add_reminder' && action.data?.time && action.data?.message) {
      await supabase.from('reminders').insert({
        time: action.data.time,
        message: action.data.message,
        active: true
      });
    }

    if (action.type === 'show_food') {
      const { data: foods } = await supabase.from('food_logs').select('*').eq('date', today).order('time');
      if (!foods?.length) {
        await sendTelegram(chatId, "Nothing logged for Johnson today yet! 🍽️");
      } else {
        const list = foods.map(f => `• ${f.time || ''} ${f.name}${f.portion ? ' (' + f.portion + ')' : ''}`).join('\n');
        await sendTelegram(chatId, `📋 *Johnson's food log today:*\n\n${list}`);
      }
      return res.status(200).send('OK');
    }

    if (action.type === 'show_schedule') {
      const { data: sched } = await supabase.from('schedule').select('*').eq('date', today).order('time');
      if (!sched?.length) {
        await sendTelegram(chatId, "No schedule items for today! 📅");
      } else {
        const list = sched.map(s => `• ${s.time} — ${s.activity}`).join('\n');
        await sendTelegram(chatId, `📋 *Johnson's schedule today:*\n\n${list}`);
      }
      return res.status(200).send('OK');
    }

    await sendTelegram(chatId, action.reply || "✅ Done!");
    return res.status(200).send('OK');
  }

  // Otherwise parse as a baby care log entry
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

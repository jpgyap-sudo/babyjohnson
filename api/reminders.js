import { supabase } from '../lib/supabase.js';

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
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);

  const { data: reminders } = await supabase
    .from('reminders')
    .select('*')
    .eq('time', hhmm)
    .eq('active', true);

  for (const r of reminders || []) {
    await sendTelegram(`🔔 *Reminder for Johnson!*\n\n${r.message}`);
  }

  return res.status(200).json({ sent: reminders?.length || 0 });
}

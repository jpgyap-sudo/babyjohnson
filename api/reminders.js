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

async function sendWithButtons(text, inlineKeyboard) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: GROUP_ID,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
}

export default async function handler(req, res) {
  const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const hhmm = pht.toISOString().slice(11, 16);
  const today = pht.toISOString().slice(0, 10);
  const isTest = req.query?.test === '1';

  // Regular reminders
  const { data: reminders } = await supabase
    .from('reminders')
    .select('*')
    .eq('time', hhmm)
    .eq('active', true);

  for (const r of reminders || []) {
    await sendTelegram(`🔔 *Reminder for Johnson!*\n\n${r.message}`);
  }

  // Master schedule notifications
  let scheduleQuery = supabase.from('master_schedule').select('*').eq('active', true);
  if (!isTest) scheduleQuery = scheduleQuery.eq('time', hhmm);
  else scheduleQuery = scheduleQuery.order('time').limit(1);
  const { data: schedules } = await scheduleQuery;

  for (const s of schedules || []) {
    // Skip if already notified today
    const { data: existing } = await supabase
      .from('master_schedule_log')
      .select('id')
      .eq('master_schedule_id', s.id)
      .eq('date', today)
      .maybeSingle();

    if (existing) continue;

    await sendWithButtons(
      `📋 *Time for Johnson's routine!*\n\n🕐 ${s.time} — *${s.activity}*\n\nHas this been done?`,
      [[
        { text: '✅ Yes, done!', callback_data: `done_${s.id}_${today}` },
        { text: '⏰ Not yet', callback_data: `skip_${s.id}_${today}` }
      ]]
    );

    // Mark as notified (completed = null = pending response)
    await supabase.from('master_schedule_log').insert({
      master_schedule_id: s.id,
      date: today,
      activity: s.activity,
      completed: null
    });
  }

  return res.status(200).json({
    pht_time: hhmm,
    pht_date: today,
    test_mode: isTest,
    sent: (reminders?.length || 0) + (schedules?.length || 0)
  });
}

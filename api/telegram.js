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
      max_tokens: 2000,
      system: `You are the assistant bot for Baby Johnson's family care app. Today is ${today}, current time is ${nowTime}.

Single actions — respond with:
{
  "type": "chat" | "add_food" | "add_schedule" | "add_reminder" | "add_routine" | "add_activity" | "show_food" | "show_schedule" | "show_activity",
  "reply": "...",
  "data": {
    // add_food: { "name": "...", "food_type": "food|drink|snack", "portion": "...", "time": "HH:MM" }
    // add_schedule: { "time": "HH:MM", "activity": "..." }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // add_routine: { "time": "HH:MM", "activity": "..." }
    // add_activity: { "activity": "...", "time": "HH:MM", "notes": "..." }
    // show_activity: { "date_ref": "today" | "yesterday" }
    // others: {}
  }
}

BULK input (multiple activities or a full schedule block) — respond with:
{
  "type": "bulk",
  "reply": "Added X items! Here's what I added: ...",
  "actions": [
    { "type": "add_routine", "data": { "time": "07:00", "activity": "Breakfast" } },
    { "type": "add_routine", "data": { "time": "08:00", "activity": "Playground" } }
  ]
}

Rules:
- Use "bulk" whenever the user provides 2 or more activities at once
- For time ranges like "8:00–9:00", use the start time "08:00"
- For activities without a clear time, make a reasonable estimate based on context
- "add_routine" = repeats every day (master schedule); "add_schedule" = today only
- Respond ONLY with valid JSON, no markdown`,
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
        content: `You are a baby care tracker for Baby Johnson (2 years old). Parse this group chat message.

Message: "${content}"

Determine if it is:
- A LOG ENTRY reporting something Johnson did:
  - food: eating, drinking, snacking
  - vitamin: taking a vitamin or supplement
  - schedule: a specific appointment or event
  - activity: anything else Johnson did (bath, brushing teeth, playing, sleeping, reading, going out, etc.)
- A QUESTION asking about what Johnson did (query_food, query_vitamins, query_schedule, query_activity)
- UNRELATED (none) — general chat not about Johnson's care

For query_activity, extract the date reference from the message.

Respond ONLY with valid JSON (no markdown):
{
  "type": "food" | "vitamin" | "schedule" | "activity" | "query_food" | "query_vitamins" | "query_schedule" | "query_activity" | "none",
  "data": {
    // food: { "name": "...", "portion": "...", "food_type": "food|drink|snack", "time": "HH:MM or null", "notes": "..." }
    // vitamin: { "name": "...", "time": "HH:MM or null" }
    // schedule: { "activity": "...", "time": "HH:MM" }
    // activity: { "activity": "...", "time": "HH:MM or null", "notes": "..." }
    // query_activity: { "date_ref": "today" | "yesterday" }
    // query_*: {}
    // none: {}
  },
  "confirmation": "Short friendly confirmation (for log entries only, null for queries/none)"
}`
      }]
    })
  });
  const d = await res.json();
  const txt = d.content?.[0]?.text || '{}';
  try { return JSON.parse(txt.replace(/```json|```/g, '').trim()); }
  catch { return { type: 'none', data: {}, confirmation: null }; }
}

async function answerCallback(callbackId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

async function editMessage(chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const body = req.body;

  // Handle inline keyboard button taps (Yes done / Not yet)
  const callback = body?.callback_query;
  if (callback) {
    const data = callback.data || '';
    const callbackChatId = callback.message?.chat?.id?.toString();
    const messageId = callback.message?.message_id;
    const responderName = callback.from?.first_name || 'Someone';

    if (data.startsWith('done_') || data.startsWith('skip_')) {
      const firstUnder = data.indexOf('_');
      const lastUnder = data.lastIndexOf('_');
      const action = data.slice(0, firstUnder);
      const scheduleId = data.slice(firstUnder + 1, lastUnder);
      const date = data.slice(lastUnder + 1);
      const completed = action === 'done';

      const { data: schedItem } = await supabase
        .from('master_schedule')
        .select('activity')
        .eq('id', scheduleId)
        .single();

      const activity = schedItem?.activity || 'Activity';

      await supabase.from('master_schedule_log')
        .update({ completed, responded_at: new Date().toISOString() })
        .eq('master_schedule_id', scheduleId)
        .eq('date', date);

      await answerCallback(callback.id, completed ? '✅ Marked as done!' : '⏰ Noted, will try later!');
      await editMessage(
        callbackChatId,
        messageId,
        completed
          ? `✅ *${activity}* — Done! Thanks ${responderName}! 🎉`
          : `⏰ *${activity}* — Not done yet. Noted by ${responderName}.`
      );
    }

    return res.status(200).send('OK');
  }

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

    // Bulk insert (multiple activities in one message)
    if (action.type === 'bulk' && action.actions?.length) {
      let count = 0;
      for (const a of action.actions) {
        if (a.type === 'add_routine' && a.data?.activity) {
          await supabase.from('master_schedule').insert({
            time: a.data.time || '00:00',
            activity: a.data.activity,
            color: a.data.color || '#7F77DD',
            active: true
          });
          count++;
        } else if (a.type === 'add_schedule' && a.data?.activity) {
          await supabase.from('schedule').insert({
            date: today, time: a.data.time || '00:00',
            activity: a.data.activity,
            color: a.data.color || '#7F77DD',
            source: 'telegram'
          });
          count++;
        } else if (a.type === 'add_reminder' && a.data?.time && a.data?.message) {
          await supabase.from('reminders').insert({
            time: a.data.time, message: a.data.message, active: true
          });
          count++;
        } else if (a.type === 'add_food' && a.data?.name) {
          await supabase.from('food_logs').insert({
            date: today, time: a.data.time || nowTime,
            name: a.data.name, food_type: a.data.food_type || 'food',
            portion: a.data.portion || '', source: 'telegram'
          });
          count++;
        }
      }
      await sendTelegram(chatId, action.reply || `✅ Added ${count} items!`);
      return res.status(200).send('OK');
    }

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

    if (action.type === 'add_activity' && action.data?.activity) {
      await supabase.from('activity_logs').insert({
        date: today,
        time: action.data.time || nowTime,
        activity: action.data.activity,
        notes: action.data.notes || '',
        source: 'telegram'
      });
    }

    if (action.type === 'show_activity') {
      const dateRef = action.data?.date_ref || 'today';
      const queryDate = dateRef === 'yesterday'
        ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        : today;
      const { data: acts } = await supabase
        .from('activity_logs').select('*').eq('date', queryDate).order('time');
      if (!acts?.length) {
        await sendTelegram(chatId, `No activities logged for Johnson on ${queryDate}! 📋`);
      } else {
        const list = acts.map(a => `• ${a.time || '?'} — ${a.activity}${a.notes ? ' (' + a.notes + ')' : ''}`).join('\n');
        await sendTelegram(chatId, `📋 *Johnson's activities on ${queryDate}:*\n\n${list}`);
      }
      return res.status(200).send('OK');
    }

    if (action.type === 'show_schedule') {
      const [{ data: sched }, { data: routine }] = await Promise.all([
        supabase.from('schedule').select('*').eq('date', today).order('time'),
        supabase.from('master_schedule').select('*').eq('active', true).order('time')
      ]);
      const allItems = [
        ...(routine || []).map(r => ({ time: r.time, activity: r.activity })),
        ...(sched || []).map(s => ({ time: s.time, activity: s.activity + ' _(today only)_' }))
      ].sort((a, b) => a.time.localeCompare(b.time));
      if (!allItems.length) {
        await sendTelegram(chatId, "No schedule items for today! 📅");
      } else {
        const list = allItems.map(s => `• ${s.time} — ${s.activity}`).join('\n');
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

  else if (parsed.type === 'activity' && parsed.data?.activity) {
    await supabase.from('activity_logs').insert({
      date: today,
      time: parsed.data.time || nowTime,
      activity: parsed.data.activity,
      notes: parsed.data.notes || '',
      source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
  }

  else if (parsed.type === 'query_food') {
    const { data: foods } = await supabase
      .from('food_logs').select('*').eq('date', today).order('time');
    if (!foods?.length) {
      await sendTelegram(chatId, "Johnson hasn't eaten anything yet today! 🍽️");
    } else {
      const list = foods.map(f =>
        `• ${f.time || '?'} — ${f.name}${f.portion ? ' (' + f.portion + ')' : ''}${f.food_type === 'drink' ? ' 🥤' : f.food_type === 'snack' ? ' 🍪' : ' 🍽️'}`
      ).join('\n');
      const last = foods[foods.length - 1];
      await sendTelegram(chatId, `🍽️ *Johnson's food log today:*\n\n${list}\n\n_Last ate at ${last.time || '?'}_`);
    }
  }

  else if (parsed.type === 'query_vitamins') {
    const { data: vits } = await supabase
      .from('vitamin_logs').select('*').eq('date', today).eq('taken', true);
    if (!vits?.length) {
      await sendTelegram(chatId, "No vitamins logged for Johnson today! 💊");
    } else {
      const list = vits.map(v => `✅ ${v.vitamin_name}${v.time_taken ? ' at ' + v.time_taken : ''}`).join('\n');
      await sendTelegram(chatId, `💊 *Johnson's vitamins today:*\n\n${list}`);
    }
  }

  else if (parsed.type === 'query_activity') {
    const dateRef = parsed.data?.date_ref || 'today';
    const queryDate = dateRef === 'yesterday'
      ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      : today;
    const { data: acts } = await supabase
      .from('activity_logs').select('*').eq('date', queryDate).order('time');
    if (!acts?.length) {
      await sendTelegram(chatId, `No activities logged for Johnson on ${queryDate}!`);
    } else {
      const list = acts.map(a => `• ${a.time || '?'} — ${a.activity}${a.notes ? ' (' + a.notes + ')' : ''}`).join('\n');
      await sendTelegram(chatId, `📋 *Johnson's activities on ${queryDate}:*\n\n${list}`);
    }
  }

  else if (parsed.type === 'query_schedule') {
    const [{ data: sched }, { data: routine }] = await Promise.all([
      supabase.from('schedule').select('*').eq('date', today).order('time'),
      supabase.from('master_schedule').select('*').eq('active', true).order('time')
    ]);
    const allItems = [
      ...(routine || []).map(r => ({ time: r.time, activity: r.activity })),
      ...(sched || []).map(s => ({ time: s.time, activity: s.activity }))
    ].sort((a, b) => a.time.localeCompare(b.time));
    if (!allItems.length) {
      await sendTelegram(chatId, "No schedule items logged for Johnson today! 📅");
    } else {
      const list = allItems.map(s => `• ${s.time} — ${s.activity}`).join('\n');
      await sendTelegram(chatId, `📅 *Johnson's schedule today:*\n\n${list}`);
    }
  }

  return res.status(200).send('OK');
}

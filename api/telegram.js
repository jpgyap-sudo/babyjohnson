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

async function sendWithButtons(chatId, text, inlineKeyboard) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } })
  });
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

// === DASHBOARD — conversation state helpers ===

async function setConversationState(userId, state) {
  await supabase.from('conversation_state').upsert(
    { telegram_user_id: userId, ...state },
    { onConflict: 'telegram_user_id' }
  );
}

async function getConversationState(userId) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('telegram_user_id', userId)
    .maybeSingle();
  return data;
}

async function clearConversationState(userId) {
  await supabase.from('conversation_state').delete().eq('telegram_user_id', userId);
}

// === DASHBOARD — main button grid ===

async function sendDashboard(chatId) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `👶 *What is Johnson doing now?*`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🍽 Eating',   callback_data: 'dash_eat' },
            { text: '😴 Sleeping', callback_data: 'dash_slp' }
          ],
          [
            { text: '🎮 Playing',  callback_data: 'dash_ply' },
            { text: '📚 Reading',  callback_data: 'dash_rd'  }
          ],
          [
            { text: '🚿 Bath',     callback_data: 'dash_bth' },
            { text: '💩 Poop',     callback_data: 'dash_poo' }
          ],
          [
            { text: '💊 Vitamins', callback_data: 'dash_vit' },
            { text: '📝 Note',     callback_data: 'dash_nte' }
          ]
        ]
      }
    })
  });
  const data = await res.json();
  return data?.result?.message_id;
}

// === DASHBOARD — handle all dash_ callback_queries ===

async function handleDashboardCallback(data, chatId, userId, senderName, pht) {
  const today   = pht.toISOString().slice(0, 10);
  const nowISO  = pht.toISOString();
  const nowTime = pht.toISOString().slice(11, 16);

  // ── 🍽 EATING ──────────────────────────────────────────────
  if (data === 'dash_eat') {
    await setConversationState(userId, {
      action_type: 'eating', step: 'food_name',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendTelegram(chatId, `🍽 What is Johnson eating?`);
    return;
  }

  // ── 😴 SLEEPING — ask type ──────────────────────────────────
  if (data === 'dash_slp') {
    await setConversationState(userId, {
      action_type: 'sleeping', step: 'sleep_type',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendWithButtons(chatId, `😴 Is this a nap or bedtime?`, [[
      { text: '💤 Nap',      callback_data: 'dash_slp_n' },
      { text: '🌙 Bedtime',  callback_data: 'dash_slp_b' }
    ]]);
    return;
  }

  // ── 😴 SLEEPING — nap or bedtime selected ───────────────────
  if (data === 'dash_slp_n' || data === 'dash_slp_b') {
    const state     = await getConversationState(userId);
    const clickedAt = state?.clicked_at || nowISO;
    const sleepType = data === 'dash_slp_n' ? 'Nap' : 'Bedtime';
    const dispTime  = new Date(clickedAt).toISOString().slice(11, 16);

    const { data: action } = await supabase.from('caregiver_actions').insert({
      caregiver_name: senderName,
      action_type: 'sleeping',
      clicked_at: clickedAt,
      date: today,
      details: { sleep_type: sleepType },
      status: 'sleeping'
    }).select().single();

    await clearConversationState(userId);

    const emoji = data === 'dash_slp_n' ? '💤' : '🌙';
    await sendWithButtons(chatId,
      `${emoji} Johnson started ${sleepType.toLowerCase()} at *${dispTime}*.\nI'll track the duration.`,
      [[{ text: '☀️ Johnson is awake!', callback_data: `dash_wk_${action.id}` }]]
    );
    return;
  }

  // ── ☀️ WAKE UP ──────────────────────────────────────────────
  if (data.startsWith('dash_wk_')) {
    const actionId = data.slice(8);
    const { data: action } = await supabase
      .from('caregiver_actions').select('*').eq('id', actionId).single();
    if (!action) return;

    const startTime    = new Date(action.clicked_at);
    const durationMs   = pht - startTime;
    const durationMins = Math.round(durationMs / 60000);
    const hours        = Math.floor(durationMins / 60);
    const mins         = durationMins % 60;
    const durationStr  = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const startDisp    = action.clicked_at.slice(11, 16);

    await supabase.from('caregiver_actions').update({
      status: 'complete',
      details: { ...action.details, end_time: nowISO, duration_mins: durationMins }
    }).eq('id', actionId);

    await supabase.from('activity_logs').insert({
      date: action.date || today,
      time: startDisp,
      activity: action.details?.sleep_type || 'Sleep',
      notes: `Duration: ${durationStr}. Woke at ${nowTime}.`,
      source: 'dashboard'
    });

    await sendTelegram(chatId,
      `☀️ Johnson is awake! ${action.details?.sleep_type || 'Sleep'} duration: *${durationStr}* ✅`
    );
    return;
  }

  // ── 🎮 PLAYING ──────────────────────────────────────────────
  if (data === 'dash_ply') {
    await setConversationState(userId, {
      action_type: 'playing', step: 'play_activity',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendTelegram(chatId, `🎮 What is Johnson playing?`);
    return;
  }

  // ── 📚 READING ──────────────────────────────────────────────
  if (data === 'dash_rd') {
    await setConversationState(userId, {
      action_type: 'reading', step: 'book_name',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendTelegram(chatId, `📚 What is Johnson reading?`);
    return;
  }

  // ── 🚿 BATH — immediate log ──────────────────────────────────
  if (data === 'dash_bth') {
    await Promise.all([
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'bath',
        clicked_at: nowISO, date: today, details: {}, status: 'complete'
      }),
      supabase.from('activity_logs').insert({
        date: today, time: nowTime, activity: 'Bath', notes: '', source: 'dashboard'
      })
    ]);
    await sendTelegram(chatId, `🚿 Bath time logged at *${nowTime}* ✅`);
    return;
  }

  // ── 💩 POOP — ask type ───────────────────────────────────────
  if (data === 'dash_poo') {
    await setConversationState(userId, {
      action_type: 'poop', step: 'poop_type',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendWithButtons(chatId, `💩 What kind?`, [
      [
        { text: '✅ Normal',  callback_data: 'dash_poo_n' },
        { text: '💧 Soft',    callback_data: 'dash_poo_s' }
      ],
      [
        { text: '🪨 Hard',   callback_data: 'dash_poo_h' },
        { text: '💦 Watery', callback_data: 'dash_poo_w' }
      ]
    ]);
    return;
  }

  // ── 💩 POOP — type selected ──────────────────────────────────
  if (['dash_poo_n','dash_poo_s','dash_poo_h','dash_poo_w'].includes(data)) {
    const state     = await getConversationState(userId);
    const clickedAt = state?.clicked_at || nowISO;
    const dispTime  = new Date(clickedAt).toISOString().slice(11, 16);
    const types     = { dash_poo_n: 'Normal', dash_poo_s: 'Soft', dash_poo_h: 'Hard', dash_poo_w: 'Watery' };
    const poopType  = types[data];

    await Promise.all([
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'poop',
        clicked_at: clickedAt, date: today, details: { type: poopType }, status: 'complete'
      }),
      supabase.from('activity_logs').insert({
        date: today, time: dispTime, activity: 'Poop', notes: poopType, source: 'dashboard'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `💩 *${poopType}* poop logged at *${dispTime}* ✅`);
    return;
  }

  // ── 💊 VITAMINS — show options ───────────────────────────────
  if (data === 'dash_vit') {
    await setConversationState(userId, {
      action_type: 'vitamin', step: 'vit_type',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendWithButtons(chatId, `💊 Which vitamin?`, [
      [
        { text: '☀️ Vitamin D',      callback_data: 'dash_vit_d' },
        { text: '🌈 Multivitamin',   callback_data: 'dash_vit_m' }
      ],
      [
        { text: '✏️ Other (type it)', callback_data: 'dash_vit_o' }
      ]
    ]);
    return;
  }

  // ── 💊 VITAMINS — preset selected ───────────────────────────
  if (data === 'dash_vit_d' || data === 'dash_vit_m') {
    const state     = await getConversationState(userId);
    const clickedAt = state?.clicked_at || nowISO;
    const dispTime  = new Date(clickedAt).toISOString().slice(11, 16);
    const vitName   = data === 'dash_vit_d' ? 'Vitamin D' : 'Multivitamin';

    await Promise.all([
      supabase.from('vitamin_logs').upsert({
        date: today, vitamin_name: vitName, taken: true,
        time_taken: dispTime, source: 'dashboard'
      }, { onConflict: 'date,vitamin_name' }),
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'vitamin',
        clicked_at: clickedAt, date: today, details: { name: vitName }, status: 'complete'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `💊 *${vitName}* logged at *${dispTime}* ✅`);
    return;
  }

  // ── 💊 VITAMINS — other (needs text reply) ───────────────────
  if (data === 'dash_vit_o') {
    const state = await getConversationState(userId);
    await setConversationState(userId, { ...state, step: 'vit_name' });
    await sendTelegram(chatId, `💊 Which vitamin? Type the name:`);
    return;
  }

  // ── 📝 NOTE ──────────────────────────────────────────────────
  if (data === 'dash_nte') {
    await setConversationState(userId, {
      action_type: 'note', step: 'note_text',
      clicked_at: nowISO, caregiver_name: senderName
    });
    await sendTelegram(chatId, `📝 What's the note?`);
    return;
  }

  // ── 🍽 PORTION — after eating ────────────────────────────────
  if (data.startsWith('dash_por_')) {
    const rest       = data.slice(9);          // e.g. "a_uuid-here"
    const portionKey = rest[0];                // 'a','h','f','r'
    const foodLogId  = rest.slice(2);          // uuid
    const labels     = { a: 'All', h: 'Half', f: 'Few bites', r: 'Refused' };
    const label      = labels[portionKey] || portionKey;

    await supabase.from('food_logs').update({ portion: label }).eq('id', foodLogId);
    await sendTelegram(chatId, `✅ Updated — Johnson ate *${label}*`);
    return;
  }
}

// === DASHBOARD — handle caregiver text reply when state is pending ===

async function handleConversationReply(state, text, chatId, userId, senderName, today, nowTime) {
  const clickedTime = state.clicked_at
    ? new Date(state.clicked_at).toISOString().slice(11, 16)
    : nowTime;

  // 🍽 EATING — food name
  if (state.action_type === 'eating' && state.step === 'food_name') {
    const { data: foodLog } = await supabase.from('food_logs').insert({
      date: today, time: clickedTime,
      name: text, food_type: 'food', portion: '', source: 'dashboard'
    }).select().single();

    await supabase.from('caregiver_actions').insert({
      caregiver_name: senderName, action_type: 'eating',
      clicked_at: state.clicked_at, date: today,
      details: { food: text }, status: 'complete'
    });

    await clearConversationState(userId);

    await sendWithButtons(chatId,
      `✅ Logged: Johnson ate *${text}* at *${clickedTime}*\n\nHow much did he eat?`,
      [
        [
          { text: '😋 All',       callback_data: `dash_por_a_${foodLog.id}` },
          { text: '🍽 Half',      callback_data: `dash_por_h_${foodLog.id}` }
        ],
        [
          { text: '🥄 Few bites', callback_data: `dash_por_f_${foodLog.id}` },
          { text: '🙅 Refused',   callback_data: `dash_por_r_${foodLog.id}` }
        ]
      ]
    );

    // Fire food context reminders
    const { data: ctxFood } = await supabase
      .from('context_reminders').select('*').eq('trigger', 'food').eq('active', true);
    for (const c of ctxFood || []) await sendTelegram(chatId, `🔔 *Reminder:* ${c.message}`);
    return true;
  }

  // 🎮 PLAYING
  if (state.action_type === 'playing' && state.step === 'play_activity') {
    await Promise.all([
      supabase.from('activity_logs').insert({
        date: today, time: clickedTime, activity: 'Playing', notes: text, source: 'dashboard'
      }),
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'playing',
        clicked_at: state.clicked_at, date: today, details: { activity: text }, status: 'complete'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `🎮 Logged: Johnson played *${text}* at *${clickedTime}* ✅`);
    return true;
  }

  // 📚 READING
  if (state.action_type === 'reading' && state.step === 'book_name') {
    await Promise.all([
      supabase.from('activity_logs').insert({
        date: today, time: clickedTime, activity: 'Reading', notes: text, source: 'dashboard'
      }),
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'reading',
        clicked_at: state.clicked_at, date: today, details: { book: text }, status: 'complete'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `📚 Logged: Johnson read *${text}* at *${clickedTime}* ✅`);
    return true;
  }

  // 💊 VITAMIN — other (typed name)
  if (state.action_type === 'vitamin' && state.step === 'vit_name') {
    await Promise.all([
      supabase.from('vitamin_logs').upsert({
        date: today, vitamin_name: text, taken: true,
        time_taken: clickedTime, source: 'dashboard'
      }, { onConflict: 'date,vitamin_name' }),
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'vitamin',
        clicked_at: state.clicked_at, date: today, details: { name: text }, status: 'complete'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `💊 *${text}* logged at *${clickedTime}* ✅`);
    return true;
  }

  // 📝 NOTE
  if (state.action_type === 'note' && state.step === 'note_text') {
    await Promise.all([
      supabase.from('activity_logs').insert({
        date: today, time: clickedTime, activity: 'Note', notes: text, source: 'dashboard'
      }),
      supabase.from('caregiver_actions').insert({
        caregiver_name: senderName, action_type: 'note',
        clicked_at: state.clicked_at, date: today, details: { note: text }, status: 'complete'
      })
    ]);
    await clearConversationState(userId);
    await sendTelegram(chatId, `📝 Note saved at *${clickedTime}*: _${text}_ ✅`);
    return true;
  }

  return false;
}

// === AI HANDLERS (existing) ===

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
      system: `You are a helpful AI assistant in a family Telegram group. Today is ${today}, current time is ${nowTime}. You have access to Baby Johnson's care app (2 years old, Philippines).

You can do two things:
1. Answer ANY question or help with ANY topic — general knowledge, advice, recipes, parenting tips, language, math, anything. Use "chat" type for this.
2. Perform care app actions for Johnson — logging food, schedule, reminders, activities, etc.

Respond ONLY with valid JSON (no markdown):

Single action:
{
  "type": "chat" | "limitation" | "add_food" | "add_schedule" | "add_reminder" | "add_routine" | "add_activity" | "show_food" | "show_schedule" | "show_activity" | "show_preferences",
  "reply": "Your full answer here — for chat, write a complete helpful response",
  "data": {
    // add_food: { "name": "...", "food_type": "food|drink|snack", "portion": "...", "time": "HH:MM" }
    // add_schedule: { "time": "HH:MM", "activity": "..." }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // add_routine: { "time": "HH:MM", "activity": "..." }
    // add_activity: { "activity": "...", "time": "HH:MM", "notes": "..." }
    // show_activity: { "date_ref": "today" | "yesterday" }
    // show_preferences: { "pref_type": "like" | "dislike" | "all", "category": "food|drink|activity|all" }
    // limitation: { "title": "short feature name", "description": "what the user wants the app to do", "reason": "what triggered this" }
    // chat/others: {}
  }
}

Bulk app actions (2+ items at once):
{
  "type": "bulk",
  "reply": "Added X items! ...",
  "actions": [{ "type": "add_routine", "data": { "time": "07:00", "activity": "Breakfast" } }]
}

Rules:
- For general questions (weather, health tips, math, recipes, advice, etc.) — answer fully in "reply" using type "chat"
- Use "limitation" ONLY when the user asks for an app feature that doesn't exist yet (not for general knowledge questions)
- "add_routine" = repeats every day; "add_schedule" = today only
- Use "bulk" for 2+ app actions at once
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
  - preference: when someone mentions something Johnson likes/loves/enjoys OR hates/dislikes/doesn't like
  - context_reminder: a suggestion to do something specific WHENEVER a particular activity happens (e.g. "please eat with johnson when he eats", "dim the lights when he naps", "play soft music during bath time")
- A QUESTION asking about what Johnson did or likes:
  - query_food, query_vitamins, query_schedule, query_activity, query_preferences
- UNRELATED (none) — general chat not about Johnson's care

For context_reminder: identify the trigger activity and the reminder message.
  - trigger should be one of: "food" (any meal/eating), or a specific activity name like "Nap", "Bath", "Shower", "School", "Breakfast", "Lunch", "Dinner", "Sleep", "Playground"
  - message should be a short, friendly reminder to send to the group

Respond ONLY with valid JSON (no markdown):
{
  "type": "food" | "vitamin" | "schedule" | "activity" | "preference" | "context_reminder" | "query_food" | "query_vitamins" | "query_schedule" | "query_activity" | "query_preferences" | "none",
  "data": {
    // food: { "name": "...", "portion": "...", "food_type": "food|drink|snack", "time": "HH:MM or null", "notes": "..." }
    // vitamin: { "name": "...", "time": "HH:MM or null" }
    // schedule: { "activity": "...", "time": "HH:MM" }
    // activity: { "activity": "...", "time": "HH:MM or null", "notes": "..." }
    // preference: { "pref_type": "like" | "dislike", "item": "...", "category": "food|drink|activity|place|other" }
    // context_reminder: { "trigger": "food|Nap|Bath|School|Breakfast|Lunch|Dinner|Sleep|...", "message": "reminder text to send the group" }
    // query_activity: { "date_ref": "today" | "yesterday" }
    // query_preferences: { "pref_type": "like" | "dislike" | "all", "category": "food|drink|activity|all" }
    // others: {}
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

// === MAIN HANDLER ===

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const body = req.body;

  // ── Inline keyboard button taps ──────────────────────────────
  const callback = body?.callback_query;
  if (callback) {
    const data             = callback.data || '';
    const callbackChatId   = callback.message?.chat?.id?.toString();
    const messageId        = callback.message?.message_id;
    const responderName    = callback.from?.first_name || 'Someone';
    const responderUserId  = callback.from?.id?.toString();
    const pht              = new Date(Date.now() + 8 * 60 * 60 * 1000);

    // Dashboard callbacks
    if (data.startsWith('dash_')) {
      await answerCallback(callback.id, '');
      await handleDashboardCallback(data, callbackChatId, responderUserId, responderName, pht);
      return res.status(200).send('OK');
    }

    if (data.startsWith('ctx_yes_') || data.startsWith('ctx_no_')) {
      const ctxId    = data.startsWith('ctx_yes_') ? data.slice(8) : data.slice(7);
      const confirmed = data.startsWith('ctx_yes_');
      const { data: ctx } = await supabase.from('context_reminders').select('*').eq('id', ctxId).single();
      if (ctx) {
        if (confirmed) {
          await supabase.from('context_reminders').update({ active: true }).eq('id', ctxId);
          await answerCallback(callback.id, '✅ Reminder saved!');
          await editMessage(callbackChatId, messageId,
            `🔔 Got it! I'll remind everyone: _"${ctx.message}"_ whenever *${ctx.trigger === 'food' ? 'Johnson eats' : ctx.trigger + ' time'}* comes up.`
          );
        } else {
          await supabase.from('context_reminders').delete().eq('id', ctxId);
          await answerCallback(callback.id, 'OK, skipped!');
          await editMessage(callbackChatId, messageId, `_OK, reminder not saved._`);
        }
      }
      return res.status(200).send('OK');
    }

    if (data.startsWith('suggest_y_') || data.startsWith('suggest_n_')) {
      const sugId    = data.slice(10);
      const confirmed = data.startsWith('suggest_y_');
      if (confirmed) {
        await supabase.from('app_suggestions').update({ status: 'pending' }).eq('id', sugId);
        await answerCallback(callback.id, '✅ Added to recommendations!');
        await editMessage(callbackChatId, messageId, `💡 Got it! Added to the app recommendations. The developer will review it soon.`);
      } else {
        await supabase.from('app_suggestions').delete().eq('id', sugId);
        await answerCallback(callback.id, 'OK, skipped!');
        await editMessage(callbackChatId, messageId, `_OK, skipped._`);
      }
      return res.status(200).send('OK');
    }

    if (data.startsWith('pref_yes_') || data.startsWith('pref_no_')) {
      const prefId   = data.startsWith('pref_yes_') ? data.slice(9) : data.slice(8);
      const confirmed = data.startsWith('pref_yes_');
      const { data: pref } = await supabase.from('johnson_preferences').select('*').eq('id', prefId).single();
      if (pref) {
        if (confirmed) {
          await supabase.from('johnson_preferences').update({ status: 'confirmed' }).eq('id', prefId);
          await answerCallback(callback.id, '✅ Added to Johnson\'s preferences!');
          await editMessage(callbackChatId, messageId,
            `${pref.pref_type === 'like' ? '💛' : '🚫'} Got it! *${pref.item}* added to Johnson's ${pref.pref_type === 'like' ? 'favorites' : 'dislikes'}!`
          );
        } else {
          await supabase.from('johnson_preferences').update({ status: 'rejected' }).eq('id', prefId);
          await answerCallback(callback.id, 'OK, skipped!');
          await editMessage(callbackChatId, messageId, `_Skipped — not logged._`);
        }
      }
      return res.status(200).send('OK');
    }

    if (data.startsWith('done_') || data.startsWith('skip_')) {
      const firstUnder  = data.indexOf('_');
      const lastUnder   = data.lastIndexOf('_');
      const action      = data.slice(0, firstUnder);
      const scheduleId  = data.slice(firstUnder + 1, lastUnder);
      const date        = data.slice(lastUnder + 1);
      const completed   = action === 'done';

      const { data: schedItem } = await supabase
        .from('master_schedule').select('activity').eq('id', scheduleId).single();
      const activity = schedItem?.activity || 'Activity';

      await supabase.from('master_schedule_log')
        .update({ completed, responded_at: new Date().toISOString() })
        .eq('master_schedule_id', scheduleId)
        .eq('date', date);

      await answerCallback(callback.id, completed ? '✅ Marked as done!' : '⏰ Noted, will try later!');
      await editMessage(
        callbackChatId, messageId,
        completed
          ? `✅ *${activity}* — Done! Thanks ${responderName}! 🎉`
          : `⏰ *${activity}* — Not done yet. Noted by ${responderName}.`
      );
    }

    return res.status(200).send('OK');
  }

  const msg = body?.message;
  if (!msg) return res.status(200).send('OK');

  const chatId     = msg.chat?.id?.toString();
  const text       = msg.text || '';
  const caption    = msg.caption || '';
  const hasPhoto   = !!msg.photo;
  const pht        = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const today      = pht.toISOString().slice(0, 10);
  const nowTime    = pht.toISOString().slice(11, 16);
  const senderName = msg.from?.first_name || 'Someone';
  const userId     = msg.from?.id?.toString();

  if (chatId !== GROUP_ID) return res.status(200).send('OK');
  if (msg.from?.is_bot) return res.status(200).send('OK');

  const content = caption || text;
  if (!content && !hasPhoto) return res.status(200).send('OK');

  // ── /dashboard command — send and auto-pin ──────────────────
  if (text.toLowerCase().startsWith('/dashboard')) {
    const messageId = await sendDashboard(chatId);
    if (messageId) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true })
      });
    }
    return res.status(200).send('OK');
  }

  // ── Check for pending conversation state ─────────────────────
  const convState = await getConversationState(userId);
  if (convState) {
    // If user @mentions the bot while a state is pending, clear state and fall through to mention handling
    const botUsername = await getBotUsername();
    const entities    = msg.entities || msg.caption_entities || [];
    const isMentioned = entities
      .filter(e => e.type === 'mention')
      .some(e => content.slice(e.offset, e.offset + e.length).toLowerCase() === botUsername.toLowerCase());

    if (!isMentioned) {
      const handled = await handleConversationReply(convState, content, chatId, userId, senderName, today, nowTime);
      if (handled) return res.status(200).send('OK');
    } else {
      await clearConversationState(userId);
    }
  }

  // ── @mention handling ────────────────────────────────────────
  const botUsername = await getBotUsername();
  const entities    = msg.entities || msg.caption_entities || [];
  const isMentioned = entities
    .filter(e => e.type === 'mention')
    .some(e => content.slice(e.offset, e.offset + e.length).toLowerCase() === botUsername.toLowerCase());

  if (isMentioned) {
    const cleanMessage = content.replace(new RegExp(botUsername, 'gi'), '').trim();
    const action = await handleMention(cleanMessage || '(no message)', senderName, today, nowTime);

    if (action.type === 'bulk' && action.actions?.length) {
      let count = 0;
      for (const a of action.actions) {
        if (a.type === 'add_routine' && a.data?.activity) {
          await supabase.from('master_schedule').insert({
            time: a.data.time || '00:00', activity: a.data.activity,
            color: a.data.color || '#7F77DD', active: true
          });
          count++;
        } else if (a.type === 'add_schedule' && a.data?.activity) {
          await supabase.from('schedule').insert({
            date: today, time: a.data.time || '00:00',
            activity: a.data.activity, color: a.data.color || '#7F77DD', source: 'telegram'
          });
          count++;
        } else if (a.type === 'add_reminder' && a.data?.time && a.data?.message) {
          await supabase.from('reminders').insert({ time: a.data.time, message: a.data.message, active: true });
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
        date: today, time: action.data.time || nowTime,
        name: action.data.name, food_type: action.data.food_type || 'food',
        portion: action.data.portion || '', source: 'telegram'
      });
    }
    if (action.type === 'add_schedule' && action.data?.time && action.data?.activity) {
      await supabase.from('schedule').insert({
        date: today, time: action.data.time, activity: action.data.activity,
        color: '#7F77DD', source: 'telegram'
      });
    }
    if (action.type === 'add_reminder' && action.data?.time && action.data?.message) {
      await supabase.from('reminders').insert({
        time: action.data.time, message: action.data.message, active: true
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
    if (action.type === 'show_preferences') {
      const prefType = action.data?.pref_type || 'all';
      const category = action.data?.category || 'all';
      let query = supabase.from('johnson_preferences').select('*').eq('status', 'confirmed').order('created_at');
      if (prefType !== 'all') query = query.eq('pref_type', prefType);
      if (category !== 'all') query = query.eq('category', category);
      const { data: prefs } = await query;
      if (!prefs?.length) {
        await sendTelegram(chatId, `No ${prefType === 'all' ? '' : prefType + 's '}logged for Johnson yet!`);
      } else {
        const likes    = prefs.filter(p => p.pref_type === 'like');
        const dislikes = prefs.filter(p => p.pref_type === 'dislike');
        let m = `💛 *Johnson's preferences:*\n`;
        if (likes.length)    m += `\n*Loves:*\n${likes.map(p => `• ${p.item} _(${p.category})_`).join('\n')}`;
        if (dislikes.length) m += `\n\n*Doesn't like:*\n${dislikes.map(p => `• ${p.item} _(${p.category})_`).join('\n')}`;
        await sendTelegram(chatId, m);
      }
      return res.status(200).send('OK');
    }
    if (action.type === 'add_activity' && action.data?.activity) {
      await supabase.from('activity_logs').insert({
        date: today, time: action.data.time || nowTime,
        activity: action.data.activity, notes: action.data.notes || '', source: 'telegram'
      });
    }
    if (action.type === 'show_activity') {
      const queryDate = action.data?.date_ref === 'yesterday'
        ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : today;
      const { data: acts } = await supabase.from('activity_logs').select('*').eq('date', queryDate).order('time');
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
        ...(sched   || []).map(s => ({ time: s.time, activity: s.activity + ' _(today only)_' }))
      ].sort((a, b) => a.time.localeCompare(b.time));
      if (!allItems.length) {
        await sendTelegram(chatId, "No schedule items for today! 📅");
      } else {
        const list = allItems.map(s => `• ${s.time} — ${s.activity}`).join('\n');
        await sendTelegram(chatId, `📋 *Johnson's schedule today:*\n\n${list}`);
      }
      return res.status(200).send('OK');
    }
    if (action.type === 'limitation') {
      await sendTelegram(chatId, action.reply || "I can't do that yet!");
      const { data: inserted } = await supabase.from('app_suggestions').insert({
        priority: 'medium', category: 'new_feature',
        title: action.data?.title || 'Feature request from chat',
        description: action.data?.description || action.reply || '',
        reason: action.data?.reason || `Requested by ${senderName} in group chat`,
        status: 'draft'
      }).select().single();
      if (inserted) {
        await sendWithButtons(chatId,
          `💡 Want me to add *"${action.data?.title || 'this feature'}"* to the app recommendations for the next update?`,
          [[
            { text: '✅ Yes, recommend it', callback_data: `suggest_y_${inserted.id}` },
            { text: '❌ No thanks',          callback_data: `suggest_n_${inserted.id}` }
          ]]
        );
      }
      return res.status(200).send('OK');
    }

    await sendTelegram(chatId, action.reply || "✅ Done!");
    return res.status(200).send('OK');
  }

  // ── Passive message parsing ──────────────────────────────────
  const parsed = await parseMessageWithAI(content, hasPhoto ? caption : null);

  if (parsed.type === 'food' && parsed.data?.name) {
    await supabase.from('food_logs').insert({
      date: today, time: parsed.data.time || nowTime,
      name: parsed.data.name, food_type: parsed.data.food_type || 'food',
      portion: parsed.data.portion || '', notes: parsed.data.notes || '', source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
    const { data: ctxFood } = await supabase.from('context_reminders').select('*').eq('trigger', 'food').eq('active', true);
    for (const c of ctxFood || []) await sendTelegram(chatId, `🔔 *Reminder:* ${c.message}`);
  }

  else if (parsed.type === 'vitamin' && parsed.data?.name) {
    await supabase.from('vitamin_logs').upsert({
      date: today, vitamin_name: parsed.data.name, taken: true,
      time_taken: parsed.data.time || nowTime, source: 'telegram'
    }, { onConflict: 'date,vitamin_name' });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
  }

  else if (parsed.type === 'schedule' && parsed.data?.activity) {
    await supabase.from('schedule').insert({
      time: parsed.data.time, activity: parsed.data.activity, date: today, source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `📅 ${parsed.confirmation}`);
  }

  else if (parsed.type === 'context_reminder' && parsed.data?.message) {
    const trigger = parsed.data.trigger || 'food';
    const { data: inserted } = await supabase.from('context_reminders').insert({
      trigger, message: parsed.data.message, active: false
    }).select().single();
    if (inserted) {
      const triggerLabel = trigger === 'food' ? 'Johnson eats' : `${trigger} time`;
      await sendWithButtons(chatId,
        `🔔 Got it! Want me to remind everyone:\n\n_"${parsed.data.message}"_\n\n...every time *${triggerLabel}*?`,
        [[
          { text: '✅ Yes, set this reminder', callback_data: `ctx_yes_${inserted.id}` },
          { text: '❌ No thanks',              callback_data: `ctx_no_${inserted.id}` }
        ]]
      );
    }
  }

  else if (parsed.type === 'preference' && parsed.data?.item) {
    const { data: inserted } = await supabase.from('johnson_preferences').insert({
      pref_type: parsed.data.pref_type || 'like',
      category:  parsed.data.category  || 'food',
      item:      parsed.data.item,
      status:    'pending'
    }).select().single();
    if (inserted) {
      const emoji = parsed.data.pref_type === 'dislike' ? '🚫' : '💛';
      const label = parsed.data.pref_type === 'dislike' ? 'dislike' : 'favorite';
      await sendWithButtons(chatId,
        `${emoji} It sounds like Johnson *${parsed.data.pref_type === 'dislike' ? "doesn't like" : 'loves'}* *${parsed.data.item}*!\n\nWant me to add that to his ${label} log?`,
        [[
          { text: `✅ Yes, add to ${label}s`, callback_data: `pref_yes_${inserted.id}` },
          { text: '❌ No thanks',             callback_data: `pref_no_${inserted.id}` }
        ]]
      );
    }
  }

  else if (parsed.type === 'activity' && parsed.data?.activity) {
    await supabase.from('activity_logs').insert({
      date: today, time: parsed.data.time || nowTime,
      activity: parsed.data.activity, notes: parsed.data.notes || '', source: 'telegram'
    });
    if (parsed.confirmation) await sendTelegram(chatId, `✅ ${parsed.confirmation}`);
  }

  else if (parsed.type === 'query_food') {
    const { data: foods } = await supabase.from('food_logs').select('*').eq('date', today).order('time');
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
    const { data: vits } = await supabase.from('vitamin_logs').select('*').eq('date', today).eq('taken', true);
    if (!vits?.length) {
      await sendTelegram(chatId, "No vitamins logged for Johnson today! 💊");
    } else {
      const list = vits.map(v => `✅ ${v.vitamin_name}${v.time_taken ? ' at ' + v.time_taken : ''}`).join('\n');
      await sendTelegram(chatId, `💊 *Johnson's vitamins today:*\n\n${list}`);
    }
  }

  else if (parsed.type === 'query_preferences') {
    const prefType = parsed.data?.pref_type || 'all';
    const category = parsed.data?.category  || 'all';
    let query = supabase.from('johnson_preferences').select('*').eq('status', 'confirmed').order('created_at');
    if (prefType !== 'all') query = query.eq('pref_type', prefType);
    if (category !== 'all') query = query.eq('category', category);
    const { data: prefs } = await query;
    if (!prefs?.length) {
      await sendTelegram(chatId, `No preferences logged for Johnson yet! Try saying something like "Johnson loves chicken" or "Johnson doesn't like bitter melon".`);
    } else {
      const likes    = prefs.filter(p => p.pref_type === 'like');
      const dislikes = prefs.filter(p => p.pref_type === 'dislike');
      let m = `💛 *Johnson's preferences:*`;
      if (likes.length)    m += `\n\n*Loves:*\n${likes.map(p => `• ${p.item} _(${p.category})_`).join('\n')}`;
      if (dislikes.length) m += `\n\n*Doesn't like:*\n${dislikes.map(p => `• ${p.item} _(${p.category})_`).join('\n')}`;
      await sendTelegram(chatId, m);
    }
  }

  else if (parsed.type === 'query_activity') {
    const dateRef   = parsed.data?.date_ref || 'today';
    const queryDate = dateRef === 'yesterday'
      ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : today;
    const { data: acts } = await supabase.from('activity_logs').select('*').eq('date', queryDate).order('time');
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
      ...(sched   || []).map(s => ({ time: s.time, activity: s.activity }))
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

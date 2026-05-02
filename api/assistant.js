import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const today = pht.toISOString().slice(0, 10);
  const nowTime = pht.toISOString().slice(11, 16);
  const msgLower = message.toLowerCase();

  // Detect query intent directly — don't rely on Claude for these
  const isQuery = /\b(what|show|tell|check|see|list|how)\b/.test(msgLower);
  if (isQuery && /\b(schedule|routine|plan|activity|activities)\b/.test(msgLower)) {
    const [{ data: sched }, { data: routine }] = await Promise.all([
      supabase.from('schedule').select('*').eq('date', today).order('time'),
      supabase.from('master_schedule').select('*').eq('active', true).order('time')
    ]);
    const allItems = [
      ...(routine || []).map(r => ({ time: r.time, activity: r.activity })),
      ...(sched || []).map(s => ({ time: s.time, activity: s.activity }))
    ].sort((a, b) => a.time.localeCompare(b.time));
    const reply = allItems.length
      ? `📋 Johnson's schedule today:\n\n${allItems.map(s => `• ${s.time} — ${s.activity}`).join('\n')}`
      : 'No schedule items for today!';
    return res.status(200).json({ type: 'show_schedule', reply });
  }
  if (isQuery && /\b(eat|ate|food|meal|drink|snack|lunch|dinner|breakfast)\b/.test(msgLower)) {
    const { data: foods } = await supabase.from('food_logs').select('*').eq('date', today).order('time');
    const reply = foods?.length
      ? `🍽️ Johnson's food today:\n\n${foods.map(f => `• ${f.time || '?'} — ${f.name}${f.portion ? ' (' + f.portion + ')' : ''}`).join('\n')}`
      : "Nothing logged for Johnson today yet!";
    return res.status(200).json({ type: 'show_food', reply });
  }
  if (isQuery && /\b(activity|activities|do|did|done)\b/.test(msgLower)) {
    const queryDate = /\byesterday\b/.test(msgLower)
      ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      : today;
    const { data: acts } = await supabase.from('activity_logs').select('*').eq('date', queryDate).order('time');
    const reply = acts?.length
      ? `📋 Johnson's activities on ${queryDate}:\n\n${acts.map(a => `• ${a.time || '?'} — ${a.activity}${a.notes ? ' (' + a.notes + ')' : ''}`).join('\n')}`
      : `No activities logged for Johnson on ${queryDate}!`;
    return res.status(200).json({ type: 'show_activity', reply });
  }
  if (isQuery && /\b(vitamin|vitamins|supplement)\b/.test(msgLower)) {
    const { data: vits } = await supabase.from('vitamin_logs').select('*').eq('date', today).eq('taken', true);
    const reply = vits?.length
      ? `💊 Johnson's vitamins today:\n\n${vits.map(v => `✅ ${v.vitamin_name}${v.time_taken ? ' at ' + v.time_taken : ''}`).join('\n')}`
      : 'No vitamins logged for today!';
    return res.status(200).json({ type: 'show_vitamins', reply });
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: `You are an AI assistant for Baby Johnson's care app. Today is ${today}, current time is ${nowTime}.

Single action:
{
  "type": "add_food" | "add_vitamin" | "add_schedule" | "add_reminder" | "add_routine" | "add_activity" | "show_schedule" | "show_food" | "show_vitamins" | "show_routine" | "show_activity" | "chat",
  "reply": "Short friendly confirmation or answer",
  "data": {
    // add_food: { "name": "...", "food_type": "food|drink|snack", "portion": "...", "time": "HH:MM" }
    // add_vitamin: { "name": "..." }
    // add_schedule: { "time": "HH:MM", "activity": "...", "color": "#7F77DD" }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // add_routine: { "time": "HH:MM", "activity": "...", "color": "#7F77DD" }
    // add_activity: { "activity": "...", "time": "HH:MM", "notes": "..." }
    // show_activity: { "date_ref": "today" | "yesterday" }
    // show_*: {}
    // chat: {}
  }
}

BULK input (2 or more activities at once):
{
  "type": "bulk",
  "reply": "Added X items! ...",
  "actions": [
    { "type": "add_routine", "data": { "time": "07:00", "activity": "Breakfast" } }
  ]
}

Rules:
- Use "bulk" whenever the user provides 2+ activities
- For time ranges like "8:00–9:00", use start time "08:00"
- For activities with no time, make a reasonable estimate from context
- "add_routine" = repeats every day; "add_schedule" = today only
- Use show_schedule when asked about today's schedule or what's planned
- Use show_routine when asked about the master/daily routine
- Use show_food when asked what Johnson ate today
- Use show_vitamins when asked about vitamins today
- Use add_activity for any action Johnson did (bath, brushing teeth, playing, sleeping, etc.)
- Use show_activity when asked what Johnson did or his activities
- Respond ONLY with valid JSON, no markdown`,
      messages: [{ role: 'user', content: message }]
    })
  });

  const d = await r.json();
  if (d.error) return res.status(200).json({ type: 'chat', reply: `⚠️ ${d.error.message}`, data: {} });

  const txt = d.content?.[0]?.text || '{}';
  let parsed;
  try {
    parsed = JSON.parse(txt.replace(/```json|```/g, '').trim());
  } catch {
    return res.status(200).json({ type: 'chat', reply: txt, data: {} });
  }

  if (parsed.type === 'bulk' && parsed.actions?.length) {
    let count = 0;
    for (const a of parsed.actions) {
      if (a.type === 'add_routine' && a.data?.activity) {
        await supabase.from('master_schedule').insert({ time: a.data.time || '00:00', activity: a.data.activity, color: a.data.color || '#7F77DD', active: true });
        count++;
      } else if (a.type === 'add_schedule' && a.data?.activity) {
        await supabase.from('schedule').insert({ date: today, time: a.data.time || '00:00', activity: a.data.activity, color: a.data.color || '#7F77DD', source: 'app' });
        count++;
      } else if (a.type === 'add_reminder' && a.data?.time && a.data?.message) {
        await supabase.from('reminders').insert({ time: a.data.time, message: a.data.message, active: true });
        count++;
      } else if (a.type === 'add_food' && a.data?.name) {
        await supabase.from('food_logs').insert({ date: today, time: a.data.time || nowTime, name: a.data.name, food_type: a.data.food_type || 'food', portion: a.data.portion || '', source: 'app' });
        count++;
      } else if (a.type === 'add_vitamin' && a.data?.name) {
        await supabase.from('vitamin_logs').upsert({ date: today, vitamin_name: a.data.name, taken: true, time_taken: nowTime, source: 'app' }, { onConflict: 'date,vitamin_name' });
        count++;
      }
    }
    return res.status(200).json({ type: 'bulk', reply: parsed.reply || `✅ Added ${count} items!` });
  }

  if (parsed.type === 'add_food' && parsed.data?.name) {
    await supabase.from('food_logs').insert({
      date: today, time: parsed.data.time || nowTime,
      name: parsed.data.name, food_type: parsed.data.food_type || 'food',
      portion: parsed.data.portion || '', source: 'app'
    });
  }

  if (parsed.type === 'add_vitamin' && parsed.data?.name) {
    await supabase.from('vitamin_logs').upsert({
      date: today, vitamin_name: parsed.data.name,
      taken: true, time_taken: nowTime, source: 'app'
    }, { onConflict: 'date,vitamin_name' });
  }

  if (parsed.type === 'add_schedule' && parsed.data?.time && parsed.data?.activity) {
    await supabase.from('schedule').insert({
      date: today, time: parsed.data.time, activity: parsed.data.activity,
      color: parsed.data.color || '#7F77DD', source: 'app'
    });
  }

  if (parsed.type === 'add_reminder' && parsed.data?.time && parsed.data?.message) {
    await supabase.from('reminders').insert({
      time: parsed.data.time, message: parsed.data.message, active: true
    });
  }

  if (parsed.type === 'add_routine' && parsed.data?.time && parsed.data?.activity) {
    await supabase.from('master_schedule').insert({
      time: parsed.data.time, activity: parsed.data.activity,
      color: parsed.data.color || '#7F77DD', active: true
    });
  }

  if (parsed.type === 'add_activity' && parsed.data?.activity) {
    await supabase.from('activity_logs').insert({
      date: today, time: parsed.data.time || nowTime,
      activity: parsed.data.activity, notes: parsed.data.notes || '', source: 'app'
    });
  }

  if (parsed.type === 'show_activity') {
    const queryDate = parsed.data?.date_ref === 'yesterday'
      ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      : today;
    const { data: acts } = await supabase.from('activity_logs').select('*').eq('date', queryDate).order('time');
    const reply = acts?.length
      ? `📋 Johnson's activities on ${queryDate}:\n\n${acts.map(a => `• ${a.time || '?'} — ${a.activity}${a.notes ? ' (' + a.notes + ')' : ''}`).join('\n')}`
      : `No activities logged for Johnson on ${queryDate}!`;
    return res.status(200).json({ type: 'show_activity', reply });
  }

  if (parsed.type === 'show_schedule') {
    const [{ data: sched }, { data: routine }] = await Promise.all([
      supabase.from('schedule').select('*').eq('date', today).order('time'),
      supabase.from('master_schedule').select('*').eq('active', true).order('time')
    ]);
    const allItems = [
      ...(routine || []).map(r => ({ time: r.time, activity: r.activity })),
      ...(sched || []).map(s => ({ time: s.time, activity: s.activity }))
    ].sort((a, b) => a.time.localeCompare(b.time));
    const reply = allItems.length
      ? `📋 Johnson's schedule today:\n\n${allItems.map(s => `• ${s.time} — ${s.activity}`).join('\n')}`
      : 'No schedule items for today!';
    return res.status(200).json({ type: 'show_schedule', reply });
  }

  if (parsed.type === 'show_routine') {
    const { data: routine } = await supabase.from('master_schedule').select('*').eq('active', true).order('time');
    const reply = routine?.length
      ? `📋 Johnson's daily routine:\n\n${routine.map(r => `• ${r.time} — ${r.activity}`).join('\n')}`
      : 'No routine items set yet!';
    return res.status(200).json({ type: 'show_routine', reply });
  }

  if (parsed.type === 'show_food') {
    const { data: foods } = await supabase.from('food_logs').select('*').eq('date', today).order('time');
    const reply = foods?.length
      ? `🍽️ Johnson's food today:\n\n${foods.map(f => `• ${f.time || '?'} — ${f.name}${f.portion ? ' (' + f.portion + ')' : ''}`).join('\n')}`
      : "Nothing logged for Johnson today yet!";
    return res.status(200).json({ type: 'show_food', reply });
  }

  if (parsed.type === 'show_vitamins') {
    const { data: vits } = await supabase.from('vitamin_logs').select('*').eq('date', today).eq('taken', true);
    const reply = vits?.length
      ? `💊 Johnson's vitamins today:\n\n${vits.map(v => `✅ ${v.vitamin_name}${v.time_taken ? ' at ' + v.time_taken : ''}`).join('\n')}`
      : 'No vitamins logged for today!';
    return res.status(200).json({ type: 'show_vitamins', reply });
  }

  return res.status(200).json(parsed);
}

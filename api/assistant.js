import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toTimeString().slice(0, 5);

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
  "type": "add_food" | "add_vitamin" | "add_schedule" | "add_reminder" | "add_routine" | "chat",
  "reply": "Short friendly confirmation or answer",
  "data": {
    // add_food: { "name": "...", "food_type": "food|drink|snack", "portion": "...", "time": "HH:MM" }
    // add_vitamin: { "name": "..." }
    // add_schedule: { "time": "HH:MM", "activity": "...", "color": "#7F77DD" }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // add_routine: { "time": "HH:MM", "activity": "...", "color": "#7F77DD" }
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
        await supabase.from('schedule').insert({ time: a.data.time || '00:00', activity: a.data.activity, color: a.data.color || '#7F77DD', source: 'app' });
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
      time: parsed.data.time, activity: parsed.data.activity,
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

  return res.status(200).json(parsed);
}

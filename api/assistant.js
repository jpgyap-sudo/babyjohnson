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
      max_tokens: 400,
      system: `You are an assistant for Baby Johnson's care schedule app. Today is ${today}, current time is ${nowTime}.
You help add schedule items and reminders. Be concise and friendly.

Respond ONLY with valid JSON (no markdown):
{
  "type": "add_schedule" | "add_reminder" | "chat",
  "reply": "Short friendly message to show the user",
  "data": {
    // add_schedule: { "time": "HH:MM", "activity": "...", "color": "#7F77DD" }
    // add_reminder: { "time": "HH:MM", "message": "..." }
    // chat: {}
  }
}`,
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

  if (parsed.type === 'add_schedule' && parsed.data?.time && parsed.data?.activity) {
    await supabase.from('schedule').insert({
      time: parsed.data.time,
      activity: parsed.data.activity,
      color: parsed.data.color || '#7F77DD',
      source: 'app'
    });
  }

  if (parsed.type === 'add_reminder' && parsed.data?.time && parsed.data?.message) {
    await supabase.from('reminders').insert({
      time: parsed.data.time,
      message: parsed.data.message,
      active: true
    });
  }

  return res.status(200).json(parsed);
}

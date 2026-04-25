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
  const pht = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const today = pht.toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() + 8 * 60 * 60 * 1000 - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [
    { data: foods },
    { data: vitamins },
    { data: schedules },
    { data: routineLogs },
    { data: profile }
  ] = await Promise.all([
    supabase.from('food_logs').select('*').gte('date', weekAgo).order('date').order('time'),
    supabase.from('vitamin_logs').select('*').gte('date', weekAgo).eq('taken', true),
    supabase.from('schedule').select('*').gte('date', weekAgo).order('date').order('time'),
    supabase.from('master_schedule_log').select('*').gte('date', weekAgo),
    supabase.from('johnson_profile').select('*').order('updated_at', { ascending: false })
  ]);

  const existingProfile = (profile || []).map(p => `[${p.category}] ${p.fact}`).join('\n') || 'No profile yet';

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: `You are an intelligent care assistant analyzing one week of data for Baby Johnson (2 years old in the Philippines). Your job is to:
1. Find meaningful patterns in his food, sleep, vitamins, and routine
2. Update his personal profile with new facts you've learned
3. Suggest specific, practical improvements to the care app based on what's actually being used
4. Write a warm weekly summary for the family

Respond ONLY with valid JSON:
{
  "weekly_summary": "2-3 friendly sentences about Johnson's week",
  "highlights": ["short highlight 1", "short highlight 2", "short highlight 3"],
  "profile_updates": [
    { "category": "food_preference|sleep_pattern|behavior|health|routine|development", "fact": "specific observable fact", "confidence": "low|medium|high" }
  ],
  "app_suggestions": [
    {
      "priority": "low|medium|high",
      "category": "new_feature|improvement|insight",
      "title": "Short title",
      "description": "What to build and why — be specific enough that a developer can implement it",
      "reason": "What data pattern triggered this suggestion"
    }
  ]
}`,
      messages: [{
        role: 'user',
        content: `Analysis period: ${weekAgo} to ${today}

FOOD LOGS (${foods?.length || 0} entries):
${(foods || []).map(f => `${f.date} ${f.time||'?'} - ${f.name} [${f.food_type}]${f.portion ? ' ' + f.portion : ''}${f.notes ? ' — ' + f.notes : ''}`).join('\n') || 'None'}

VITAMINS TAKEN (${vitamins?.length || 0} entries):
${(vitamins || []).map(v => `${v.date} ${v.time_taken||'?'} - ${v.vitamin_name}`).join('\n') || 'None'}

SCHEDULE ENTRIES (${schedules?.length || 0}):
${(schedules || []).map(s => `${s.date} ${s.time||'?'} - ${s.activity} [source: ${s.source}]`).join('\n') || 'None'}

DAILY ROUTINE COMPLETION (${routineLogs?.length || 0} entries):
${(routineLogs || []).map(l => `${l.date} - "${l.activity}": ${l.completed === null ? 'no response' : l.completed ? '✅ done' : '❌ skipped'}`).join('\n') || 'None'}

JOHNSON'S CURRENT PROFILE:
${existingProfile}`
      }]
    })
  });

  const d = await r.json();
  if (d.error) return res.status(500).json({ error: d.error.message });

  const txt = d.content?.[0]?.text || '{}';
  let analysis;
  try { analysis = JSON.parse(txt.replace(/```json|```/g, '').trim()); }
  catch { return res.status(500).json({ error: 'Parse failed', raw: txt }); }

  // Save profile updates (upsert to avoid duplicates)
  for (const u of analysis.profile_updates || []) {
    await supabase.from('johnson_profile').upsert({
      category: u.category,
      fact: u.fact,
      confidence: u.confidence,
      updated_at: new Date().toISOString()
    }, { onConflict: 'category,fact' });
  }

  // Save app suggestions
  for (const s of analysis.app_suggestions || []) {
    await supabase.from('app_suggestions').insert({
      priority: s.priority,
      category: s.category,
      title: s.title,
      description: s.description,
      reason: s.reason,
      status: 'pending'
    });
  }

  // Build Telegram report
  const highlights = (analysis.highlights || []).map(h => `• ${h}`).join('\n');
  const highSuggestions = (analysis.app_suggestions || []).filter(s => s.priority === 'high');
  const medSuggestions = (analysis.app_suggestions || []).filter(s => s.priority === 'medium');

  let msg = `📊 *Johnson's Weekly Intelligence Report*\n_${weekAgo} → ${today}_\n\n`;
  msg += `${analysis.weekly_summary}\n\n`;
  if (highlights) msg += `*This week:*\n${highlights}\n\n`;
  if (highSuggestions.length || medSuggestions.length) {
    msg += `*App improvements the bot is recommending:*\n`;
    [...highSuggestions, ...medSuggestions].forEach(s => {
      const dot = s.priority === 'high' ? '🔴' : '🟡';
      msg += `${dot} *${s.title}*\n   _${s.reason}_\n`;
    });
    msg += `\n_Open the app → Insights tab to review and dismiss suggestions._`;
  }

  await sendTelegram(msg);

  return res.status(200).json({
    success: true,
    profile_updates: analysis.profile_updates?.length || 0,
    suggestions: analysis.app_suggestions?.length || 0
  });
}

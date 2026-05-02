import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const results = {};

  // ── Env vars (safe partial values) ──────────────────────────
  results.env = {
    SUPABASE_URL:             process.env.SUPABASE_URL             ? process.env.SUPABASE_URL.slice(0, 30) + '...' : 'NOT SET',
    SUPABASE_SERVICE_KEY:     process.env.SUPABASE_SERVICE_KEY     ? process.env.SUPABASE_SERVICE_KEY.slice(0, 10) + '...' : 'NOT SET',
    ANTHROPIC_API_KEY:        process.env.ANTHROPIC_API_KEY        ? process.env.ANTHROPIC_API_KEY.slice(0, 10) + '...' : 'NOT SET',
    TELEGRAM_BOT_TOKEN:       process.env.TELEGRAM_BOT_TOKEN       ? process.env.TELEGRAM_BOT_TOKEN.slice(0, 10) + '...' : 'NOT SET',
    TELEGRAM_GROUP_CHAT_ID:   process.env.TELEGRAM_GROUP_CHAT_ID   || 'NOT SET',
  };

  // ── Supabase connectivity ────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from('master_schedule')
      .select('time, activity')
      .eq('active', true)
      .order('time');
    results.supabase = { ok: !error, rows: data?.length ?? 0, error: error?.message || null };
  } catch (e) {
    results.supabase = { ok: false, error: e.message };
  }

  // ── New dashboard tables ─────────────────────────────────────
  try {
    const { error: e1 } = await supabase.from('conversation_state').select('id').limit(1);
    const { error: e2 } = await supabase.from('caregiver_actions').select('id').limit(1);
    results.dashboard_tables = {
      conversation_state: e1 ? `MISSING — ${e1.message}` : 'OK',
      caregiver_actions:  e2 ? `MISSING — ${e2.message}` : 'OK',
    };
  } catch (e) {
    results.dashboard_tables = { error: e.message };
  }

  // Core feature table checks
  const featureTables = [
    'food_logs',
    'vitamins',
    'vitamin_logs',
    'activity_logs',
    'schedule',
    'master_schedule',
    'master_schedule_log',
    'reminders',
    'context_reminders',
    'johnson_preferences',
    'johnson_profile',
    'meal_plans',
    'app_suggestions'
  ];

  results.feature_tables = {};
  for (const table of featureTables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      results.feature_tables[table] = error ? `ERROR - ${error.message}` : `OK (${count ?? 0})`;
    } catch (e) {
      results.feature_tables[table] = `ERROR - ${e.message}`;
    }
  }

  try {
    const { error } = await supabase.from('master_schedule_log').select('activity').limit(1);
    results.schema_checks = {
      master_schedule_log_activity: error ? `MISSING - ${error.message}` : 'OK'
    };
  } catch (e) {
    results.schema_checks = { master_schedule_log_activity: `ERROR - ${e.message}` };
  }

  // Telegram bot identity
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GROUP_ID  = process.env.TELEGRAM_GROUP_CHAT_ID;

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const d = await r.json();
    results.telegram_bot = { ok: d.ok, username: d.result?.username, id: d.result?.id, error: d.description || null };
  } catch (e) {
    results.telegram_bot = { ok: false, error: e.message };
  }

  // ── Send test message to group ───────────────────────────────
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: GROUP_ID, text: '🔧 Debug ping — bot can send to this group!' })
    });
    const d = await r.json();
    results.telegram_send = { ok: d.ok, message_id: d.result?.message_id, error: d.description || null };
  } catch (e) {
    results.telegram_send = { ok: false, error: e.message };
  }

  return res.status(200).json(results);
}

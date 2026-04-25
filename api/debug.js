import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL || 'NOT SET';
  const keySnippet = (process.env.SUPABASE_SERVICE_KEY || 'NOT SET').slice(0, 20);

  const { data, error } = await supabase
    .from('master_schedule')
    .select('time, activity')
    .eq('active', true)
    .order('time');

  return res.status(200).json({
    supabase_url: url,
    key_prefix: keySnippet,
    rows: data?.length ?? 0,
    data: data || null,
    error: error?.message || null
  });
}

import { supabase } from '../lib/supabase.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const { data: prefs } = await supabase
    .from('johnson_preferences')
    .select('pref_type, item, category')
    .eq('status', 'confirmed');

  const likes = (prefs || []).filter(p => p.pref_type === 'like').map(p => p.item);
  const dislikes = (prefs || []).filter(p => p.pref_type === 'dislike').map(p => p.item);

  const prefContext = [
    likes.length ? `Johnson loves: ${likes.join(', ')}.` : '',
    dislikes.length ? `Johnson dislikes (avoid): ${dislikes.join(', ')}.` : ''
  ].filter(Boolean).join(' ');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a pediatric nutritionist. Give a simple healthy recipe for a 2-year-old toddler named Johnson.${prefContext ? ' ' + prefContext : ''} Request: "${prompt}". Include: recipe name, ingredients with amounts, and simple cooking steps. Keep it soft, safe, nutritious. Incorporate his favorites when relevant and avoid his dislikes. Be concise.`
      }]
    })
  });

  const d = await r.json();
  const text = d.content?.map(x => x.text || '').join('') || '';
  return res.status(200).json({ text });
}

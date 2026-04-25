const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a pediatric nutritionist. Give a simple healthy recipe for a 2-year-old toddler named Johnson. Request: "${prompt}". Include: recipe name, ingredients with amounts, and simple cooking steps. Keep it soft, safe, nutritious. Be concise.`
      }]
    })
  });

  const d = await r.json();
  const text = d.content?.map(x => x.text || '').join('') || '';
  return res.status(200).json({ text });
}

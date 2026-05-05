// Ophelia Thinking MCP — Cloudflare Worker
// POST /think  {goal, platform, context, currentState}
//   → {reasoning, plan: [...steps], caveats: [...]}
//
// Uses Claude Sonnet with extended thinking (budget_tokens: 5000).
// Results cached in KV with 1hr TTL keyed by SHA-256(goal+platform).

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors();
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const path = new URL(request.url).pathname;
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }

    try {
      if (path === '/think') return await handleThink(body, env);
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('thinking-mcp error:', err.message);
      return json({ error: err.message }, 500);
    }
  }
};

async function handleThink({ goal, platform, context, currentState }, env) {
  if (!goal) return json({ error: 'goal is required' }, 400);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  // ── KV cache (1hr TTL) ────────────────────────────────────────────────────
  const cacheKey = 'think:' + await sha256(`${goal}|${platform || ''}`);
  if (env.THINK_CACHE) {
    const cached = await env.THINK_CACHE.get(cacheKey);
    if (cached) {
      console.log('think cache hit:', cacheKey);
      return json({ ...JSON.parse(cached), cached: true });
    }
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const contextStr = context   ? `\n\nCurrent context: ${context}` : '';
  const stateStr   = currentState ? `\n\nCurrent page state: ${currentState}` : '';
  const platformStr = platform ? ` on ${platform}` : '';

  const userMsg =
    `Goal: "${goal}"${platformStr}${contextStr}${stateStr}\n\n` +
    `Think through this goal carefully, then output a JSON object with this exact structure:\n` +
    `{\n` +
    `  "reasoning": "1-2 sentence summary of your approach",\n` +
    `  "plan": ["step 1", "step 2", ...],\n` +
    `  "caveats": ["potential issue 1", ...]\n` +
    `}\n\n` +
    `Each plan step must be a short, specific browser action (max 12 words). No prose outside the JSON.`;

  // ── Call Anthropic with extended thinking ─────────────────────────────────
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'interleaved-thinking-2025-05-14',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 8000,
      thinking:   { type: 'enabled', budget_tokens: 5000 },
      messages:   [{ role: 'user', content: userMsg }],
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(`Anthropic error ${upstream.status}: ${JSON.stringify(err)}`);
  }

  const data = await upstream.json();

  // Extract only text blocks (skip thinking blocks)
  const textBlock = data.content?.find(b => b.type === 'text');
  const raw = textBlock?.text || '';
  console.log('thinking-mcp raw:', raw.substring(0, 300));

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in thinking response');

  let result;
  try {
    result = JSON.parse(match[0]);
  } catch (_) {
    throw new Error('Invalid JSON in thinking response');
  }

  // Normalize shape
  if (!Array.isArray(result.plan))     result.plan     = [];
  if (!Array.isArray(result.caveats))  result.caveats  = [];
  if (!result.reasoning)               result.reasoning = '';

  // Cache for 1hr
  if (env.THINK_CACHE && result.plan.length) {
    await env.THINK_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
  }

  return json(result);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  });
}

// Cloudflare Worker — Gemini + Claude API Proxy
// Routes:
//   POST /        → Gemini (existing, used by tutor)
//   POST /claude  → Claude Sonnet (used by Ophelia Assistant planner)

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleCORS();

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const path = new URL(request.url).pathname;

    try {
      if (path === '/claude') {
        return await handleClaude(request, env);
      }
      return await handleGemini(request, env);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

// ── Claude Sonnet handler ─────────────────────────────────────────────────────

async function handleClaude(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await request.json();

  const claudeBody = {
    model:      body.model      || 'claude-sonnet-4-5',
    max_tokens: body.max_tokens || 1500,
    messages:   body.messages
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(claudeBody)
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}

// ── Gemini handler (unchanged) ────────────────────────────────────────────────

async function handleGemini(request, env) {
  const geminiApiKey = env.GEMINI_API_KEY;
  if (!geminiApiKey) return jsonResponse({ error: 'GEMINI_API_KEY not configured' }, 500);

  const body = await request.json();

  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

  const requestBody = {
    contents: body.contents,
    generationConfig: body.generationConfig || {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048
    }
  };

  const response = await fetch(`${geminiUrl}?key=${geminiApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  return jsonResponse(data, response.status);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

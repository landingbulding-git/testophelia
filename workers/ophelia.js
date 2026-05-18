// Cloudflare Worker — Ophelia API Gateway
// Routes:
//   POST /           → Gemini (legacy tutor route)
//   POST /claude     → Claude Sonnet streaming (co-pilot)
//   POST /tts        → ElevenLabs TTS — returns audio/mpeg
//   POST /computer-use → Claude Computer Use — pixel-exact element location
//   POST /transcribe-token → AssemblyAI real-time token
//   POST /think      → Claude extended thinking — goal planning
//   POST /guide      → Save guide to KV → { id, shareUrl }
//   GET  /guide/:id  → Fetch guide from KV

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleCORS();

    const path = new URL(request.url).pathname;

    // GET routes (no POST check)
    if (request.method === 'GET') {
      if (path.startsWith('/guide/')) return await handleGetGuide(request, env);
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      if (path === '/claude')            return await handleClaude(request, env);
      if (path === '/tts')               return await handleTTS(request, env);
      if (path === '/computer-use')      return await handleComputerUse(request, env);
      if (path === '/transcribe-token')  return await handleTranscribeToken(request, env);
      if (path === '/think')             return await handleThink(request, env);
      if (path === '/guide')             return await handleSaveGuide(request, env);
      return await handleGemini(request, env);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

// ── Claude Sonnet handler ──────────────────────────────────────────────────────

async function handleClaude(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await request.json();

  const claudeBody = {
    model:      body.model      || 'claude-sonnet-4-5',
    max_tokens: body.max_tokens || 1500,
    messages:   body.messages
  };
  if (body.system) claudeBody.system = body.system;
  if (body.stream) claudeBody.stream = true;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(claudeBody)
  });

  if (body.stream) {
    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return jsonResponse(err, upstream.status);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type':                'text/event-stream',
        'Cache-Control':               'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  const data = await upstream.json();
  return jsonResponse(data, upstream.status);
}

// ── ElevenLabs TTS handler ─────────────────────────────────────────────────────
// POST /tts  { text: string }
// Secrets: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID

async function handleTTS(request, env) {
  const apiKey  = env.ELEVENLABS_API_KEY;
  const voiceId = env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return jsonResponse({ error: 'ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID not configured' }, 500);
  }

  const body = await request.json();
  if (!body.text) return jsonResponse({ error: 'text is required' }, 400);

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key':   apiKey,
        'content-type': 'application/json',
        'accept':       'audio/mpeg'
      },
      body: JSON.stringify({
        text:           body.text,
        model_id:       'eleven_flash_v2_5',
        voice_settings: body.voice_settings || { stability: 0.5, similarity_boost: 0.75 }
      })
    }
  );

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    let errBody;
    try { errBody = JSON.parse(errText); } catch (_) { errBody = errText; }
    return jsonResponse({ error: 'ElevenLabs rejected request', status: upstream.status, detail: errBody }, upstream.status);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':                'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-store'
    }
  });
}

// ── Computer Use handler ───────────────────────────────────────────────────────
// POST /computer-use { screenshot: base64, question: string, width: number, height: number }
// Secret: ANTHROPIC_API_KEY (shared with /claude)

function bestComputerUseResolution(w, h) {
  const ratio = w / h;
  if (Math.abs(ratio - 4 / 3)   < 0.05) return { w: 1024, h: 768 };
  if (Math.abs(ratio - 16 / 10) < 0.05) return { w: 1280, h: 800 };
  return { w: 1366, h: 768 }; // ~16:9 default
}

async function handleComputerUse(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await request.json();
  if (!body.screenshot || !body.question) {
    return jsonResponse({ error: 'screenshot and question are required' }, 400);
  }

  const targetRes = bestComputerUseResolution(body.width || 1280, body.height || 800);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'computer-use-2025-11-24',
      'content-type':      'application/json'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 256,
      tools: [{
        type:              'computer_20251124',
        name:              'computer',
        display_width_px:  targetRes.w,
        display_height_px: targetRes.h
      }],
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.screenshot } },
        { type: 'text',  text: `The user wants to: "${body.question}". Click the relevant UI element.` }
      ]}]
    })
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    return jsonResponse({ error: err }, upstream.status);
  }

  const data      = await upstream.json();
  const toolBlock = data.content?.find(b => b.type === 'tool_use');
  const coord     = toolBlock?.input?.coordinate;

  return jsonResponse({
    x:            coord?.[0] ?? null,
    y:            coord?.[1] ?? null,
    targetWidth:  targetRes.w,
    targetHeight: targetRes.h
  });
}

// ── AssemblyAI real-time token handler ─────────────────────────────────────────
// POST /transcribe-token  (no body needed)
// Returns a short-lived token for AssemblyAI real-time WebSocket transcription.
// Secret: ASSEMBLYAI_API_KEY

async function handleTranscribeToken(request, env) {
  const apiKey = env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'ASSEMBLYAI_API_KEY not configured' }, 500);

  const res  = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    { headers: { authorization: apiKey } }
  );
  const data = await res.text();
  return new Response(data, {
    status:  res.status,
    headers: {
      'content-type':                'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ── Claude extended thinking handler ──────────────────────────────────────────
// POST /think  { goal: string, context?: string }
// Returns a structured plan as a JSON array of step strings.
// Secret: ANTHROPIC_API_KEY (shared)

async function handleThink(request, env) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await request.json();
  if (!body.goal) return jsonResponse({ error: 'goal is required' }, 400);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'interleaved-thinking-2025-05-14',
      'content-type':      'application/json'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 8000,
      thinking:   { type: 'enabled', budget_tokens: 5000 },
      system:     'You are a browser task planner. Given a goal, return a JSON array of 3–7 short, ordered action steps. Each step is one plain English sentence. Respond with ONLY the JSON array, no explanation.',
      messages:   [{ role: 'user', content: `Goal: "${body.goal}"${body.context ? `\nContext: ${body.context}` : ''}` }]
    })
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    return jsonResponse({ error: err }, upstream.status);
  }

  const data     = await upstream.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  let steps = [];
  try { steps = JSON.parse(textBlock?.text || '[]'); } catch (_) {}

  return jsonResponse({ steps });
}

// ── Gemini handler (legacy) ────────────────────────────────────────────────────

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
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// ── Guide KV handlers ──────────────────────────────────────────────────────

// POST /guide  { name, domain, steps[] }  →  { id, shareUrl }
async function handleSaveGuide(request, env) {
  if (!env.GUIDES) return jsonResponse({ error: 'GUIDES KV not configured' }, 500);

  const body = await request.json();
  if (!body.name || !Array.isArray(body.steps)) {
    return jsonResponse({ error: 'name and steps are required' }, 400);
  }

  const id    = crypto.randomUUID();
  const guide = { id, name: body.name, domain: body.domain || '', pageUrl: body.pageUrl || '', createdAt: Date.now(), steps: body.steps };

  await env.GUIDES.put(id, JSON.stringify(guide), { expirationTtl: 7776000 }); // 90 days

  // Build a share URL that auto-starts the guide on the original page
  let shareUrl;
  if (body.pageUrl) {
    try {
      const u = new URL(body.pageUrl);
      u.searchParams.set('opheliaGuide', id);
      shareUrl = u.toString();
    } catch (_) {
      shareUrl = `https://${body.domain || 'example.com'}?opheliaGuide=${id}`;
    }
  } else {
    shareUrl = `https://${body.domain || 'example.com'}?opheliaGuide=${id}`;
  }

  return jsonResponse({ id, shareUrl });
}

// GET /guide/:id  →  guide JSON
async function handleGetGuide(request, env) {
  if (!env.GUIDES) return jsonResponse({ error: 'GUIDES KV not configured' }, 500);

  const id   = new URL(request.url).pathname.replace('/guide/', '');
  if (!id)   return jsonResponse({ error: 'Missing guide id' }, 400);

  const data = await env.GUIDES.get(id);
  if (!data) return jsonResponse({ error: 'Guide not found' }, 404);

  return new Response(data, {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

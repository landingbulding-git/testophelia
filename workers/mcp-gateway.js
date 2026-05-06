// Ophelia MCP Gateway — Cloudflare Worker
// POST /call  { platform, tool, input } -> tool result (cached 15min in KV)
// POST /list  { platform }              -> available tools for platform
// POST /auth  { platform, code }        -> OAuth stub (future)
// POST /tutorial-to-guidance            -> YouTube fetch + Claude Brain + Notion page + DB

import { fetchYouTubeVideoContent, extractYouTubeVideoId } from './youtube-fetch.js';
import {
  createBrainPage,
  createPlanDatabase,
  createDatabaseRows,
  notionPageWebUrl
} from './notion-client.js';

const PLATFORM_KB = {
  'notion.com': {
    description: 'Primary MCP environment stub for upcoming Ophelia steps.',
    docs: {
      overview: [
        'Notion MCP is intentionally running in stub mode.',
        'Use search_docs to retrieve starter guidance and placeholders.',
        'New tools can be registered under notion.com in this gateway.'
      ].join('\n'),
      blocks: [
        'Type "/" to open the block menu.',
        'Core blocks: text, heading, todo, toggle, table, board, code.'
      ].join('\n'),
      databases: [
        'Database views: table, board, calendar, list, timeline.',
        'Typical properties: title, status, date, person, relation, formula.'
      ].join('\n')
    }
  },
  'youtube.com': {
    description: 'YouTube MCP for fetching video content by URL.',
    docs: {
      overview: [
        'Use fetch_video_content with a YouTube URL.',
        'Returns normalized metadata for the transcript when available.'
      ].join('\n'),
      urls: [
        'Accepted formats: https://www.youtube.com/watch?v=..., https://youtu.be/..., shorts URLs.',
        'You can also pass embed URLs; videoId is derived automatically.'
      ].join('\n'),
      transcript: [
        'Transcript fetch depends on public caption tracks.',
        'When unavailable, the tool still returns video metadata.'
      ].join('\n')
    }
  }
};

const DEFAULT_CLAUDE_WORKER = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude';
const TRANSCRIPT_MAX_CHARS = 48000;
const RL_DAILY_LIMIT = 30;

const BRAIN_SYSTEM = `You are the "Brain" of Ophelia, a specialized agent that converts complex YouTube tutorials into actionable Notion plans.

Your task: output a JSON object ONLY (no markdown fences, no prose) with this exact shape:
{"steps":[{"title":"string","details":"string","category":"Learning"|"Execution","status":"Not Started"}]}

Rules for each step:
- title: short, actionable headline for the row.
- details: 1-3 sentences; what the user does or understands.
- category: "Learning" for watching, concepts, background. "Execution" for clicks, typing, configuration on a site where live guidance will help later.
- status: always "Not Started" for every step (the app enforces workflow later).

Sort steps in the same order as the tutorial teaches. If the transcript is partial, infer reasonable steps from title/description.

Do not include any keys other than "steps". Do not wrap in markdown.`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors();

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/tutorial-to-guidance') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: corsJsonHeaders() });
      }
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: 'Invalid JSON' }, 400);
      }
      try {
        const out = await handleTutorialToGuidance(body, env, request);
        return json(out, 200);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsJsonHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'Invalid JSON' }, 400);
    }

    try {
      if (path === '/call') return await handleCall(body, env);
      if (path === '/list') return handleList(body);
      if (path === '/auth') return json({ status: 'auth_not_yet_implemented' });
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

async function handleTutorialToGuidance(body, env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = Math.floor(Date.now() / 86400000);
  const rlKey = `tutorial_rl:${day}:${ip}`;

  if (env.MCP_CACHE) {
    const raw = await env.MCP_CACHE.get(rlKey);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= RL_DAILY_LIMIT) {
      throw new Error('Daily limit reached for tutorial-to-guidance. Try again tomorrow.');
    }
    await env.MCP_CACHE.put(rlKey, String(count + 1), { expirationTtl: 172800 });
  }

  const token = env.NOTION_INTEGRATION_TOKEN;
  const parentPageId = env.NOTION_PARENT_PAGE_ID;
  if (!token || !parentPageId) {
    throw new Error('NOTION_INTEGRATION_TOKEN and NOTION_PARENT_PAGE_ID must be set on the worker');
  }

  const youtubeUrl = body.youtubeUrl;
  if (!youtubeUrl || !extractYouTubeVideoId(youtubeUrl)) {
    throw new Error('Valid youtubeUrl is required');
  }

  const userContext = (body.userContext && String(body.userContext).trim()) || 'Not specified';
  const speechTranscript = body.speechTranscript ? String(body.speechTranscript) : '';

  const video = await fetchYouTubeVideoContent({ url: youtubeUrl, includeTranscript: true });
  let transcript = video.transcript || '';
  if (transcript.length > TRANSCRIPT_MAX_CHARS) {
    transcript = transcript.slice(0, TRANSCRIPT_MAX_CHARS) + '\n…[truncated]';
  }

  const claudeUrl = env.CLAUDE_WORKER_URL || DEFAULT_CLAUDE_WORKER;
  const steps = await callClaudeForPlan({
    claudeUrl,
    userContext,
    youtubeUrl: video.url,
    videoTitle: video.title,
    videoDescription: (video.description || '').slice(0, 8000),
    transcript,
    transcriptStatus: video.transcriptStatus || 'n/a'
  });

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Brain produced no steps');
  }

  const brainTitle = `${video.title || 'YouTube tutorial'} — Ophelia plan`;
  const summaryBits = [
    video.channelTitle ? `Channel: ${video.channelTitle}` : '',
    video.lengthSeconds ? `Length: ${video.lengthSeconds}s` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  const brainPage = await createBrainPage(token, parentPageId, {
    title: brainTitle,
    userContext: speechTranscript ? `${userContext}\n\n(Voice: ${speechTranscript.slice(0, 500)})` : userContext,
    youtubeUrl: video.url,
    videoSummary: summaryBits
  });

  const brainPageId = brainPage.id;
  const db = await createPlanDatabase(token, brainPageId, {
    title: 'Tutorial steps'
  });
  const databaseId = db.id;

  await createDatabaseRows(token, databaseId, steps);

  return {
    success: true,
    notionPageUrl: notionPageWebUrl(brainPageId),
    databaseUrl: notionPageWebUrl(databaseId),
    stepCount: steps.length,
    videoId: video.videoId
  };
}

async function callClaudeForPlan({
  claudeUrl,
  userContext,
  youtubeUrl,
  videoTitle,
  videoDescription,
  transcript,
  transcriptStatus
}) {
  const userBlock =
    `User context (why learning): ${userContext}\n\n` +
    `URL: ${youtubeUrl}\n\n` +
    `Video title: ${videoTitle || '(unknown)'}\n\n` +
    `Description (excerpt):\n${videoDescription || '(none)'}\n\n` +
    `Transcript status: ${transcriptStatus}\n\n` +
    `Transcript:\n${transcript || '(no transcript available — infer from title/description)'}`;

  const res = await fetch(claudeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: BRAIN_SYSTEM,
      messages: [{ role: 'user', content: userBlock }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude proxy failed: ${res.status} ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text || '';
  const steps = parseBrainStepsJson(text);
  return steps;
}

function parseBrainStepsJson(text) {
  let raw = String(text).trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('Brain response contained no JSON object');
  let parsed;
  try {
    parsed = JSON.parse(objMatch[0]);
  } catch (e) {
    throw new Error(`Brain JSON parse error: ${e.message}`);
  }
  let steps = parsed.steps;
  if (!Array.isArray(steps) && Array.isArray(parsed)) {
    steps = parsed;
  }
  if (!Array.isArray(steps)) throw new Error('Brain JSON must contain a "steps" array');

  const normalized = [];
  for (const s of steps) {
    if (!s || typeof s.title !== 'string' || !s.title.trim()) continue;
    const cat = s.category === 'Execution' ? 'Execution' : 'Learning';
    normalized.push({
      title: s.title.trim().slice(0, 500),
      details: typeof s.details === 'string' ? s.details.trim().slice(0, 2000) : '',
      category: cat,
      status: 'Not Started'
    });
  }
  return normalized;
}

function searchDocs(platform, query) {
  const kb = PLATFORM_KB[platform];
  if (!kb) return `Platform "${platform}" is not enabled in this MVP gateway.`;

  const q = String(query || '').toLowerCase().trim();
  if (!q) return kb.docs.overview;

  const ranked = Object.entries(kb.docs)
    .map(([section, content]) => {
      const words = q.split(/\s+/).filter(Boolean);
      const score = words.filter((w) => content.toLowerCase().includes(w)).length;
      return { section, content, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return kb.docs.overview;
  return ranked.slice(0, 2).map((x) => x.content).join('\n\n---\n\n');
}

async function handleCall({ platform, tool, input }, env) {
  if (!platform || !tool) return json({ error: 'platform and tool required' }, 400);
  if (!PLATFORM_KB[platform]) return json({ error: `Platform "${platform}" is not enabled` }, 404);

  const cacheKey = `${platform}:${tool}:${JSON.stringify(input || {})}`;
  if (env.MCP_CACHE) {
    const cached = await env.MCP_CACHE.get(cacheKey);
    if (cached) return json({ result: JSON.parse(cached), cached: true });
  }

  let result;
  if (tool === 'search_docs') {
    result = searchDocs(platform, input?.query || input?.q || '');
  } else if (platform === 'youtube.com' && tool === 'fetch_video_content') {
    result = await fetchYouTubeVideoContent(input || {});
  } else {
    result = `Tool "${tool}" is not implemented yet for ${platform}.`;
  }

  if (env.MCP_CACHE) {
    await env.MCP_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 900 });
  }
  return json({ result });
}

function handleList({ platform } = {}) {
  if (!platform) return json({ error: 'platform required' }, 400);
  if (!PLATFORM_KB[platform]) {
    return json({
      platform,
      description: 'Platform disabled in MVP mode',
      tools: []
    });
  }

  const tools = [{ name: 'search_docs', description: `Search ${platform} documentation by keyword` }];
  if (platform === 'youtube.com') {
    tools.push({
      name: 'fetch_video_content',
      description: 'Fetch a YouTube video metadata/transcript by URL'
    });
  }

  return json({ platform, description: PLATFORM_KB[platform].description, tools });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

function corsJsonHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

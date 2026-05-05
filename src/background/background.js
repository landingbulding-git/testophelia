// Ophelia Background Service Worker

// ── Claude proxy (4A: agent logic lives here, not in content script) ─────────
const CLAUDE_WORKER  = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude';
const CLAUDE_SONNET  = 'claude-sonnet-4-5';
const CLAUDE_HAIKU   = 'claude-haiku-4-5';

// ── 6A: MCP Gateway — connects to platform knowledge ─────────────────────────
const MCP_GATEWAY    = 'https://ophelia-mcp-gateway.norbertb-consulting.workers.dev';

// ── 7B: Sequential Thinking MCP ──────────────────────────────────────────────
const THINKING_MCP   = 'https://ophelia-thinking-mcp.norbertb-consulting.workers.dev';

const COMPLEX_KEYWORDS = ['build', 'create', 'set up', 'setup', 'configure', 'integrate',
  'automate', 'pipeline', 'workflow', 'connect', 'implement', 'develop', 'design'];

function _isComplexGoal(goal) {
  if (!goal) return false;
  const words = goal.trim().split(/\s+/);
  if (words.length > 8) return true;
  const lower = goal.toLowerCase();
  return COMPLEX_KEYWORDS.some(k => lower.includes(k));
}

async function _callThinkingMCP(goal, platformId, context) {
  try {
    const res = await fetch(THINKING_MCP + '/think', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ goal, platform: platformId || '', context: context || '' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.plan?.length ? data : null;
  } catch (_) { return null; }
}

const MCP_REGISTRY = {
  'bubble.io':    'bubble.io',
  'zoho.com':     'zoho.com',
  'notion.com':   'notion.com',
  'suno.com':     'suno.com',
  'webflow.com':  'webflow.com',
  'airtable.com': 'airtable.com',
  'linear.app':   'linear.app',
  'github.com':   'github.com',
  'mailchimp.com':'mailchimp.com',
  'canva.com':    'canva.com',
};

function _getPlatformId(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, id] of Object.entries(MCP_REGISTRY)) {
      if (host === domain || host.endsWith('.' + domain)) return id;
    }
  } catch (_) {}
  return null;
}

async function _fetchPlatformDocs(platformId, query) {
  if (!platformId) return null;
  try {
    const res = await fetch(MCP_GATEWAY + '/call', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ platform: platformId, tool: 'search_docs', input: { query } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result || null;
  } catch (_) { return null; }
}

async function _fetchPlatformTools(platformId) {
  if (!platformId) return null;
  try {
    const res = await fetch(MCP_GATEWAY + '/list', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ platform: platformId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.tools?.length ? data : null;
  } catch (_) { return null; }
}

// ── 4C: Developer Knowledge — platform-specific selector hints ──────────────
const PLATFORM_KB = {
  'facebook.com': [
    'Navigation links use aria-label, not visible text (e.g. aria-label="Home")',
    'Post composer: role="textbox" with aria-label containing "What\'s on your mind"',
    'Like/React toolbar: div[role="toolbar"] inside each post',
    'Profile picture and story rings: div[role="img"] not <img>',
    'Share button opens a dialog — target the dialog\'s share options after it appears',
    'Settings gear: aria-label="Settings & privacy" or "Account"',
  ],
  'instagram.com': [
    'All action buttons use SVG icons — find them via aria-label on the parent <button> or <a>',
    'New post: button with aria-label="New post"',
    'Like a post: button with aria-label="Like" inside the post article',
    'DM / Direct: anchor with aria-label="Direct"',
    'Profile: anchor with aria-label containing the username',
  ],
  'gmail.com': [
    'Compose button: div[role="button"] with aria-label="Compose"',
    'Email rows: tr[role="row"] in the inbox list',
    'Search bar: input with aria-label="Search mail"',
    'Toolbar actions appear after selecting an email: div[role="button"] (Archive, Delete, etc.)',
    'Left sidebar labels: li[role="treeitem"]',
    'Send button inside compose: div[role="button"] with aria-label="Send"',
  ],
  'mail.google.com': [
    'Compose button: div[role="button"] with aria-label="Compose"',
    'Search bar: input with aria-label="Search mail"',
    'Send: div[role="button"] aria-label="Send ‪(Ctrl-Enter)‬"',
  ],
  'twitter.com': [
    'Prefer aria-label over text content for all icon buttons',
    'Tweet compose box: role="textbox", aria-label="Post text"',
    'Post/tweet button: data-testid="tweetButton"',
    'Follow button: data-testid="follow"',
    'Like button: data-testid="like"',
    'Retweet: data-testid="retweet"',
  ],
  'x.com': [
    'Same structure as twitter.com — all icons use aria-label',
    'Compose box: role="textbox", aria-label="Post text"',
    'Post button: data-testid="tweetButton"',
    'Follow button: data-testid="follow"',
    'Like: data-testid="like"',
    'Retweet: data-testid="retweet"',
  ],
  'linkedin.com': [
    'Primary nav anchors use aria-label (e.g. aria-label="Home")',
    'Start a post: button with text "Start a post" or aria-label="Create a post"',
    'Connect/Follow button: role="button" with visible text "Connect" or "Follow"',
    'Messages: aria-label="Messaging"',
    'Notifications: aria-label="Notifications"',
    'Job listings: role="listitem" with visible job title and company text',
  ],
  'youtube.com': [
    'Search bar: input[id="search"] with aria-label="Search"',
    'Search submit: button[id="search-icon-legacy"]',
    'Subscribe: button with aria-label containing "Subscribe to"',
    'Like: button with aria-label containing "like this video"',
    'Player controls use aria-label (Play, Pause, Volume, Fullscreen)',
    'Sidebar guide: nav[aria-label="Guide"]',
  ],
  'google.com': [
    'Main search input: textarea[aria-label="Search"] or input[name="q"]',
    'Search button: input[name="btnK"] or button with aria-label="Google Search"',
    'Search results: each result is a div[data-sokoban-container] or h3 inside an <a>',
  ],
  'docs.google.com': [
    'Toolbar buttons: role="button" with aria-label (e.g. aria-label="Bold")',
    'Editor area: div[role="textbox"] or div[contenteditable="true"]',
    'Menu bar items (File, Edit, Format): role="menuitem" or role="button" with visible text',
    'Share button: aria-label="Share"',
    'Comments: button with aria-label="Insert comment" or aria-label="Open comment"',
  ],
  'sheets.google.com': [
    'Cell input: id="waffle-grid-container" — click a cell then type',
    'Formula bar: id="t-formula-bar-input"',
    'Toolbar buttons use aria-label',
    'Sheet tabs at bottom: role="tab" with aria-label containing sheet name',
  ],
  'github.com': [
    'Primary nav: role="navigation"',
    'Star repo: button with aria-label="Star this repository"',
    'File tree: role="tree" with role="treeitem" children',
    'Issues and PRs: table rows use role="row"',
    'Create new: button or link with aria-label containing "New"',
    'Code search: input with aria-label="Search or jump to..."',
  ],
  'amazon.com': [
    'Main search box: id="twotabsearchtextbox"',
    'Search button: id="nav-search-submit-button"',
    'Add to Cart: id="add-to-cart-button"',
    'Buy Now: id="buy-now-button"',
    'Product results in search: div[data-component-type="s-search-result"]',
    'Price: span[class*="a-price"] span[aria-hidden="true"]',
  ],
};

function _getPlatformHints(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const hints = PLATFORM_KB[host];
    if (!hints?.length) return '';
    return `\n\nPLATFORM KNOWLEDGE (${host}):\n` + hints.map(h => `\u2022 ${h}`).join('\n');
  } catch (_) { return ''; }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    if (command === 'toggle-sphere') {
      chrome.tabs.sendMessage(tabId, { action: 'toggleSphere' }).catch(() => {});
    } else if (command === 'send-firebase') {
      // Ctrl+Shift+F now toggles recording
      chrome.tabs.sendMessage(tabId, { action: 'toggleRecording' }).catch(() => {});
    }
  });
});

// ── Messages from content scripts ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Screenshot for the live agent
  if (request.action === 'captureTab') {
    const quality = typeof request.quality === 'number' ? request.quality : 70;
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality }, dataUrl => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true; // keep channel open for async response
  }

  if (request.action === 'navigate') {
    // Navigate the sender's tab to the requested URL
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs.update(tabId, { url: request.url })
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
    return true;
  }

  // ── 4A: Agent Claude calls (offloaded from content script) ─────────────────
  if (request.action === 'analyze') {
    _handleAnalyze({ ...request, tabId: sender.tab?.id }).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (request.action === 'planSession') {
    _handlePlanSession(request).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (request.action === 'checkObstacle') {
    _handleCheckObstacle(request).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (request.action === 'clarifyGoal') {
    _handleClarifyGoal(request).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (request.action === 'coordLookup') {
    _handleCoordLookup(request).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
});

// ── SW-side Claude helpers (4A) ──────────────────────────────────────────────

async function _swRawText({ max_tokens, system, messages, stream }) {
  const body = { model: CLAUDE_SONNET, max_tokens, messages };
  if (system) body.system = system;
  if (stream) body.stream = true;

  const res = await fetch(CLAUDE_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(JSON.stringify(err));
  }

  if (stream) {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            text += evt.delta.text;
          }
        } catch (_) {}
      }
    }
    return text;
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function _handleAnalyze({ apiMessages, language, plan, pageUrl, tabId, stepFailed }) {
  const lang       = language || 'en';
  const platformId = _getPlatformId(pageUrl);

  const planCtx = Array.isArray(plan) && plan.length
    ? `\n\nSESSION PLAN (execute the most appropriate next step based on what\'s visible on screen):\n` +
      plan.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  // 6B: live gateway docs for registered platforms; static KB for all others
  let platformCtx = '';
  if (platformId) {
    const planHint  = Array.isArray(plan) && plan.length ? plan[0] : '';
    const liveDocs  = await _fetchPlatformDocs(platformId, planHint);
    if (liveDocs) platformCtx = `\n\nPLATFORM DOCUMENTATION (${platformId}):\n${liveDocs}`;
  } else {
    platformCtx = _getPlatformHints(pageUrl);
  }

  const system =
    `You are Ophelia, a live browser co-pilot. You see the user's browser via screenshots and a DOM element list.\n` +
    `After every user action you receive a new screenshot and DOM state.\n\n` +
    `YOUR ONLY JOB: identify the single next action the user must take to reach their goal.\n\n` +
    `RULES:\n` +
    `1. One action per response. Never combine multiple actions.\n` +
    `2. Always pick elementIndex from the DOM list shown below. The number in [brackets] is the index.\n` +
    `3. If the right element is not visible yet (menu not open, dialog not shown): set elementIndex null and instruct the user to open it first.\n` +
    `4. Instructions: short, plain English, max 12 words.\n` +
    `5. If the target element is likely below the visible area, include "scroll down to find it" in the instruction.\n` +
    `6. If the page shows a loading spinner or skeleton screen, instruct the user to wait before acting.\n` +
    `7. If no element is needed (e.g. wait, scroll, or goal is done): set elementIndex to null.\n` +
    `8. Pick elementIndex from the [N] number shown in the DOM list. Never invent a number not in the list.\n` +
    `Language: respond in "${lang}" \u2014 translate instructions naturally if not English.\n\n` +
    `RESPOND WITH ONLY VALID JSON \u2014 no prose, no markdown fences:\n` +
    `{"instruction":"short action","elementIndex":3,"done":false}\n` +
    `elementIndex must be the [N] index from the DOM list, or null if no element to click.\n` +
    `When the goal is fully achieved: {"instruction":"All done!","done":true,"elementIndex":null}` +
    planCtx +
    platformCtx +
    (stepFailed
      ? `\n\nSTEP FAILED: The previous action had no visible effect — the DOM did not change after the user clicked. Use the inspect_element tool to diagnose why. Then explain clearly what went wrong and what the user should do instead. Do NOT repeat the same instruction.`
      : '');

  // ── Fast path: streaming, no tools — TTS fires on first token ───────────────
  {
    const res = await fetch(CLAUDE_WORKER, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_SONNET, max_tokens: 400, system, messages: apiMessages, stream: true })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(JSON.stringify(err));
    }

    const reader   = res.body.getReader();
    const decoder  = new TextDecoder();
    const instrRe  = /"instruction"\s*:\s*"((?:[^"\\]|\\.)*)"/;
    let raw        = '';
    let earlyFired = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            raw += evt.delta.text;
            if (!earlyFired) {
              const m = raw.match(instrRe);
              if (m) {
                earlyFired = true;
                const instr = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
                console.log('\u26A1 SW stream early instruction:', instr);
                if (tabId) chrome.tabs.sendMessage(tabId, { action: 'earlyInstruction', instruction: instr }).catch(() => {});
              }
            }
          }
        } catch (_) {}
      }
    }

    console.log('\uD83E\uDDE0 SW analyze (stream):', raw.substring(0, 200));
    const match = raw.match(/{[\s\S]*}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        parsed._raw = raw;
        if (earlyFired) parsed._instructionSpoken = true;
        if (parsed.element || parsed.done) return parsed;
      } catch (_) {}
    }
  }

  // ── Tool path: fast path had no element — retry with tools ──────────────────
  console.log('\uD83D\uDD27 SW analyze: no element in stream, trying tool-use\u2026');

  const tools = [
    {
      name: 'get_accessibility_tree',
      description: 'Re-scan the page and return an enriched ARIA accessibility tree with computedRole, computedLabel, disabled/expanded/required states. Use when the DOM list seems incomplete or element states are unclear.',
      input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'inspect_element',
      description: 'Inspect a specific element to explain why it may be disabled or non-interactive. Returns computed state, form validation, and missing required fields.',
      input_schema: {
        type: 'object',
        properties: {
          hint: { type: 'string', description: 'The element to inspect \u2014 its aria_label, visible text, or role' }
        },
        required: ['hint']
      }
    },
    {
      name: 'call_platform_tool',
      description: platformId
        ? `Call the ${platformId} MCP to get real documentation, UI terminology, or step-by-step guidance specific to this platform. Use search_docs to look up how features work.`
        : 'Call the current platform\'s MCP to get documentation or platform-specific guidance.',
      input_schema: {
        type: 'object',
        properties: {
          tool:  { type: 'string', description: 'Tool name — use "search_docs" to search platform documentation' },
          input: { type: 'object', description: 'Tool input, e.g. {"query": "how to create a workflow"}' }
        },
        required: ['tool', 'input']
      }
    }
  ];

  const messages    = [...apiMessages];
  const MAX_ROUNDS  = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(CLAUDE_WORKER, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_SONNET, max_tokens: 400, system, tools, messages })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(JSON.stringify(err));
    }
    const data = await res.json();

    if (data.stop_reason === 'tool_use') {
      const toolBlock = data.content.find(b => b.type === 'tool_use');
      if (!toolBlock) break;

      messages.push({ role: 'assistant', content: data.content });
      let toolResult = 'Error: tool could not execute';

      if (toolBlock.name === 'call_platform_tool') {
        if (platformId) {
          toolResult = await _fetchPlatformDocs(platformId, toolBlock.input?.input?.query || toolBlock.input?.tool) || 'No documentation found.';
          console.log('\uD83C\uDF10 SW tool call_platform_tool:', toolResult.substring(0, 200));
        } else {
          toolResult = 'No platform MCP registered for this page.';
        }
      } else if (toolBlock.name === 'get_accessibility_tree' && tabId) {
        toolResult = await new Promise(resolve => {
          chrome.tabs.sendMessage(tabId, { action: 'getAriaTree' }, result => {
            resolve(chrome.runtime.lastError
              ? 'Error: content script unreachable'
              : JSON.stringify(result || {}));
          });
        });
        console.log('\uD83D\uDD27 SW tool get_accessibility_tree:', toolResult.substring(0, 200));
      } else if (toolBlock.name === 'inspect_element' && tabId) {
        toolResult = await new Promise(resolve => {
          chrome.tabs.sendMessage(tabId, { action: 'inspectElement', hint: toolBlock.input.hint }, result => {
            resolve(chrome.runtime.lastError
              ? 'Error: content script unreachable'
              : JSON.stringify(result || { found: false }));
          });
        });
        console.log('\uD83D\uDD27 SW tool inspect_element:', toolResult.substring(0, 200));
      }

      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: toolResult }]
      });
      continue;
    }

    const textBlock = data.content.find(b => b.type === 'text');
    const raw = textBlock?.text || '';
    console.log('\uD83E\uDDE0 SW analyze (tool):', raw.substring(0, 200));
    const match = raw.match(/{[\s\S]*}/);
    if (!match) throw new Error('No JSON in tool-use response');
    const parsed = JSON.parse(match[0]);
    parsed._raw = raw;
    return parsed;
  }

  throw new Error('Tool-use loop reached max rounds without final answer');
}

async function _handlePlanSession({ goal, url, title, language }) {
  const lang       = language || 'en';
  const platformId = _getPlatformId(url);

  // 7B: complex goals get deep sequential reasoning first
  if (_isComplexGoal(goal)) {
    console.log('🧠 SW plan: complex goal detected, calling thinking MCP…');
    const thinking = await _callThinkingMCP(goal, platformId, `Page: ${title} (${url})`);
    if (thinking?.plan?.length) {
      console.log('💡 SW thinking plan:', thinking.plan);
      if (thinking.caveats?.length) console.log('⚠️ Caveats:', thinking.caveats);
      return thinking.plan;
    }
    console.log('🔧 SW thinking MCP failed or empty, falling back to Haiku planner');
  }

  // 6C: parallel fetch — docs (search_docs for goal) + tools list from gateway
  const [platformDocs, platformToolsData] = await Promise.all([
    _fetchPlatformDocs(platformId, goal),
    _fetchPlatformTools(platformId),
  ]);

  const platformCtx = platformDocs
    ? `\n\nPLATFORM DOCUMENTATION for ${platformId}:\n${platformDocs}\n`
    : '';

  const toolsCtx = platformToolsData?.tools?.length
    ? `\n\nAVAILABLE PLATFORM TOOLS on ${platformId} (Ophelia can call these during the session):\n` +
      platformToolsData.tools.map(t => `\u2022 ${t.name} \u2014 ${t.description}`).join('\n') + '\n'
    : '';

  const res = await fetch(CLAUDE_WORKER, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      CLAUDE_HAIKU,
      max_tokens: 300,
      system:
        `You are a browser task planner. Given a goal, the current page, platform documentation, and the list of tools Ophelia can invoke, output a concise ordered list of browser actions needed to complete the goal.\n` +
        `Use the platform documentation and tool names to name UI elements and steps precisely.\n` +
        `Reply ONLY with a JSON array of short action strings \u2014 no prose, no markdown:\n` +
        `["Click the Workflow tab in the left sidebar", "Click + Add an action", ...]` +
        platformCtx +
        toolsCtx,
      messages: [{ role: 'user', content: `Goal: "${goal}"\nCurrent page: ${title} (${url})\nLanguage: ${lang}` }]
    })
  });
  if (!res.ok) return [];
  const data  = await res.json();
  const raw   = data.content?.[0]?.text || '';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const plan = JSON.parse(match[0]);
    console.log('\uD83D\uDCCB SW plan (platform:', platformId || 'none', '):', plan);
    return Array.isArray(plan) ? plan : [];
  } catch (_) { return []; }
}

async function _handleCheckObstacle({ screenshot }) {
  const res = await fetch(CLAUDE_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_HAIKU,
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } },
          { type: 'text', text:
            'Does this screenshot show a modal, cookie consent banner, login wall, or blocking overlay ' +
            'that prevents interaction with the main content? ' +
            'Reply ONLY with valid JSON \u2014 no prose:\n' +
            '{"obstacle":true,"action":"close the cookie banner"} or {"obstacle":false}'
          }
        ]
      }]
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw   = data.content?.[0]?.text || '';
  const match = raw.match(/{[\s\S]*}/);
  if (!match) return null;
  const parsed = JSON.parse(match[0]);
  console.log('\uD83D\uDEA7 SW obstacle:', parsed);
  return parsed.obstacle ? parsed : null;
}

async function _handleClarifyGoal({ goal }) {
  const res = await fetch(CLAUDE_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_HAIKU,
      max_tokens: 120,
      system:
        `You assess whether a user's goal is specific enough to guide step by step in a browser.\n` +
        `Reply ONLY with valid JSON \u2014 no prose:\n` +
        `{"clear":true}  \u2014 goal is actionable and specific.\n` +
        `{"clear":false,"question":"..."}  \u2014 too vague; one short clarifying question, max 12 words.`,
      messages: [{ role: 'user', content: `Goal: "${goal}"` }]
    })
  });
  if (!res.ok) return { clear: true };
  const data  = await res.json();
  const raw   = data.content?.[0]?.text || '';
  const match = raw.match(/{[\s\S]*}/);
  if (!match) return { clear: true };
  return JSON.parse(match[0]);
}

async function _handleCoordLookup({ screenshot, label }) {
  const res = await fetch(CLAUDE_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_HAIKU,
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } },
          { type: 'text', text:
            `Point to the element described as: "${label}".\n` +
            `Reply ONLY with valid JSON — no prose: {"x":N,"y":N}\n` +
            `x and y are pixel coordinates in the screenshot (top-left = 0,0).`
          }
        ]
      }]
    })
  });
  if (!res.ok) return null;
  const data  = await res.json();
  const raw   = data.content?.[0]?.text || '';
  const match = raw.match(/{[\s\S]*}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

// ── Tutorial URL detection ─────────────────────────────────────────────────────
// When the user opens a tutorial share link, tell the content script to load it.
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return; // Main frame only

  const url = new URL(details.url);
  if (url.hostname === 'testophelia.vercel.app' && url.pathname === '/tutorial.html') {
    const sessionId = url.searchParams.get('id');
    if (sessionId) {
      console.log('🎯 Tutorial URL detected, loading session:', sessionId);
      chrome.tabs.sendMessage(details.tabId, {
        action: 'loadTutorial',
        sessionId
      }).catch(() => {
        // Content script may not be ready yet — retry once after a short delay
        setTimeout(() => {
          chrome.tabs.sendMessage(details.tabId, { action: 'loadTutorial', sessionId }).catch(() => {});
        }, 1000);
      });
    }
  }
});


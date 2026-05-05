// Ophelia Background Service Worker

// ── Claude proxy (4A: agent logic lives here, not in content script) ─────────
const CLAUDE_WORKER   = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude';
const MIN_CALL_GAP_MS = 2000; // min ms between main analyze calls
let   _swLastCallAt   = 0;

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
    _handleAnalyze(request).then(sendResponse).catch(() => sendResponse(null));
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
  const now = Date.now();
  const gap = MIN_CALL_GAP_MS - (now - _swLastCallAt);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  _swLastCallAt = Date.now();

  const body = { model: 'claude-sonnet-4-5', max_tokens, messages };
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

async function _handleAnalyze({ apiMessages, language }) {
  const lang = language || 'en';
  const system =
    `You are Ophelia, a live browser co-pilot. You see the user's browser via screenshots and a DOM element list.\n` +
    `After every user action you receive a new screenshot and DOM state.\n\n` +
    `YOUR ONLY JOB: identify the single next action the user must take to reach their goal.\n\n` +
    `RULES:\n` +
    `1. One action per response. Never combine multiple actions.\n` +
    `2. For elements in the DOM list: copy their JSON attributes verbatim into "element".\n` +
    `3. For elements not yet visible (inside menus/dialogs not yet open): use your site knowledge.\n` +
    `4. Instructions: short, plain English, max 12 words.\n` +
    `5. If the target element is likely below the visible area, include "scroll down to find it" in the instruction.\n` +
    `6. If the page shows a loading spinner or skeleton screen, instruct the user to wait before acting.\n` +
    `7. If you cannot identify the exact element, respond: {"instruction":"I couldn't find that element. Try scrolling or describe what you see.","element":null,"done":false}\n` +
    `8. Never invent element attributes not present in the DOM list \u2014 use only what appears verbatim.\n` +
    `Language: respond in "${lang}" \u2014 translate instructions naturally if not English.\n\n` +
    `RESPOND WITH ONLY VALID JSON \u2014 no prose, no markdown fences:\n` +
    `{"instruction":"short action","element":{"tag":"","aria_label":"","text_content":"","role":""},"done":false}\n` +
    `When the goal is fully achieved: {"instruction":"All done!","done":true,"element":null}`;

  const raw = await _swRawText({ max_tokens: 400, system, messages: apiMessages, stream: true });
  console.log('\uD83E\uDDE0 SW analyze:', raw.substring(0, 200));
  const match = raw.match(/{[\s\S]*}/);
  if (!match) throw new Error('No JSON in analyze response');
  const parsed = JSON.parse(match[0]);
  parsed._raw = raw;
  return parsed;
}

async function _handleCheckObstacle({ screenshot }) {
  const res = await fetch(CLAUDE_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
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
      model: 'claude-sonnet-4-5',
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
      model: 'claude-sonnet-4-5',
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


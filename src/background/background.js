// Ophelia Background Service Worker
// Lean baseline: shortcuts, screenshot capture, navigation, tutorial URL handoff.

const WORKER_BASE = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev';

// -- Keyboard shortcuts --------------------------------------------------------
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    if (command === 'toggle-sphere') {
      chrome.tabs.sendMessage(tabId, { action: 'toggleSphere' }).catch(() => {});
    }
  });
});

// -- Creator-mode tab coordinator -------------------------------------------
let _recordingTabId = null;

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newTabId = activeInfo.tabId;
  if (!_recordingTabId || _recordingTabId === newTabId) return;
  const oldTabId = _recordingTabId;
  _recordingTabId = newTabId; // optimistically update so re-entry is safe
  try {
    const response = await chrome.tabs.sendMessage(oldTabId, { action: 'pauseCreatorForTabSwitch' });
    if (response?.session) {
      chrome.tabs.sendMessage(newTabId, { action: 'resumeCreatorMode', session: response.session }).catch(() => {});
    }
  } catch (_) {
    // Old tab unresponsive (closed/navigated) — fall back to storage
    chrome.storage.local.get(['opheliaCreatorSession'], (r) => {
      if (r.opheliaCreatorSession?.active) {
        chrome.tabs.sendMessage(newTabId, { action: 'resumeCreatorMode', session: r.opheliaCreatorSession }).catch(() => {});
      }
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === _recordingTabId) _recordingTabId = null;
});

// -- Messages from content scripts ---------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'creatorModeStarted') {
    _recordingTabId = sender.tab?.id ?? null;
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'creatorModeStopped') {
    _recordingTabId = null;
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'captureTab') {
    const quality = typeof request.quality === 'number' ? request.quality : 70;
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  if (request.action === 'navigate') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No sender tab' });
      return false;
    }

    chrome.tabs.update(tabId, { url: request.url })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'activateTabForGuide') {
    const { url, guide, stepIndex } = request;
    (async () => {
      try {
        const stepOrigin = new URL(url).origin;
        const allTabs    = await chrome.tabs.query({});
        const match      = allTabs.find(t => {
          try { return new URL(t.url).origin === stepOrigin; } catch (_) { return false; }
        });
        if (match) {
          await chrome.tabs.update(match.id, { active: true });
          // Short delay to let the tab paint, then send resume signal
          setTimeout(() => {
            chrome.tabs.sendMessage(match.id, { action: 'resumeGuide', guide, stepIndex }).catch(() => {
              // Tab has no content script yet (rare) — storage fallback already set by caller
            });
          }, 350);
        } else {
          // No matching tab open — open a fresh one; checkForPending will resume via storage
          chrome.tabs.create({ url });
        }
      } catch (_) {
        // Malformed URL fallback — just open it
        chrome.tabs.create({ url }).catch(() => {});
      }
    })();
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === 'analyze') {
    _handleAnalyze({ ...request, tabId: sender.tab?.id }).then(sendResponse).catch(() => sendResponse(null));
    return true;
  }

});

// -- Conversational AI handler -----------------------------------------------
async function _handleAnalyze({ apiMessages, language, pageUrl, pageTitle = '', goal = '', tabId, screenshotWidth = 1280, screenshotHeight = 800, guideContext = null }) {
  const recentActions = Array.isArray(apiMessages)
    ? apiMessages
        .slice(-4)
        .filter(m => m.role === 'assistant' && typeof m.content === 'string')
        .map(m => m.content.replace(/\[POINT:[^\]]+\]/g, '').trim())
        .filter(Boolean)
    : [];
  const historyCtx = recentActions.length
    ? `\nRecent actions: ${recentActions.join(' \u2192 ')}`
    : '';

  let system;
  if (guideContext?.guide) {
    const step = guideContext.guide.steps?.[guideContext.stepIndex];
    system =
      `You are Ophelia, a warm customer success specialist helping someone follow a step-by-step guide.\n` +
      `Guide: "${guideContext.guide.name}" — Step ${guideContext.stepIndex + 1} of ${guideContext.guide.steps.length}.\n` +
      `Current step instruction: "${step?.narration || ''}"\n\n` +
      `RULES:\n` +
      `- Answer the user's question in 1–2 sentences, spoken aloud. Warm, direct, plain English.\n` +
      `- No markdown, no bullet points.\n` +
      `- If you point at a UI element they should look at, append [POINT:x,y:label] at the very end.\n` +
      `- Otherwise append [POINT:none]\n` +
      `- After answering, briefly encourage them to continue.\n\n` +
      `The screenshot is ${screenshotWidth}×${screenshotHeight} pixels (top-left = 0,0).\n` +
      `Page: ${pageTitle} (${pageUrl})`;
  } else {
    system =
      `You are Ophelia, a live browser co-pilot. The user can hear you — write for the ear, not the eye.\n` +
      `You see the user's browser via a screenshot. They are trying to accomplish a goal step by step.\n\n` +
      `RULES:\n` +
      `- Give ONE action per response. Two sentences max. Plain English, casual, warm.\n` +
      `- No markdown, no lists, no bullet points — this will be spoken aloud.\n` +
      `- Never say "simply" or "just".\n` +
      `- When referring to a UI element the user should click, point at it using the tag format below.\n\n` +
      `POINTING:\n` +
      `The screenshot is ${screenshotWidth}×${screenshotHeight} pixels (top-left = 0,0).\n` +
      `If you reference a clickable element, append at the very end of your response:\n` +
      `[POINT:x,y:label]  — e.g. [POINT:340,88:Data tab]\n` +
      `If no element to point at: [POINT:none]\n\n` +
      `GOAL: "${goal}"\n` +
      `Page: ${pageTitle} (${pageUrl})\n` +
      historyCtx;
  }

  const res = await fetch(`${WORKER_BASE}/claude`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 200,
      system,
      messages:   apiMessages,
      stream:     true
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(JSON.stringify(err));
  }

  const reader  = res.body.getReader();
  const decoder  = new TextDecoder();
  let raw         = '';
  let earlyFired  = false;
  let lastPartial = '';

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
          // 5.1: progressive display — send partial spoken text to content script
          if (tabId && raw.length > 0) {
            const partial = raw.replace(/\[POINT:[^\]]+\]$/, '').trim();
            if (partial !== lastPartial) {
              lastPartial = partial;
              chrome.tabs.sendMessage(tabId, { action: 'streamingText', text: partial }).catch(() => {});
            }
          }
          // Early-fire TTS: the moment [POINT: opens, all text before it is the spoken instruction
          if (!earlyFired && raw.includes('[POINT:')) {
            earlyFired = true;
            const earlyText = raw.slice(0, raw.indexOf('[POINT:')).trim();
            if (earlyText && tabId) {
              chrome.tabs.sendMessage(tabId, { action: 'earlyInstruction', instruction: earlyText }).catch(() => {});
            }
          }
        }
      } catch (_) {}
    }
  }

  // Parse [POINT:] tag — same pattern as _parsePointTag in assistant.js
  const pointTag   = raw.match(/\[POINT:[^\]]+\]/);
  const spokenText = pointTag ? raw.slice(0, raw.indexOf(pointTag[0])).trim() : raw.trim();
  const coordMatch = pointTag?.[0].match(/\[POINT:(\d+)\s*,\s*(\d+)(?::([^\]]+))?\]/);
  const x          = coordMatch ? parseInt(coordMatch[1], 10) : null;
  const y          = coordMatch ? parseInt(coordMatch[2], 10) : null;
  const label      = coordMatch ? (coordMatch[3] || null)     : null;

  console.log('🧠 SW analyze:', spokenText.slice(0, 80), x != null ? `→ [${x},${y}]` : '[POINT:none]');

  // Late-fire if [POINT:] never appeared mid-stream (e.g. [POINT:none] lands at very end)
  if (!earlyFired && tabId && spokenText) {
    chrome.tabs.sendMessage(tabId, { action: 'earlyInstruction', instruction: spokenText }).catch(() => {});
  }

  return { spokenText, x, y, label, done: false, _instructionSpoken: earlyFired, _raw: raw };
}


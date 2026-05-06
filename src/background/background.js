// Ophelia Background Service Worker
// Lean baseline: shortcuts, screenshot capture, navigation, tutorial URL handoff.

// Kept for next phase reconnect (currently unused by design).
const AI_CONNECTIONS = {
  CLAUDE_WORKER: 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude',
  MCP_GATEWAY: 'https://ophelia-mcp-gateway.norbertb-consulting.workers.dev',
  THINKING_MCP: 'https://ophelia-thinking-mcp.norbertb-consulting.workers.dev'
};

const MCP_GATEWAY = AI_CONNECTIONS.MCP_GATEWAY;

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    if (command === 'toggle-sphere') {
      chrome.tabs.sendMessage(tabId, { action: 'toggleSphere' }).catch(() => {});
    } else if (command === 'send-firebase') {
      chrome.tabs.sendMessage(tabId, { action: 'toggleRecording' }).catch(() => {});
    }
  });
});

// ── Messages from content scripts ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

  if (request.action === 'tutorialToGuidance') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
          sendResponse({ error: 'No active tab' });
          return;
        }
        if (!isYoutubeWatchOrShortUrl(tab.url)) {
          sendResponse({ error: 'Open a YouTube video tab first (watch, Shorts, or youtu.be).' });
          return;
        }
        const res = await fetch(`${MCP_GATEWAY}/tutorial-to-guidance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: tab.url,
            userContext: request.userContext || 'Not specified',
            speechTranscript: request.speechTranscript || ''
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          sendResponse({ error: data.error || `Gateway ${res.status}` });
          return;
        }
        sendResponse({
          notionPageUrl: data.notionPageUrl,
          databaseUrl: data.databaseUrl,
          stepCount: data.stepCount
        });
      } catch (err) {
        sendResponse({ error: err.message || String(err) });
      }
    })();
    return true;
  }
});

function isYoutubeWatchOrShortUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return u.pathname.replace(/^\//, '').length > 0;
    if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com') {
      if (u.pathname === '/watch' && u.searchParams.get('v')) return true;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/').filter(Boolean).length >= 2;
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/').filter(Boolean).length >= 2;
    }
    return false;
  } catch (_) {
    return false;
  }
}

// ── Tutorial URL detection ────────────────────────────────────────────────────
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;

  let url;
  try {
    url = new URL(details.url);
  } catch (_) {
    return;
  }

  if (url.hostname !== 'testophelia.vercel.app' || url.pathname !== '/tutorial.html') return;

  const sessionId = url.searchParams.get('id');
  if (!sessionId) return;

  chrome.tabs.sendMessage(details.tabId, { action: 'loadTutorial', sessionId }).catch(() => {
    setTimeout(() => {
      chrome.tabs.sendMessage(details.tabId, { action: 'loadTutorial', sessionId }).catch(() => {});
    }, 1000);
  });
});

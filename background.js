// Ophelia Background Service Worker

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
});

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


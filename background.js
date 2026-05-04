// Background service worker for keyboard shortcut handling

chrome.commands.onCommand.addListener((command) => {
  console.log('🎹 Keyboard command received:', command);
  if (command === 'toggle-sphere') {
    console.log('🎯 Toggle sphere command triggered');
    
    // Get active tab and send message to toggle sphere
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleSphere' })
          .then(() => console.log('✅ Toggle message sent'))
          .catch(err => console.error('❌ Failed to send toggle message:', err));
      }
    });
  } else if (command === 'send-firebase') {
    console.log('🎯 Firebase send command triggered');
    
    // Get active tab and send message to send data to Firebase
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Check if content script is loaded, if not inject it
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['gemini-config.js', 'agent-prompt.js', 'gemini-tutor.js', 'content.js']
        }).then(() => {
          // Content script injected, now send message
          chrome.tabs.sendMessage(tabs[0].id, { action: 'sendFirebase' })
            .then(() => console.log('✅ Firebase send message sent'))
            .catch(err => console.error('❌ Failed to send Firebase message:', err));
        }).catch(() => {
          // Script might already be loaded, try sending message directly
          chrome.tabs.sendMessage(tabs[0].id, { action: 'sendFirebase' })
            .then(() => console.log('✅ Firebase send message sent'))
            .catch(err => console.error('❌ Failed to send Firebase message:', err));
        });
      }
    });
  }
});

// Listen for tutorial URL clicks
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    const url = new URL(details.url);
    
    // Check if this is a tutorial URL
    if (url.hostname === 'testophelia.vercel.app' && url.pathname === '/tutorial.html') {
      const sessionId = url.searchParams.get('id');
      if (sessionId) {
        console.log('🎯 Tutorial URL detected:', sessionId);
        
        // Send message to content script to load tutorial
        chrome.tabs.sendMessage(details.tabId, {
          action: 'loadTutorial',
          sessionId: sessionId
        }).catch(err => console.log('Tab not ready for tutorial load'));
      }
    }
  }
});

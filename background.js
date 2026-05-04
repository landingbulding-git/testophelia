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
        // Try sending message directly first (scripts already loaded via manifest)
        chrome.tabs.sendMessage(tabs[0].id, { action: 'sendFirebase' })
          .then(() => console.log('✅ Firebase send message sent'))
          .catch(err => {
            console.log('⚠️ Content script not ready, injecting...');
            // Inject scripts if message fails
            chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['gemini-config.js', 'agent-prompt.js', 'gemini-tutor.js', 'content.js']
            }).then(() => {
              // Content script injected, now send message
              setTimeout(() => {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'sendFirebase' })
                  .then(() => console.log('✅ Firebase send message sent'))
                  .catch(err => console.error('❌ Failed to send Firebase message:', err));
              }, 500); // Wait for scripts to initialize
            }).catch(err => console.error('❌ Failed to inject scripts:', err));
          });
      }
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'navigate') {
    console.log('🎯 Navigate command triggered:', request.url);
    
    // Get active tab and navigate to URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.update(tabs[0].id, { url: request.url })
          .then(() => console.log('✅ Navigation successful'))
          .catch(err => console.error('❌ Navigation failed:', err));
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

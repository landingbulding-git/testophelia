(() => {
  // Audio functionality - declare at top level to avoid initialization errors
  let audioContext = null;
  let microphoneStream = null;
  
  // Speech-to-Text functionality
  let recognition = null;
  let sttResults = [];
  let isSTTActive = false;
  let isListeningMode = false;
  let lastSTTActivity = Date.now();
  
  // Status manager for different states
  let currentStatus = 'background'; // background, listening, thinking, speaking
  
  // Gemini Tutor functionality
  let geminiConfig = null;
  let geminiTutor = null;
  let isTutorEnabled = false;
  
  // Text-to-Speech functionality
  let speechSynthesis = window.speechSynthesis;
  let isTTSEnabled = true;
  let isTTSSpeaking = false;
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSphere);
  } else {
    initializeSphere();
  }
  
  function initializeSphere() {
    // Check if sphere already exists to prevent duplicates
    if (document.getElementById('cross-tab-sphere')) {
      return;
    }

    // Create the sphere element
    const sphere = document.createElement('div');
    sphere.id = 'cross-tab-sphere';
    sphere.className = 'cross-tab-sphere';
    
    // Add tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'sphere-tooltip';
    tooltip.textContent = 'Ctrl+Shift+U to toggle';
    sphere.appendChild(tooltip);
    
    // Add status text
    const statusText = document.createElement('div');
    statusText.className = 'sphere-status';
    statusText.textContent = '';
    sphere.appendChild(statusText);
    
    // Position and style
    sphere.style.position = 'fixed';
    sphere.style.width = '20px';
    sphere.style.height = '20px';
    sphere.style.backgroundColor = '#ff7a1a';
    sphere.style.borderRadius = '50%';
    sphere.style.bottom = '20px';
    sphere.style.right = '20px';
    sphere.style.cursor = 'pointer';
    sphere.style.zIndex = '10000';
    sphere.style.opacity = '0';
    sphere.style.transition = 'all 0.3s ease';
    sphere.style.boxShadow = '0 0 18px #ff7a1a';
    sphere.style.display = 'none'; // Hidden by default
    
    // Add hover effects
    sphere.addEventListener('mouseenter', () => {
      sphere.style.opacity = '1';
      sphere.style.transform = 'scale(1.1)';
      tooltip.style.opacity = '1';
    });
    
    sphere.addEventListener('mouseleave', () => {
      sphere.style.opacity = '0.8';
      sphere.style.transform = 'scale(1)';
      tooltip.style.opacity = '0';
    });
    
    // Add click handler
    sphere.addEventListener('click', handleSphereClick);
    
    // Inject into page
    document.body.appendChild(sphere);
    
    // Initialize sphere functionality
    setupSphereListeners();
    
    // Initialize audio system
    initializeAudio();
    
    // Initialize Gemini Tutor
    initializeGeminiTutor();
        
    // Notify background script that tab is loaded
    notifyTabLoaded();
  }
  
  function handleSphereClick() {
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) return;
    
    // Toggle expansion or trigger action
    sphere.classList.toggle('sphere-expanded');
    
    // Request global toggle
    chrome.runtime.sendMessage({
      action: 'requestGlobalToggle'
    }).then(() => {
      console.log('🔄 Global toggle requested');
    }).catch(err => {
      console.error('Failed to request global toggle:', err);
      // Fallback to local toggle if global fails
      handleLocalToggle();
    });
  }
  
  function setupSphereListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'sphereActivated') {
        handleGlobalToggle();
        sendResponse({ success: true });
      } else if (message.action === 'stopAllActivity') {
        // Stop all activity (TTS, STT, microphone)
        stopAllActivity();
        sendResponse({ success: true });
      } else if (message.action === 'stopSTTAndCallAPI') {
        // Stop STT and trigger API call
        stopSTTAndCallAPI();
        sendResponse({ success: true });
      } else if (message.action === 'welcomeActivation') {
        handleWelcomeActivation();
        sendResponse({ success: true });
      } else if (message.action === 'requestMicrophone') {
        requestMicrophoneAccess();
      } else if (message.action === 'stopMicrophone') {
        stopMicrophone();
      }
      return true;
    });
  }
  
  // Handle global toggle from background script
  function handleGlobalToggle() {
    console.log('🔄 Global toggle received');
    
    if (isListeningMode) {
      // Currently listening - stop and trigger API call
      stopSTTAndCallAPI();
    } else {
      // Not listening - start listening
      performLocalActivation();
    }
  }
  
  // Handle local toggle (fallback)
  function handleLocalToggle() {
    console.log('🔄 Local toggle fallback');
    
    if (isListeningMode) {
      // Currently listening - stop and trigger API call
      stopSTTAndCallAPI();
    } else {
      // Not listening - start listening
      performLocalActivation();
    }
  }
  
  // Start listening mode
  function performLocalActivation() {
    isListeningMode = true;
    currentStatus = 'listening';
    console.log('🎤 Local listening mode activated');
    
    // Request all necessary permissions (only if not already granted)
    requestAllPermissions().catch(() => {
      console.log('⚠️ Permission request failed, continuing with local activation');
    });
    
    // Start STT session
    startSTTSession();
    
    // Visual feedback - pointer to active state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.add('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff0000';
      sphere.style.display = 'block'; // Show sphere when activated
    }
    
    updateStatus('listening...');
    showSTTNotification('Listening mode ON', 'success');
  }
  
  function stopListeningMode() {
    // Request global deactivation
    chrome.runtime.sendMessage({
      action: 'requestGlobalDeactivation'
    }).then(() => {
      console.log('🔴 Global deactivation requested');
    }).catch(err => {
      console.error('Failed to request global deactivation:', err);
      // Fallback to local deactivation
      performLocalDeactivation();
    });
  }
  
  function performLocalDeactivation() {
    isListeningMode = false;
    console.log('🔴 Local listening mode deactivated');
    
    // Stop STT session (this will deactivate microphone)
    stopSTTSession();
    
    // Stop any microphone access directly
    stopMicrophone();
    
    // Visual feedback - pointer back to normal
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.remove('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff7a1a';
    }
    
    currentStatus = 'background';
    clearStatus();
    showSTTNotification('Listening mode OFF', 'info');
  }
  
  // Stop all activity (TTS, STT, microphone)
  function stopAllActivity() {
    console.log('🛑 Stopping all activity on this tab');
    
    // Update status to background
    currentStatus = 'background';
    
    // Stop TTS
    if (speechSynthesis) {
      speechSynthesis.cancel();
      console.log('🔊 TTS stopped');
    }
    isTTSSpeaking = false;
    
    // Stop STT
    if (recognition && isSTTActive) {
      recognition.stop();
      console.log('🎤 STT stopped');
    }
    isSTTActive = false;
    
    // Stop microphone
    stopMicrophone();
    
    // Update sphere to inactive state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.remove('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff7a1a';
    }
    
    isListeningMode = false;
    clearStatus();
    
    // Only show "Activity stopped" if there was actually activity
    if (isListeningMode || isTTSSpeaking || isSTTActive) {
      showSTTNotification('Activity stopped', 'info');
    }
  }
  
  // Stop STT and trigger API call
  function stopSTTAndCallAPI() {
    console.log('🔴 Stopping STT and triggering API call');
    
    // Update status to thinking
    currentStatus = 'thinking';
    updateStatus('thinking...');
    
    // Stop STT session
    if (recognition && isSTTActive) {
      recognition.stop();
      isSTTActive = false;
      console.log('🎤 STT stopped for API call');
    }
    
    // Stop microphone
    stopMicrophone();
    
    // Combine captured speech into complete message
    if (sttResults.length > 0 && isTutorEnabled && geminiTutor) {
      const completeMessage = sttResults.map(result => result.text).join(' ').trim();
      console.log('📤 Sending captured speech to API:', completeMessage);
      
      // Send to Gemini API
      sendToTutor(completeMessage);
      
      // Clear results after sending
      sttResults = [];
    } else {
      console.log('❌ No speech captured or API not available');
      showSTTNotification('No speech captured', 'error');
      
      // Stop everything anyway
      stopAllActivity();
    }
  }
  
  // Initialize Gemini Tutor
  async function initializeGeminiTutor() {
    try {
      geminiConfig = new GeminiConfig();
      await geminiConfig.initialize();
      
      if (geminiConfig.isConfigured) {
        geminiTutor = new GeminiTutor(geminiConfig);
        await geminiTutor.initialize();
        isTutorEnabled = true;
        console.log('✅ Gemini Tutor enabled');
      } else {
        console.log('⚠️ Gemini Tutor disabled - API key not configured');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Gemini Tutor:', error);
    }
  }
  
  // Send STT result to Gemini Tutor
  async function sendToTutor(userMessage) {
    if (!isTutorEnabled || !geminiTutor) {
      console.log('❌ Gemini Tutor not available');
      return;
    }
    
    try {
      // Update status to thinking
      currentStatus = 'thinking';
      updateStatus('thinking...');
      showSTTNotification('🤖 Thinking...', 'info');
      
      const response = await geminiTutor.getTutoringResponse(userMessage);
      
      // Display tutor response
      showTutorResponse(response);
      
      // Update status to speaking and activate TTS
      currentStatus = 'speaking';
      updateStatus('speaking...');
      speakResponse(response);
      
    } catch (error) {
      console.error('❌ Tutor response failed:', error);
      showSTTNotification(`Tutor error: ${error.message}`, 'error');
    }
  }
  
  // Display tutor response
  function showTutorResponse(response) {
    console.log('🤖 AI Response:', response);
  }
  
  // Text-to-Speech function
  function speakResponse(text) {
    if (!isTTSEnabled || !speechSynthesis) {
      console.log('🔊 TTS disabled or not available');
      return;
    }
    
    // Stop any ongoing speech
    speechSynthesis.cancel();
    
    // Create new utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Event handlers
    utterance.onstart = () => {
      console.log('🔊 TTS started - speaking response');
      isTTSSpeaking = true;
    };
    
    utterance.onend = () => {
      console.log('🔊 TTS finished');
      isTTSSpeaking = false;
      currentStatus = 'background';
      clearStatus();
    };
    
    utterance.onerror = (event) => {
      console.error('❌ TTS Error:', event.error);
      isTTSSpeaking = false;
      currentStatus = 'background';
      clearStatus();
    };
    
    // Start speaking
    speechSynthesis.speak(utterance);
  }
  
  // ShaveDOM function for DOM data
  function shaveDOM() {
    console.log('🔍 Scanning DOM for interactive elements...');
    
    const interactiveElements = [];
    const interactiveSelectors = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[onclick]', '[onmousedown]', '[onmouseup]',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="tab"]', '[role="option"]', '[role="checkbox"]',
      '[role="radio"]', '[aria-label]', '[aria-describedby]',
      '[data-testid]', '[data-action]', '[data-click]'
    ];
    
    const elements = document.querySelectorAll(interactiveSelectors.join(', '));
    
    elements.forEach(element => {
      try {
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);
        
        if (computedStyle.display === 'none' || 
            computedStyle.visibility === 'hidden' || 
            computedStyle.opacity === '0' ||
            rect.width === 0 || rect.height === 0) {
          return;
        }
        
        const elementData = {
          text: element.textContent?.trim().substring(0, 50) || '',
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          aria: {
            label: element.getAttribute('aria-label') || '',
            role: element.getAttribute('role') || '',
            describedby: element.getAttribute('aria-describedby') || '',
            expanded: element.getAttribute('aria-expanded') || ''
          },
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          class: element.className || '',
          href: element.href || '',
          type: element.type || '',
          value: element.value || '',
          placeholder: element.placeholder || '',
          testid: element.getAttribute('data-testid') || '',
          action: element.getAttribute('data-action') || '',
          clickable: true
        };
        
        if (elementData.text || elementData.aria.label || elementData.aria.role || elementData.id || elementData.testid) {
          interactiveElements.push(elementData);
        }
      } catch (error) {
        console.warn('Error processing element:', error);
      }
    });
    
    interactiveElements.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 20) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });
    
    console.log(`📊 Found ${interactiveElements.length} interactive elements`);
    return interactiveElements;
  }
  
  // Audio system initialization
  function initializeAudio() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('🎵 Audio context initialized');
    } catch (error) {
      console.error('❌ Failed to initialize audio context:', error);
    }
  }
  
  // Start STT session
  function startSTTSession() {
    try {
      console.log('🎤 Starting STT session...');
      
      // Check if browser supports speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.error('❌ Speech recognition not supported');
        showSTTNotification('Speech recognition not supported', 'error');
        return;
      }
      
      // Stop existing session if any
      if (recognition && isSTTActive) {
        recognition.stop();
      }
      
      // Initialize speech recognition
      recognition = new SpeechRecognition();
      
      // Configure recognition for one-shot recording
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      // Event handlers
      recognition.onstart = () => {
        isSTTActive = true;
        lastSTTActivity = Date.now();
        console.log('🎤 STT session started - microphone activated');
      };
      
      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }
        
        if (finalTranscript.trim()) {
          // Store final result
          sttResults.push({
            text: finalTranscript.trim(),
            timestamp: Date.now()
          });
          
          console.log('🗣️ STT Result:', finalTranscript.trim());
          showSTTNotification(`Heard: "${finalTranscript.trim()}"`, 'success');
          
          // Keep only last 10 results to manage memory
          if (sttResults.length > 10) {
            sttResults.shift();
          }
          
          // NO AUTOMATIC PAUSE DETECTION - user controls when to stop with shortcut
        }
        
        if (interimTranscript) {
          console.log('🔄 STT Interim:', interimTranscript);
        }
      };
      
      recognition.onerror = (event) => {
        console.error('❌ STT Error:', event.error);
        showSTTNotification(`STT Error: ${event.error}`, 'error');
        
        // Don't auto-restart on error - user controls when to restart
      };
      
      recognition.onend = () => {
        console.log('🎤 STT session ended - microphone deactivated');
        isSTTActive = false;
        
        // Ensure microphone is stopped
        stopMicrophone();
        
        // NO AUTO-RESTART - one-shot process only
        console.log('🛑 STT stopped - one-shot process complete');
      };
      
      // Start recognition
      recognition.start();
      
    } catch (error) {
      console.error('❌ Failed to start STT:', error);
      showSTTNotification('Failed to start speech recognition', 'error');
    }
  }
    
  // Stop STT session
  function stopSTTSession() {
    if (recognition && isSTTActive) {
      recognition.stop();
      isSTTActive = false;
      console.log('🎤 STT session stopped manually - microphone deactivated');
      
      // Ensure microphone is stopped
      stopMicrophone();
    }
  }
  
  // Microphone control functions
  function requestMicrophoneAccess() {
    if (!audioContext) {
      console.error('❌ Audio context not initialized');
      return;
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        microphoneStream = stream;
        console.log('🎤 Microphone access granted');
      })
      .catch(error => {
        console.error('❌ Microphone access denied:', error);
        showSTTNotification('Microphone access denied', 'error');
      });
  }
  
  function stopMicrophone() {
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
      console.log('🎤 Microphone stopped');
    }
  }
  
  // Status display functions
  function updateStatus(status) {
    const statusText = document.querySelector('.sphere-status');
    if (statusText) {
      statusText.textContent = status;
      statusText.style.opacity = '1';
    }
    console.log('📊 Status updated:', status);
  }
  
  function clearStatus() {
    const statusText = document.querySelector('.sphere-status');
    if (statusText) {
      statusText.textContent = '';
      statusText.style.opacity = '0';
    }
  }
  
  // Notification functions
  function showSTTNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.stt-notification');
    if (existing) {
      existing.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `stt-notification stt-${type}`;
    notification.textContent = message;
    
    // Style notification
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.padding = '10px 15px';
    notification.style.borderRadius = '5px';
    notification.style.color = 'white';
    notification.style.fontSize = '14px';
    notification.style.zIndex = '10001';
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease';
    
    // Set background color based on type
    switch (type) {
      case 'success':
        notification.style.backgroundColor = '#4CAF50';
        break;
      case 'error':
        notification.style.backgroundColor = '#f44336';
        break;
      case 'info':
        notification.style.backgroundColor = '#2196F3';
        break;
      default:
        notification.style.backgroundColor = '#ff7a1a';
    }
    
    // Add to page
    document.body.appendChild(notification);
    
    // Fade in
    setTimeout(() => {
      notification.style.opacity = '1';
    }, 10);
    
    // Remove after 4 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 4000);
  }
  
  // Permission management
  async function requestAllPermissions() {
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('🎤 Microphone permission granted');
      
      // Request notification permission if needed
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
        console.log('🔔 Notification permission requested');
      }
      
      return true;
    } catch (error) {
      console.error('❌ Permission request failed:', error);
      return false;
    }
  }
  
  // Background script communication
  function notifyTabLoaded() {
    chrome.runtime.sendMessage({
      action: 'tabLoaded',
      tabId: chrome.runtime.id || 'unknown'
    }).catch(err => {
      console.log('⚠️ Failed to notify background script:', err);
    });
  }
  
  function handleWelcomeActivation() {
    console.log('👋 Welcome activation received');
    performLocalActivation();
  }
  
  // Add CSS styles
  const style = document.createElement('style');
  style.textContent = `
    .sphere-tooltip {
      position: absolute;
      bottom: 25px;
      right: 0;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 5px 10px;
      border-radius: 3px;
      font-size: 12px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    
    .sphere-status {
      position: absolute;
      bottom: -20px;
      right: 0;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 11px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    
    .sphere-active {
      background-color: #ff0000 !important;
      animation: pulse 1.5s infinite;
    }
    
    @keyframes pulse {
      0% { box-shadow: 0 0 18px #ff0000; }
      50% { box-shadow: 0 0 30px #ff0000; }
      100% { box-shadow: 0 0 18px #ff0000; }
    }
    
    .stt-notification {
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    }
  `;
  document.head.appendChild(style);
  
  // Expose functions to global scope for debugging
  window.opheliaExtension = {
    startListening: () => performLocalActivation(),
    stopListening: () => stopSTTAndCallAPI(),
    getStatus: () => currentStatus,
    getSTTResults: () => sttResults,
    shaveDOM: shaveDOM
  };
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    // Stop microphone to prevent issues
    stopMicrophone();
    
    // Stop STT session
    if (isSTTActive) {
      stopSTTSession();
    }
    
    // Close audio context
    if (audioContext) {
      try {
        audioContext.close();
      } catch (error) {
        console.debug('Error closing audio context:', error);
      }
      audioContext = null;
    }
    
    console.log('🧹 Cleanup completed');
  });
  
})();

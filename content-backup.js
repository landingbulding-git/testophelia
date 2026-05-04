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
    tooltip.textContent = 'Cross-Tab Utility (Ctrl+Shift+U)';
    sphere.appendChild(tooltip);
    
    // Add status text
    const statusText = document.createElement('div');
    statusText.id = 'sphere-status';
    statusText.className = 'sphere-status';
    statusText.textContent = '';
    sphere.appendChild(statusText);
    
    // Position sphere in top middle
    sphere.style.position = 'fixed';
    sphere.style.top = '20px';
    sphere.style.left = '50%';
    sphere.style.transform = 'translateX(-50%)';
    sphere.style.zIndex = '999999';
    
    // Add click interaction
    sphere.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSphereClick();
    });
    
    // Add hover effects
    sphere.addEventListener('mouseenter', () => {
      sphere.classList.add('sphere-hover');
    });
    
    sphere.addEventListener('mouseleave', () => {
      sphere.classList.remove('sphere-hover');
    });
    
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
    
    // Play calm voice sound
    playCalmVoice();
    
    // Request microphone access for testing
    requestMicrophoneAccess();
    
    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'sphereClicked',
      url: window.location.href,
      timestamp: Date.now()
    }).catch(err => {
      console.debug('Failed to send sphere click message:', err);
    });
    
    // Visual feedback
    createRippleEffect(sphere);
  }
  
  function handleToggleSphere() {
    // Toggle listening mode
    if (isListeningMode) {
      stopListeningMode();
    } else {
      startListeningMode();
    }
  }
  
  function startListeningMode() {
    // Request global activation instead of local activation
    chrome.runtime.sendMessage({
      action: 'requestGlobalActivation'
    }).then(() => {
      console.log('🎯 Global activation requested');
    }).catch(err => {
      console.error('Failed to request global activation:', err);
      // Fallback to local activation if global fails
      performLocalActivation();
    });
  }
  
  function performLocalActivation() {
    isListeningMode = true;
    console.log('🎤 Local listening mode activated');
    
    // Refresh site if needed to display properly
    ensureSiteDisplay();
    
    // Request all necessary permissions (only if not already granted)
    requestAllPermissions().catch(() => {
      // Continue even if permissions fail
    });
    
    startSTTSession();
    
    // Visual feedback - pointer to active state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.add('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff0000';
    }
    
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
    console.log('🎤 Local listening mode deactivated');
    
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
    
    clearStatus();
    showSTTNotification('Listening mode OFF', 'info');
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
      } else if (message.action === 'requestMicrophone') {
        requestMicrophoneAccess();
      } else if (message.action === 'stopMicrophone') {
        stopMicrophone();
      } else if (message.action === 'syncGlobalState') {
        handleSyncGlobalState(message.state, message.isActive);
      } else if (message.action === 'toggleSphere') {
        handleToggleSphere();
      }
      return true;
    });
  }
  
  function notifyTabLoaded() {
    chrome.runtime.sendMessage({
      action: 'tabLoaded',
      url: window.location.href,
      title: document.title
    }).catch(err => {
      console.debug('Failed to send tab loaded message:', err);
    });
  }
  
  function updateSphereState(data) {
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) return;
    
    // Update sphere based on cross-tab state
    if (data.active) {
      sphere.classList.add('sphere-active');
    } else {
      sphere.classList.remove('sphere-active');
    }
  }
  
  function handleCrossTabClick(message) {
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) return;
    
    // Visual feedback for cross-tab click
    sphere.classList.add('sphere-cross-tab-activated');
    setTimeout(() => {
      sphere.classList.remove('sphere-cross-tab-activated');
    }, 800);
  }
  
  function toggleSphereVisibility() {
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) return;
    
    sphere.classList.toggle('sphere-hidden');
  }
  
  // Handle global state synchronization
  function handleGlobalStateSync(state, isActive) {
    console.log('🔄 Syncing global state:', { state, isActive });
    
    // Update sphere visibility based on global state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      if (state.globalActive) {
        sphere.style.display = 'block';
        sphere.style.opacity = '1';
        sphere.style.visibility = 'visible';
        
        if (isActive) {
          // This is the active tab - show active state and start activation sequence
          sphere.classList.add('sphere-active');
          sphere.style.boxShadow = '0 0 25px #ff0000, 0 0 50px rgba(255, 0, 0, 0.5)';
          isListeningMode = true;
          
          // Trigger the full activation sequence
          performLocalActivation();
        } else {
          // Not active tab - show inactive state
          sphere.classList.remove('sphere-active');
          sphere.style.boxShadow = '0 0 18px #ff7a1a';
          isListeningMode = false;
        }
      } else {
        // Extension is globally inactive
        sphere.classList.remove('sphere-active');
        sphere.style.boxShadow = '0 0 18px #ff7a1a';
        isListeningMode = false;
      }
    }
  }
  
  // Handle global deactivation
  function handleGlobalDeactivation() {
    console.log('🔴 Global deactivation received');
    
    // Trigger the full deactivation sequence
    performLocalDeactivation();
    
    // Update sphere
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.remove('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff7a1a';
    }
  }
  
  // Handle permissions synchronization
  function handlePermissionsSync(permissions) {
    console.log('🔐 Syncing permissions:', permissions);
    
    if (permissions.granted) {
      // Permissions are granted - no need to request again
      showSTTNotification('Permissions synced', 'success');
    }
  }
  
  // Handle global toggle request
  function handleGlobalToggle() {
    const currentTabId = chrome.runtime.id ? chrome.tabs.getCurrent?.()?.then?.(tab => tab.id) : null;
    
    // Request global activation for this tab
    chrome.runtime.sendMessage({
      action: 'requestGlobalActivation'
    }).catch(err => {
      console.error('Failed to request global activation:', err);
    });
  }
  
  // Handle sync global state from background
  function handleSyncGlobalState(state, isActive) {
    console.log('🔄 Syncing global state:', { state, isActive });
    
    // Update local state
    isListeningMode = isActive;
    
    // Update sphere visual state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      if (isActive) {
        sphere.classList.add('sphere-active');
        sphere.style.boxShadow = '0 0 25px #ff8c42';
      } else {
        sphere.classList.remove('sphere-active');
        sphere.style.boxShadow = '0 0 18px #ff7a1a';
      }
    }
    
    // If this tab becomes active, start listening
    if (isActive) {
      startSTTSession();
      showSTTNotification('Listening mode activated', 'success');
    } else {
      stopAllActivity();
    }
  }
  
  // Handle welcome activation
  function handleWelcomeActivation() {
    console.log('🎉 Welcome activation received');
    playAIWelcomeSound();
    
    // Show visual feedback
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.add('sphere-expanded');
      setTimeout(() => {
        sphere.classList.remove('sphere-expanded');
      }, 1000);
    }
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
    
    // Clear timers
    if (pauseDetectionTimer) {
      clearTimeout(pauseDetectionTimer);
      pauseDetectionTimer = null;
    }
    
    // Update sphere to inactive state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.remove('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff7a1a';
    }
    
    isListeningMode = false;
    clearStatus();
    
    showSTTNotification('Activity stopped', 'info');
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
      
      // Check if response needs enhancement
      if (response && response.includes && response.includes('enhance')) {
        // Display enhanced tutor response
        showTutorResponse(response);
        
        // Activate TTS when API response is received
        updateStatus('speaking...');
        speakResponse(response);
        
        return;
      }
      
      // Display tutor response
      showTutorResponse(response);
      
      // Activate TTS when API response is received
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
      clearStatus();
    };
    
    utterance.onerror = (event) => {
      console.error('❌ TTS Error:', event.error);
      isTTSSpeaking = false;
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
    
  // Initialize Gemini Tutor
  async function initializeGeminiTutor() {
    try {
      // Check cross-tab permissions first
      await checkCrossTabPermissions();
      
      geminiConfig = new GeminiConfig();
      await geminiConfig.initialize();
      
      if (geminiConfig.isConfigured) {
        geminiTutor = new GeminiTutor(geminiConfig);
        await geminiTutor.initialize();
        isTutorEnabled = true;
        console.log('✅ Gemini Tutor enabled');
        showTutorNotification('Tutor ready! Ask me about web tools.', 'success');
      } else {
        console.log('⚠️ Gemini Tutor disabled - API key not configured');
        showTutorNotification('Tutor disabled. Set API key via console: geminiConfig.setApiKeySecurely("your-api-key")', 'info');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Gemini Tutor:', error);
      showTutorNotification('Tutor initialization failed', 'error');
    }
  }
  
  // Check permissions validity across tabs
  async function checkCrossTabPermissions() {
    try {
      const result = await chrome.storage.local.get(['microphonePermission', 'permissionTimestamp']);
      
      if (result.microphonePermission !== 'granted' || !result.permissionTimestamp) {
        console.log('🔐 No cross-tab permissions found, requesting...');
        return false;
      }
      
      // Check if permissions are still valid (within 24 hours)
      const now = Date.now();
      const permissionAge = now - result.permissionTimestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (permissionAge > maxAge) {
        console.log('🔐 Permissions expired, requesting new ones...');
        return false;
      }
      
      console.log('✅ Cross-tab permissions valid');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to check cross-tab permissions:', error);
      return false;
    }
  }
  
  function initializeAudio() {
    if (audioContext) {
      return; // Already initialized
    }
    
    try {
      // Initialize Web Audio API
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Audio system initialized');
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      audioContext = null;
    }
  }
  
  async function playAIWelcomeSound() {
    try {
      // Initialize audio if not already done
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio context created for AI welcome');
      }
      
      // Resume audio context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      // Create AI-like welcome sound (similar to ChatGPT/Claude voice activation)
      const oscillator1 = audioContext.createOscillator();
      const oscillator2 = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      
      // Connect nodes for richer sound
      oscillator1.connect(filter);
      oscillator2.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // AI voice-like parameters
      oscillator1.type = 'sine';
      oscillator1.frequency.setValueAtTime(440, audioContext.currentTime); // A4
      oscillator1.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.1); // A5
      oscillator1.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.3); // Back to A4
      
      oscillator2.type = 'triangle';
      oscillator2.frequency.setValueAtTime(220, audioContext.currentTime); // A3
      oscillator2.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.2); // A4
      
      // Filter for voice-like quality
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1000, audioContext.currentTime);
      filter.Q.setValueAtTime(10, audioContext.currentTime);
      
      // Envelope for smooth AI-like sound
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.25, audioContext.currentTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.4);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      
      // Play the sound
      oscillator1.start(audioContext.currentTime);
      oscillator2.start(audioContext.currentTime);
      oscillator1.stop(audioContext.currentTime + 0.8);
      oscillator2.stop(audioContext.currentTime + 0.8);
      
      console.log('🤖 AI welcome sound played');
    } catch (error) {
      console.error('Failed to play AI welcome sound:', error);
    }
  }
  
  function startSTTSession() {
    try {
      // Check if Web Speech API is available
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('❌ Speech Recognition not supported in this browser');
        showSTTNotification('Speech Recognition not supported', 'error');
        return;
      }
      
      // Stop existing session if any
      if (recognition && isSTTActive) {
        recognition.stop();
      }
      
      // Initialize speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
        
        if (finalTranscript) {
          // Update last activity time
          lastSTTActivity = Date.now();
          
          // Store final result temporarily
          sttResults.push({
            text: finalTranscript.trim(),
            timestamp: Date.now(),
            url: window.location.href
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
        
        // KEEP RECOGNITION RUNNING - don't stop when user stops talking
        // The continuous flag should handle this, but let's ensure it stays active
      };
      
      recognition.onerror = (event) => {
        console.error('❌ STT Error:', event.error);
        showSTTNotification(`STT Error: ${event.error}`, 'error');
        
        // Restart STT session if it's a network error (common issue)
        if (event.error === 'network' && isListeningMode) {
          console.log('🔄 Restarting STT due to network error...');
          setTimeout(() => {
            if (isListeningMode) {
              startSTTSession();
            }
          }, 1000);
        }
      };
      
      recognition.onend = () => {
        console.log('🎤 STT session ended - microphone deactivated');
        isSTTActive = false;
        
        // Ensure microphone is stopped
        stopMicrophone();
        
        // NO AUTO-RESTART - one-shot process only
        console.log('� STT stopped - one-shot process complete');
      };
      
      // Start recognition
      recognition.start();
      
    } catch (error) {
      console.error('❌ Failed to start STT:', error);
      showSTTNotification('Failed to start speech recognition', 'error');
    }
  }
  
    
  function stopSTTSession() {
    if (recognition && isSTTActive) {
      recognition.stop();
      isSTTActive = false;
      console.log('🎤 STT session stopped manually - microphone deactivated');
      
      // Ensure microphone is stopped
      stopMicrophone();
    }
  }
  
  function getSTTResults() {
    return [...sttResults]; // Return copy of results
  }
  
  function clearSTTResults() {
    sttResults = [];
    console.log('🗑️ STT results cleared');
  }
  
  function showSTTNotification(message, type) {
    // Create temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : type === 'listening' ? '#ff8800' : '#4444ff'};
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-family: system-ui;
      z-index: 1000000;
      opacity: 0;
      transition: opacity 0.3s;
      max-width: 300px;
      text-align: center;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
      notification.style.opacity = '1';
    }, 10);
    
    // Hide after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 4000);
  }
  
  // Update status text next to sphere
  function updateStatus(text) {
    const statusElement = document.getElementById('sphere-status');
    if (statusElement) {
      statusElement.textContent = text;
      statusElement.style.opacity = '1';
    }
  }
  
  // Clear status text
  function clearStatus() {
    const statusElement = document.getElementById('sphere-status');
    if (statusElement) {
      statusElement.textContent = '';
    }
  }
  
  // Tutor notification function
  function showTutorNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : type === 'info' ? '#4444ff' : '#8a2be2'};
      color: white;
      padding: 12px 20px;
      border-radius: 25px;
      font-size: 13px;
      font-family: system-ui;
      z-index: 1000001;
      opacity: 0;
      transition: all 0.3s;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 4000);
  }
  
    
  // Display tutor response (removed - now only uses TTS)
  function showTutorResponse(response) {
    // Text box removed - AI response goes to speaker only
    console.log('🤖 AI Response (TTS only):', response);
  }
  
  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
    .cross-tab-sphere {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #ff7a1a, #ff4500);
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 0 18px #ff7a1a;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .sphere-status {
      position: absolute;
      left: 50px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-family: system-ui, -apple-system, sans-serif;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      z-index: 1000000;
    }
  `;
  document.head.appendChild(style);
  
  // Expose helper functions to console for status checking
  window.getTutorStatus = function() {
    return {
      enabled: isTutorEnabled,
      apiKeyConfigured: geminiConfig ? geminiConfig.isApiKeyConfigured() : false,
      maskedKey: geminiConfig ? geminiConfig.getMaskedApiKey() : null,
      sttActive: isSTTActive,
      ttsEnabled: isTTSEnabled,
      isListening: isListeningMode,
      isTTSSpeaking: isTTSSpeaking
    };
  };
  
  // Expose shaveDOM function for Gemini tutor
  window.shaveDOM = shaveDOM;
  console.log(`
🤖 Gemini Tutor Status:
✅ API key is hardcoded in gemini-config.js
✅ Ready to use once API key is set
💡 Check status with: getTutorStatus()
🎯 Use Ctrl+Shift+U to start tutoring
  `);
  
  // Text-to-Speech function with 3-sentence limit
  function speakResponse(text) {
    if (!speechSynthesis) {
      console.log('❌ Speech Synthesis not supported');
      return;
    }
    
    try {
      // Cancel any ongoing speech
      speechSynthesis.cancel();
      
      // Limit to 3 sentences
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const limitedText = sentences.slice(0, 3).join('. ') + (sentences.length > 3 ? '.' : '');
      
      // Create speech synthesis utterance
      const utterance = new SpeechSynthesisUtterance(limitedText);
      
      // Configure voice settings for natural sound
      utterance.rate = 1.0;        // Normal speed
      utterance.pitch = 1.0;       // Normal pitch
      utterance.volume = 0.8;      // Slightly quieter
      
      // Select a natural voice if available
      const voices = speechSynthesis.getVoices();
      const preferredVoice = voices.find(voice => 
        voice.name.includes('Samantha') || 
        voice.name.includes('Karen') || 
        voice.name.includes('Alex') ||
        voice.name.includes('Daniel') ||
        (voice.lang.startsWith('en') && voice.name.includes('Female'))
      );
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      
      // Event handlers
      utterance.onstart = () => {
        console.log('🔊 TTS started - speaking response');
        showTutorNotification('🔊 Speaking...', 'info');
        isTTSSpeaking = true;
      };
      
      utterance.onend = () => {
        console.log('🔊 TTS finished');
        isTTSSpeaking = false;
        clearStatus();
      };
      
      utterance.onerror = (event) => {
        console.error('❌ TTS Error:', event.error);
        isTTSSpeaking = false;
      };
      
      // Start speaking
      speechSynthesis.speak(utterance);
      
    } catch (error) {
      console.error('❌ Failed to speak response:', error);
    }
  }
  
    
  // Initialize voices (needs to be called after user interaction)
  function initializeVoices() {
    if (speechSynthesis) {
      speechSynthesis.getVoices();
    }
  }
  
  // Load voices when they become available
  if (speechSynthesis) {
    speechSynthesis.onvoiceschanged = initializeVoices;
  }
}

// Load voices when they become available
if (speechSynthesis) {
  speechSynthesis.onvoiceschanged = initializeVoices;
}

function stopMicrophone() {
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
    console.log('🎤 Microphone stopped');
  }
}

// Request microphone access
async function requestMicrophoneAccess() {
  try {
    if (!microphoneStream) {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('🎤 Microphone access granted');
    }
    
    // Check if sphere exists
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) {
      console.log('🔄 Sphere not found, reinitializing...');
      initializeSphere();
    } else {
      // Make sure sphere is visible and properly positioned
      sphere.style.display = 'block';
      sphere.style.opacity = '1';
      sphere.style.visibility = 'visible';
    }
  } catch (error) {
    console.error('❌ Microphone access denied:', error);
  }
}

// Request all necessary permissions for cross-tab functionality
async function requestAllPermissions() {
  try {
    // Check if permissions are already granted
    const result = await chrome.storage.local.get(['microphonePermission', 'permissionTimestamp']);
      
      if (result.microphonePermission === 'granted' && result.permissionTimestamp) {
        // Check if permissions are still valid (within 24 hours)
        const now = Date.now();
        const permissionAge = now - result.permissionTimestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (permissionAge < maxAge) {
          console.log('✅ Permissions already valid');
          return;
        }
      }
      
      // Request microphone permission
      const micPermission = await navigator.permissions.query({ name: 'microphone' });
      if (micPermission.state === 'denied') {
        showSTTNotification('Microphone permission denied. Please enable in browser settings.', 'error');
        return;
      }
      
      // Request microphone access to ensure it's available
      if (!microphoneStream) {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true,
          video: false 
        });
        
        // Immediately stop the stream - we just needed permission
        stream.getTracks().forEach(track => track.stop());
        console.log('🎤 Microphone permission granted');
      }
      
      // Store permission state for cross-tab validity
      await chrome.storage.local.set({
        microphonePermission: 'granted',
        permissionTimestamp: Date.now()
      });
      
      showSTTNotification('All permissions granted', 'success');
      
    } catch (error) {
      console.error('❌ Permission request failed:', error);
      showSTTNotification('Permission request failed', 'error');
      throw error; // Re-throw to allow caller to handle
    }
  }
  
  function createRippleEffect(element) {
    const ripple = document.createElement('div');
    ripple.className = 'sphere-ripple';
    element.appendChild(ripple);
    
    setTimeout(() => {
      ripple.remove();
    }, 1000);
  }
  
  // Ensure site display
  function ensureSiteDisplay() {
    // Force reflow to ensure sphere is visible
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.style.display = 'none';
      sphere.offsetHeight; // Force reflow
      sphere.style.display = 'block';
    }
  }
  
  // Play calm voice sound
  function playCalmVoice() {
    // Simple audio feedback
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
    audio.volume = 0.1;
    audio.play().catch(() => {});
  }
  
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
    
    // Safely send message to background script
    try {
      chrome.runtime.sendMessage({
        action: 'tabUnloaded',
        url: window.location.href
      }).catch(err => {
        // Extension context invalidated - ignore
        console.debug('Extension context invalidated on unload');
      });
    } catch (error) {
      console.debug('Failed to send unload message:', error);
    }
  });
  
  // Handle extension context invalidation
  if (chrome.runtime && chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      port.onDisconnect.addListener(() => {
        console.log('Extension context invalidated - cleaning up');
        
        // Clean up all resources
        stopListeningMode();
        
        // Remove sphere from DOM
        const sphere = document.getElementById('cross-tab-sphere');
        if (sphere) {
          sphere.remove();
        }
      });
    });
  }
  
})();

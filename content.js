(() => {
  // Audio functionality
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
  
  // DOM scan result storage (temporary, single result)
  let domScanResult = null;
  let lastScannedURL = null;
  let initialDOMElements = []; // Initial page elements
  let injectedDOMElements = []; // New injected elements
  
  // Firebase configuration
  let firebaseInitialized = true; // REST API doesn't need initialization
  
  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY_HERE", // Replace with your Firebase API key
    projectId: "ophelia-bd2e0", // Replace with your Firebase project ID
    authDomain: "ophelia-bd2e0.firebaseapp.com" // Replace with your Firebase auth domain
  };
  
  // Session tracking variables
  let sessionActive = false;
  let sessionSteps = [];
  let sessionStartTime = null;
  let clickListener = null;
  let navigationListener = null;
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSphere);
  } else {
    initializeSphere();
  }
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleSphere') {
      handleSphereClick();
      sendResponse({ success: true });
    } else if (message.action === 'sendFirebase') {
      toggleSessionTracking();
      sendResponse({ success: true });
    } else if (message.action === 'loadTutorial') {
      // Load tutorial from Firebase
      loadTutorialFromFirebase(message.sessionId);
      sendResponse({ success: true });
    }
    return true;
  });
  
  function initializeSphere() {
    // Check if sphere already exists
    if (document.getElementById('cross-tab-sphere')) {
      return;
    }

    // Create sphere element
    const sphere = document.createElement('div');
    sphere.id = 'cross-tab-sphere';
    sphere.className = 'cross-tab-sphere';
    
    // Position and style (12% smaller: 20px -> 17.6px, rounded to 18px)
    sphere.style.position = 'fixed';
    sphere.style.width = '18px';
    sphere.style.height = '18px';
    sphere.style.backgroundColor = '#ff7a1a';
    sphere.style.borderRadius = '50%';
    sphere.style.bottom = '20px';
    sphere.style.right = '20px';
    sphere.style.cursor = 'pointer';
    sphere.style.zIndex = '10000';
    sphere.style.opacity = '0.8';
    sphere.style.transition = 'transform 0.1s ease-out, opacity 0.3s ease';
    sphere.style.boxShadow = '0 0 18px #ff7a1a';
    sphere.style.pointerEvents = 'auto';
    
    // Add click handler
    sphere.addEventListener('click', handleSphereClick);
    
    // Add intelligent mouse following
    setupMouseFollowing(sphere);
    
    // Inject into page
    document.body.appendChild(sphere);
    
    // Initialize Gemini Tutor
    initializeGeminiTutor();
    
    // Firebase REST API doesn't need initialization
    
    // Start URL change detection
    startURLChangeDetection();
    
    // Start MutationObserver for DOM changes
    startMutationObserver();
    
    // Check for existing session on load
    checkForExistingSession();
  }
  
  function handleSphereClick() {
    const sphere = document.getElementById('cross-tab-sphere');
    if (!sphere) return;
    
    // Toggle expansion or trigger action
    sphere.classList.toggle('sphere-expanded');
    
    // Check if currently speaking - stop TTS immediately
    if (currentStatus === 'speaking' && isTTSSpeaking) {
      console.log('🛑 Stopping TTS - shortcut pressed during speaking');
      speechSynthesis.cancel();
      isTTSSpeaking = false;
      currentStatus = 'background';
      showSTTNotification('Speaking stopped', 'info');
      return;
    }
    
    // Normal toggle logic
    if (isListeningMode) {
      // Currently listening - stop
      stopSTTSession();
    } else {
      // Not listening - start
      startSTTSession();
    }
  }
  
  // Start URL change detection
  function startURLChangeDetection() {
    console.log('🔍 Starting URL change detection...');
    
    // Initial scan on page load
    performDOMScan();
    
    // Listen for URL changes (for SPA navigation)
    let lastURL = window.location.href;
    
    // Method 1: Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      if (window.location.href !== lastURL) {
        console.log('🔄 URL changed (popstate):', window.location.href);
        lastURL = window.location.href;
        performDOMScan();
      }
    });
    
    // Method 2: Monitor URL changes with setInterval (for SPA navigation)
    setInterval(() => {
      if (window.location.href !== lastURL) {
        console.log('🔄 URL changed (polling):', window.location.href);
        lastURL = window.location.href;
        performDOMScan();
      }
    }, 1000); // Check every second
  }
  
  // Perform DOM scan and store result
  function performDOMScan() {
    const currentURL = window.location.href;
    
    // Only scan if URL has changed
    if (currentURL === lastScannedURL) {
      console.log('⏭️ Skipping scan - URL unchanged');
      return;
    }
    
    console.log('🔍 Performing DOM scan for:', currentURL);
    const result = scanDOM();
    
    // Store result (overwrites previous)
    domScanResult = result;
    lastScannedURL = currentURL;
    
    // Store initial elements separately
    initialDOMElements = result.elements;
    injectedDOMElements = []; // Reset injected elements on URL change
    
    console.log('💾 DOM scan result stored for:', currentURL);
    console.log('📊 Initial elements:', initialDOMElements.length);
  }
  
  // Start MutationObserver for DOM changes
  function startMutationObserver() {
    console.log('🔬 Starting MutationObserver...');
    
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is an interactive element
              const interactiveElement = checkInteractiveElement(node);
              if (interactiveElement) {
                console.log('🆕 New interactive element detected:', interactiveElement.label);
                injectedDOMElements.push(interactiveElement);
                updateDOMResult();
              }
              
              // Also check children of the added node
              const interactiveChildren = findInteractiveElements(node);
              interactiveChildren.forEach((child) => {
                if (!isElementAlreadyStored(child.id)) {
                  console.log('🆕 New interactive child element detected:', child.label);
                  injectedDOMElements.push(child);
                  updateDOMResult();
                }
              });
            }
          });
        }
      });
    });
    
    // Start observing the document body
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    console.log('✅ MutationObserver started');
  }
  
  // Check if element is interactive
  function checkInteractiveElement(element) {
    const interactiveSelectors = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[onclick]', '[onmousedown]', '[onmouseup]',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="tab"]', '[role="option"]', '[role="checkbox"]',
      '[role="radio"]', '[aria-label]', '[aria-describedby]',
      '[data-testid]', '[data-action]', '[data-click]'
    ];
    
    for (const selector of interactiveSelectors) {
      if (element.matches(selector)) {
        return extractElementInfo(element);
      }
    }
    return null;
  }
  
  // Find all interactive elements within a node
  function findInteractiveElements(node) {
    const interactiveSelectors = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[onclick]', '[onmousedown]', '[onmouseup]',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="tab"]', '[role="option"]', '[role="checkbox"]',
      '[role="radio"]', '[aria-label]', '[aria-describedby]',
      '[data-testid]', '[data-action]', '[data-click]'
    ];
    
    const elements = [];
    const foundElements = node.querySelectorAll(interactiveSelectors.join(', '));
    
    foundElements.forEach((element) => {
      const elementInfo = extractElementInfo(element);
      if (elementInfo) {
        elements.push(elementInfo);
      }
    });
    
    return elements;
  }
  
  // Extract element information
  function extractElementInfo(element) {
    try {
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);
      
      // Skip hidden or invisible elements
      if (computedStyle.display === 'none' || 
          computedStyle.visibility === 'hidden' || 
          computedStyle.opacity === '0' ||
          rect.width === 0 || rect.height === 0) {
        return null;
      }
      
      // Extract human-readable name
      let label = '';
      
      if (element.getAttribute('aria-label')) {
        label = element.getAttribute('aria-label');
      } else if (element.textContent && element.textContent.trim()) {
        label = element.textContent.trim().substring(0, 50);
      } else if (element.getAttribute('placeholder')) {
        label = element.getAttribute('placeholder');
      } else if (element.getAttribute('value')) {
        label = element.getAttribute('value');
      } else if (element.getAttribute('data-testid')) {
        label = element.getAttribute('data-testid');
      } else {
        label = element.tagName.toLowerCase();
      }
      
      // Calculate center coordinates
      const centerX = Math.round(rect.left + rect.width / 2);
      const centerY = Math.round(rect.top + rect.height / 2);
      
      return {
        id: `injected_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        label: label,
        pos: {
          x: centerX,
          y: centerY
        }
      };
      
    } catch (error) {
      console.warn('Error extracting element info:', error);
      return null;
    }
  }
  
  // Check if element is already stored
  function isElementAlreadyStored(elementId) {
    if (!elementId) return false;
    return initialDOMElements.some(el => el.id === elementId) ||
           injectedDOMElements.some(el => el.id === elementId);
  }
  
  // Update DOM result with injected elements
  function updateDOMResult() {
    if (domScanResult) {
      domScanResult.elements = [...initialDOMElements, ...injectedDOMElements];
      console.log('📊 DOM result updated:', domScanResult.elements.length, 'total elements');
    }
  }
  
  // Start STT session
  function startSTTSession() {
    try {
      console.log('🎤 Starting STT session...');
      
      // Clear previous results to ensure fresh start
      sttResults = [];
      
      // Check if browser supports speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.error('❌ Speech recognition not supported');
        return;
      }
      
      // Stop existing session if any
      if (recognition && isSTTActive) {
        recognition.stop();
      }
      
      // Initialize speech recognition
      recognition = new SpeechRecognition();
      
      // Configure for continuous operation
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      
      // Event handlers
      recognition.onstart = () => {
        isSTTActive = true;
        isListeningMode = true;
        lastSTTActivity = Date.now();
        console.log('🎤 STT session started - microphone activated');
        
        // Visual feedback - sphere to active state
        const sphere = document.getElementById('cross-tab-sphere');
        if (sphere) {
          sphere.classList.add('sphere-active');
          sphere.style.boxShadow = '0 0 18px #ff0000';
        }
      };
      
      recognition.onresult = (event) => {
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          }
        }
        
        if (finalTranscript.trim()) {
          // Store final result
          sttResults.push({
            text: finalTranscript.trim(),
            timestamp: Date.now()
          });
          
          console.log('🗣️ STT Result:', finalTranscript.trim());
          
          // Keep only last 10 results
          if (sttResults.length > 10) {
            sttResults.shift();
          }
        }
        
        if (event.results[event.results.length - 1].isFinal) {
          console.log('🔄 STT Interim:', finalTranscript);
        }
      };
      
      recognition.onerror = (event) => {
        console.error('❌ STT Error:', event.error);
      };
      
      recognition.onend = () => {
        console.log('🎤 STT session ended - microphone deactivated');
        isSTTActive = false;
        
        // Ensure microphone is stopped
        stopMicrophone();
      };
      
      // Start recognition
      recognition.start();
      
    } catch (error) {
      console.error('❌ Failed to start STT:', error);
    }
  }
  
  // Stop STT session
  function stopSTTSession() {
    if (recognition && isSTTActive) {
      recognition.stop();
      isSTTActive = false;
      isListeningMode = false;
      console.log('🎤 STT session stopped manually - microphone deactivated');
      
      // Ensure microphone is stopped
      stopMicrophone();
      
      // Show captured text if any (combine all results from this session)
      setTimeout(() => {
        if (sttResults.length > 0) {
          // Combine all results from this session into one message
          const completeMessage = sttResults.map(result => result.text).join(' ').trim();
          console.log('🗣️ Captured speech:', completeMessage);
          
          // Update status to thinking and send to Gemini API
          currentStatus = 'thinking';
          showSTTNotification('🤖 Thinking...', 'info');
          
          // Send to Gemini API
          sendToTutor(completeMessage);
          
          // Clear results after sending
          sttResults = [];
        } else {
          console.log('⚠️ No speech captured in this session');
        }
      }, 200);
    }
    
    // Visual feedback - sphere to inactive state
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.classList.remove('sphere-active');
      sphere.style.boxShadow = '0 0 18px #ff7a1a';
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
        
        // Load chat history from storage for cross-tab persistence
        geminiTutor.loadHistoryFromStorage();
        
        isTutorEnabled = true;
        console.log('✅ Gemini Tutor enabled');
      } else {
        console.log('⚠️ Gemini Tutor disabled - API key not configured');
      }
    } catch (error) {
      console.error('❌ Failed to initialize Gemini Tutor:', error);
    }
  }
  
  // Toggle session tracking
  function toggleSessionTracking() {
    if (!sessionActive) {
      startSessionTracking();
    } else {
      endSessionTracking();
    }
  }
  
  // Start session tracking
  function startSessionTracking() {
    console.log('🎯 Starting session tracking...');
    sessionActive = true;
    sessionStartTime = Date.now();
    sessionSteps = [];
    
    // Save session state to storage
    saveSessionState();
    
    // Add initial step
    addSessionStep('session_start', {
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
    
    // Start click tracking
    startClickTracking();
    
    // Start navigation tracking
    startNavigationTracking();
    
    // Activate STT for voice input during session
    startSTTSession();
    
    showSTTNotification('Session tracking started - Mic active', 'info');
    console.log('✅ Session tracking active with STT');
  }
  
  // End session tracking
  async function endSessionTracking() {
    console.log('🎯 Ending session tracking...');
    sessionActive = false;
    
    // Stop tracking
    stopClickTracking();
    stopNavigationTracking();
    
    // Stop STT session
    stopSTTSession();
    
    // Add final step with STT results
    addSessionStep('session_end', {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      duration: Date.now() - sessionStartTime,
      stt_results: sttResults
    });
    
    // Create session JSON
    const sessionData = createSessionJSON();
    
    console.log('📊 Session data:', sessionData);
    
    // Clear session state from storage
    clearSessionState();
    
    // Send to Firebase
    await sendSessionDataToFirebase(sessionData);
    
    // Process session with Gemini API for tutorial generation
    await processSessionWithGemini(sessionData);
    
    showSTTNotification('Session ended and data sent', 'success');
    console.log('✅ Session tracking ended');
  }
  
  // Join existing session from another tab
  function joinExistingSession(sessionData) {
    console.log('🔄 Joining existing session...');
    sessionActive = true;
    sessionStartTime = sessionData.sessionStartTime;
    sessionSteps = sessionData.sessionSteps;
    
    // Add step for joining session
    addSessionStep('tab_joined', {
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
    
    // Start tracking in this tab
    startClickTracking();
    startNavigationTracking();
    
    showSTTNotification('Joined existing session', 'info');
    console.log('✅ Joined session with', sessionSteps.length, 'steps');
  }
  
  // Save session state to storage
  function saveSessionState() {
    const sessionState = {
      sessionActive: sessionActive,
      sessionStartTime: sessionStartTime,
      sessionSteps: sessionSteps
    };
    chrome.storage.local.set({ 'opheliaSession': sessionState });
  }
  
  // Clear session state from storage
  function clearSessionState() {
    chrome.storage.local.remove('opheliaSession');
  }
  
  // Check for existing session on tab load
  function checkForExistingSession() {
    chrome.storage.local.get(['opheliaSession'], (result) => {
      if (result.opheliaSession && result.opheliaSession.sessionActive) {
        console.log('🔄 Found existing session, joining...');
        joinExistingSession(result.opheliaSession);
      }
    });
  }
  
  // Setup intelligent mouse following for sphere
  function setupMouseFollowing(sphere) {
    let mouseX = window.innerWidth - 30; // Initial position (bottom-right)
    let mouseY = window.innerHeight - 30;
    let sphereX = mouseX;
    let sphereY = mouseY;
    let isFollowing = false;
    let followTimeout = null;
    const offsetDistance = 40; // Keep sphere 40px away from mouse
    
    // Track mouse movement
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      
      // Start following when mouse moves
      if (!isFollowing) {
        isFollowing = true;
        sphere.style.bottom = 'auto';
        sphere.style.right = 'auto';
      }
      
      // Clear any existing timeout
      if (followTimeout) {
        clearTimeout(followTimeout);
      }
      
      // Set timeout to stop following after mouse stops moving
      followTimeout = setTimeout(() => {
        isFollowing = false;
        // Return to default position
        sphere.style.bottom = '20px';
        sphere.style.right = '20px';
        sphere.style.left = 'auto';
        sphere.style.top = 'auto';
      }, 2000); // Stop following after 2 seconds of no mouse movement
    });
    
    // Smooth following animation
    function animate() {
      if (isFollowing) {
        // Calculate target position with offset from mouse
        // Position sphere to the bottom-right of mouse cursor
        const targetX = mouseX + offsetDistance;
        const targetY = mouseY + offsetDistance;
        
        // Smoothly interpolate towards target position
        const easing = 0.1;
        sphereX += (targetX - sphereX) * easing;
        sphereY += (targetY - sphereY) * easing;
        
        // Update sphere position (centered on target position)
        sphere.style.left = sphereX + 'px';
        sphere.style.top = sphereY + 'px';
        sphere.style.bottom = 'auto';
        sphere.style.right = 'auto';
      }
      
      requestAnimationFrame(animate);
    }
    
    // Start animation loop
    animate();
  }
  
  // Add step to session
  function addSessionStep(type, data) {
    const step = {
      step_id: sessionSteps.length + 1,
      type: type,
      timestamp: data.timestamp || new Date().toISOString(),
      data: data
    };
    sessionSteps.push(step);
    console.log(`📝 Step added: ${type}`, step);
    
    // Save state after each step
    if (sessionActive) {
      saveSessionState();
    }
  }
  
  // Start click tracking
  function startClickTracking() {
    clickListener = (event) => {
      if (!sessionActive) return;
      
      const element = event.target;
      const elementInfo = extractElementInfo(element);
      
      if (elementInfo) {
        addSessionStep('click', {
          element_id: elementInfo.id,
          element_label: elementInfo.label,
          element_position: elementInfo.pos,
          url: window.location.href
        });
      }
    };
    
    document.addEventListener('click', clickListener, true);
    console.log('🖱️ Click tracking started');
  }
  
  // Stop click tracking
  function stopClickTracking() {
    if (clickListener) {
      document.removeEventListener('click', clickListener, true);
      clickListener = null;
      console.log('🖱️ Click tracking stopped');
    }
  }
  
  // Start navigation tracking
  function startNavigationTracking() {
    let lastURL = window.location.href;
    
    navigationListener = setInterval(() => {
      if (!sessionActive) return;
      
      const currentURL = window.location.href;
      if (currentURL !== lastURL) {
        addSessionStep('navigation', {
          from_url: lastURL,
          to_url: currentURL,
          timestamp: new Date().toISOString()
        });
        lastURL = currentURL;
      }
    }, 500); // Check every 500ms
  }
  
  // Stop navigation tracking
  function stopNavigationTracking() {
    if (navigationListener) {
      clearInterval(navigationListener);
      navigationListener = null;
      console.log('🧭 Navigation tracking stopped');
    }
  }
  
  // Create session JSON schema
  function createSessionJSON() {
    return {
      context: {
        session_id: `session_${sessionStartTime}_${Math.random().toString(36).substr(2, 9)}`,
        start_time: new Date(sessionStartTime).toISOString(),
        end_time: new Date().toISOString(),
        duration: Date.now() - sessionStartTime,
        total_steps: sessionSteps.length,
        start_url: sessionSteps[0]?.data?.url || window.location.href,
        end_url: window.location.href
      },
      steps: sessionSteps
    };
  }
  
  // Send session data to Firebase
  async function sendSessionDataToFirebase(sessionData) {
    try {
      console.log('📤 Sending session data to Firebase...');
      
      // Extract STT results from session end step
      let sttResults = [];
      const sessionEndStep = sessionData.steps.find(step => step.type === 'session_end');
      if (sessionEndStep && sessionEndStep.data.stt_results) {
        sttResults = sessionEndStep.data.stt_results;
      }
      
      // Convert session data to Firebase format
      const firebaseData = {
        fields: {
          session_id: { stringValue: sessionData.context.session_id },
          start_time: { stringValue: sessionData.context.start_time },
          end_time: { stringValue: sessionData.context.end_time },
          duration: { integerValue: sessionData.context.duration },
          total_steps: { integerValue: sessionData.context.total_steps },
          start_url: { stringValue: sessionData.context.start_url },
          end_url: { stringValue: sessionData.context.end_url },
          steps: { stringValue: JSON.stringify(sessionData.steps) },
          stt_results: { stringValue: JSON.stringify(sttResults) }
        }
      };
      
      // Firebase REST API endpoint
      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/ophelia_sessions?key=${firebaseConfig.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(firebaseData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Firebase API Error: ${error.error?.message || response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ Session data sent to Firebase with ID:', result.name);
      showSTTNotification(`Session sent: ${result.name.split('/').pop()}`, 'success');
      
    } catch (error) {
      console.error('❌ Failed to send session data to Firebase:', error);
      showSTTNotification(`Firebase error: ${error.message}`, 'error');
    }
  }
  
  // Process session data with Gemini API for tutorial generation
  async function processSessionWithGemini(sessionData) {
    try {
      console.log('🤖 Processing session with Gemini API...');
      
      // Extract STT results and steps
      let sttResults = [];
      const sessionEndStep = sessionData.steps.find(step => step.type === 'session_end');
      if (sessionEndStep && sessionEndStep.data.stt_results) {
        sttResults = sessionEndStep.data.stt_results;
      }
      
      // Build user input from STT results
      const userInput = sttResults.map(result => result.text).join(' ');
      
      // Build DOM data from steps
      const domData = sessionData.steps.filter(step => 
        step.type === 'click' || step.type === 'navigation'
      );
      
      // System prompt for tutorial generation
      const systemPrompt = `You are a helpful tutor. This is a tutorial with DOM data and user guidance. Your job is to create a step by step process, generate 1 liner instructions based on the user input (STT) and match it with the actual steps.

Output format: JSON schema with step number, DOM elements data to interact with, and instruction.

Example output format:
{
  "steps": [
    {
      "step_number": 1,
      "instruction": "Click on the login button",
      "dom_element": {
        "id": "login-btn",
        "label": "Login",
        "tag": "button",
        "position": {"x": 100, "y": 200}
      }
    }
  ]
}`;

      // Build request body
      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nUser Input (STT): ${userInput}\n\nDOM Data: ${JSON.stringify(domData, null, 2)}\n\nGenerate the tutorial steps in JSON format.` }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };
      
      // Call Gemini API directly
      const response = await fetch(`${geminiConfig.baseUrl}/${geminiConfig.model}:generateContent?key=${geminiConfig.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API Error: ${error.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      console.log('🤖 Gemini tutorial response:', aiResponse);
      
      // Parse JSON from response
      let tutorialSteps = {};
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          tutorialSteps = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } else {
          tutorialSteps = JSON.parse(aiResponse);
        }
      } catch (parseError) {
        console.error('❌ Failed to parse Gemini JSON response:', parseError);
        tutorialSteps = { steps: [], raw_response: aiResponse };
      }
      
      // Save tutorial to recording_session collection
      await saveTutorialToFirebase(sessionData.context.session_id, tutorialSteps, userInput, domData);
      
      showSTTNotification('Tutorial generated and saved', 'success');
      console.log('✅ Tutorial generation complete');
      
    } catch (error) {
      console.error('❌ Failed to process session with Gemini:', error);
      showSTTNotification(`Tutorial generation error: ${error.message}`, 'error');
    }
  }
  
  // Save tutorial to recording_session collection
  async function saveTutorialToFirebase(sessionId, tutorialSteps, userInput, domData) {
    try {
      console.log('📤 Saving tutorial to recording_session collection...');
      
      const firebaseData = {
        fields: {
          session_id: { stringValue: sessionId },
          tutorial_steps: { stringValue: JSON.stringify(tutorialSteps) },
          user_input: { stringValue: userInput },
          dom_data: { stringValue: JSON.stringify(domData) },
          created_at: { stringValue: new Date().toISOString() }
        }
      };
      
      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/recording_session?key=${firebaseConfig.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(firebaseData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Firebase API Error: ${error.error?.message || response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ Tutorial saved to Firebase with ID:', result.name);
      
      // Generate and display tutorial URL
      const tutorialUrl = generateTutorialUrl(sessionId);
      console.log('🔗 Tutorial URL:', tutorialUrl);
      showSTTNotification(`Tutorial URL: ${tutorialUrl}`, 'success');
      
    } catch (error) {
      console.error('❌ Failed to save tutorial to Firebase:', error);
      throw error;
    }
  }
  
  // Generate tutorial URL
  function generateTutorialUrl(sessionId) {
    return `https://www.example.com/tutorial?id=${sessionId}`;
  }
  
  // Load tutorial from Firebase
  async function loadTutorialFromFirebase(sessionId) {
    try {
      console.log('📥 Loading tutorial from Firebase:', sessionId);
      
      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/recording_session?key=${firebaseConfig.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Firebase API Error: ${error.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      
      // Find the tutorial by session_id
      let tutorial = null;
      if (data.documents) {
        tutorial = data.documents.find(doc => 
          doc.fields.session_id.stringValue === sessionId
        );
      }
      
      if (!tutorial) {
        throw new Error('Tutorial not found');
      }
      
      const tutorialSteps = JSON.parse(tutorial.fields.tutorial_steps.stringValue);
      console.log('📚 Tutorial steps loaded:', tutorialSteps);
      
      // Execute tutorial
      await executeTutorial(tutorialSteps);
      
      showSTTNotification('Tutorial loaded and executing', 'success');
      
    } catch (error) {
      console.error('❌ Failed to load tutorial from Firebase:', error);
      showSTTNotification(`Tutorial load error: ${error.message}`, 'error');
    }
  }
  
  // Execute tutorial steps
  async function executeTutorial(tutorialSteps) {
    try {
      console.log('🚀 Executing tutorial steps...');
      
      if (!tutorialSteps.steps || !Array.isArray(tutorialSteps.steps)) {
        console.error('❌ Invalid tutorial steps format');
        return;
      }
      
      for (const step of tutorialSteps.steps) {
        console.log(`📍 Step ${step.step_number}: ${step.instruction}`);
        
        // Find and interact with DOM element
        if (step.dom_element) {
          await interactWithElement(step.dom_element);
        }
        
        // Wait between steps
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('✅ Tutorial execution complete');
      showSTTNotification('Tutorial execution complete', 'success');
      
    } catch (error) {
      console.error('❌ Failed to execute tutorial:', error);
      showSTTNotification(`Tutorial execution error: ${error.message}`, 'error');
    }
  }
  
  // Interact with DOM element
  async function interactWithElement(elementData) {
    try {
      console.log('🎯 Interacting with element:', elementData);
      
      let element = null;
      
      // Try to find element by ID
      if (elementData.id) {
        element = document.getElementById(elementData.id);
      }
      
      // Try to find by label
      if (!element && elementData.label) {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
          if (el.textContent.includes(elementData.label)) {
            element = el;
            break;
          }
        }
      }
      
      // Try to find by tag and position
      if (!element && elementData.tag && elementData.position) {
        const elements = document.getElementsByTagName(elementData.tag);
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (Math.abs(rect.left - elementData.position.x) < 50 && 
              Math.abs(rect.top - elementData.position.y) < 50) {
            element = el;
            break;
          }
        }
      }
      
      if (element) {
        // Click on element
        element.click();
        console.log('✅ Clicked on element:', element);
        
        // Visual feedback
        element.style.outline = '3px solid #ff7a1a';
        setTimeout(() => {
          element.style.outline = '';
        }, 1000);
      } else {
        console.warn('⚠️ Element not found:', elementData);
      }
      
    } catch (error) {
      console.error('❌ Failed to interact with element:', error);
    }
  }
  
  // Send static data to Firebase using REST API (legacy function)
  async function sendStaticDataToFirebase() {
    try {
      console.log('📤 Sending static data to Firebase via REST API...');
      
      // Static data to send permanently
      const staticData = {
        fields: {
          timestamp: { stringValue: new Date().toISOString() },
          message: { stringValue: 'Ophelia extension data' },
          url: { stringValue: window.location.href },
          userAgent: { stringValue: navigator.userAgent },
          domElements: { integerValue: domScanResult ? domScanResult.elements.length : 0 }
        }
      };
      
      // Firebase REST API endpoint with API key as query parameter
      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/ophelia_data?key=${firebaseConfig.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(staticData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Firebase API Error: ${error.error?.message || response.statusText}`);
      }
      
      const result = await response.json();
      console.log('✅ Data sent to Firebase with ID:', result.name);
      showSTTNotification(`Data sent to Firebase: ${result.name.split('/').pop()}`, 'success');
      
    } catch (error) {
      console.error('❌ Failed to send data to Firebase:', error);
      showSTTNotification(`Firebase error: ${error.message}`, 'error');
    }
  }
  
  // Send STT result to Gemini Tutor
  async function sendToTutor(userMessage) {
    if (!isTutorEnabled || !geminiTutor) {
      console.log('❌ Gemini Tutor not available');
      return;
    }
    
    try {
      const response = await geminiTutor.getTutoringResponse(userMessage);
      
      // Display tutor response
      console.log('🤖 AI Response:', response);
      showSTTNotification(`AI: "${response}"`, 'success');
      
      // Update status to speaking and activate TTS
      currentStatus = 'speaking';
      speakResponse(response);
      
    } catch (error) {
      console.error('❌ Tutor response failed:', error);
      showSTTNotification(`Tutor error: ${error.message}`, 'error');
      currentStatus = 'background';
    }
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
    };
    
    utterance.onerror = (event) => {
      console.error('❌ TTS Error:', event.error);
      isTTSSpeaking = false;
      currentStatus = 'background';
    };
    
    // Start speaking
    speechSynthesis.speak(utterance);
  }
  
  // Notification function
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
      });
  }
  
  function stopMicrophone() {
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
      console.log('🎤 Microphone stopped');
    }
  }
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    stopMicrophone();
    
    if (recognition && isSTTActive) {
      stopSTTSession();
    }
    
    // Stop TTS
    if (speechSynthesis) {
      speechSynthesis.cancel();
      console.log('🔊 TTS stopped');
    }
    
    console.log('🧹 Cleanup completed');
  });
  
  // DOM scanning function
  function scanDOM() {
    console.log('🔍 Scanning DOM for interactive elements...');
    
    // Define interactive element selectors
    const interactiveSelectors = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[onclick]', '[onmousedown]', '[onmouseup]',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="tab"]', '[role="option"]', '[role="checkbox"]',
      '[role="radio"]', '[aria-label]', '[aria-describedby]',
      '[data-testid]', '[data-action]', '[data-click]'
    ];
    
    const elements = [];
    const elementCounter = 0;
    
    // Get all interactive elements
    const allElements = document.querySelectorAll(interactiveSelectors.join(', '));
    
    allElements.forEach((element, index) => {
      try {
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);
        
        // Skip hidden or invisible elements
        if (computedStyle.display === 'none' || 
            computedStyle.visibility === 'hidden' || 
            computedStyle.opacity === '0' ||
            rect.width === 0 || rect.height === 0) {
          return;
        }
        
        // Extract human-readable name
        let label = '';
        
        // Try ARIA label first
        if (element.getAttribute('aria-label')) {
          label = element.getAttribute('aria-label');
        } 
        // Try text content
        else if (element.textContent && element.textContent.trim()) {
          label = element.textContent.trim().substring(0, 50);
        }
        // Try placeholder
        else if (element.getAttribute('placeholder')) {
          label = element.getAttribute('placeholder');
        }
        // Try value
        else if (element.getAttribute('value')) {
          label = element.getAttribute('value');
        }
        // Try data-testid
        else if (element.getAttribute('data-testid')) {
          label = element.getAttribute('data-testid');
        }
        // Use tag name as fallback
        else {
          label = element.tagName.toLowerCase();
        }
        
        // Calculate center coordinates
        const centerX = Math.round(rect.left + rect.width / 2);
        const centerY = Math.round(rect.top + rect.height / 2);
        
        // Create element object
        elements.push({
          id: `elem_${index}`,
          label: label,
          pos: {
            x: centerX,
            y: centerY
          }
        });
        
      } catch (error) {
        console.warn('Error processing element:', error);
      }
    });
    
    // Create context object
    const context = {
      url: window.location.href,
      domain: window.location.hostname,
      page_title: document.title,
      tab_id: chrome.runtime.id || 'unknown'
    };
    
    // Return JSON schema
    const result = {
      context: context,
      elements: elements
    };
    
    console.log('📊 DOM scan complete:', elements.length, 'elements found');
    console.log('🎯 Result:', JSON.stringify(result, null, 2));
    
    // Don't automatically display - result is stored elsewhere
    // displayDOMScanResult(result);
    
    return result;
  }
  
  // Display DOM scan result on screen temporarily
  function displayDOMScanResult(result) {
    // Create overlay element
    const overlay = document.createElement('div');
    overlay.id = 'dom-scan-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '10px';
    overlay.style.left = '10px';
    overlay.style.right = '10px';
    overlay.style.bottom = '10px';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    overlay.style.color = 'white';
    overlay.style.zIndex = '10002';
    overlay.style.padding = '20px';
    overlay.style.borderRadius = '10px';
    overlay.style.overflow = 'auto';
    overlay.style.fontFamily = 'monospace';
    overlay.style.fontSize = '12px';
    overlay.style.maxHeight = '80vh';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '✕ Close';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.backgroundColor = '#ff4444';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.padding = '5px 10px';
    closeButton.style.borderRadius = '5px';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => overlay.remove();
    
    // Add title
    const title = document.createElement('h2');
    title.textContent = 'DOM Scan Result';
    title.style.marginTop = '0';
    title.style.color = '#4CAF50';
    
    // Add context section
    const contextSection = document.createElement('div');
    contextSection.innerHTML = '<h3>Context:</h3>';
    contextSection.innerHTML += `<pre>${JSON.stringify(result.context, null, 2)}</pre>`;
    
    // Add elements section
    const elementsSection = document.createElement('div');
    elementsSection.innerHTML = `<h3>Elements (${result.elements.length}):</h3>`;
    elementsSection.innerHTML += `<pre>${JSON.stringify(result.elements, null, 2)}</pre>`;
    
    // Assemble overlay
    overlay.appendChild(closeButton);
    overlay.appendChild(title);
    overlay.appendChild(contextSection);
    overlay.appendChild(elementsSection);
    
    // Add to page
    document.body.appendChild(overlay);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.remove();
      }
    }, 10000);
  }
  
  // Expose functions to global scope for debugging
  window.opheliaExtension = {
    startListening: () => startSTTSession(),
    stopListening: () => stopSTTSession(),
    scanDOM: scanDOM,
    getStatus: () => currentStatus,
    clearChatHistory: () => {
      if (geminiTutor) {
        geminiTutor.clearHistory();
        showSTTNotification('Chat history cleared', 'success');
      }
    },
    getChatHistoryLength: () => {
      if (geminiTutor) {
        return geminiTutor.getHistoryLength();
      }
      return 0;
    }
  };
  
  // Also expose directly for easier access
  window.scanDOM = scanDOM;
})();

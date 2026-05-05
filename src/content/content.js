// Ophelia Content Script - Coordinator
// Recording logic → recorder.js | Playback logic → player.js | Overlay UI → overlay.js
(() => {
  // ── STT state ────────────────────────────────────────────────────────────
  let recognition           = null;
  let sttActive             = false;
  let isListening           = false;
  let _justStoppedRecording = false; // grace-period flag to silence tutor TTS

  // ── Gemini tutor state ───────────────────────────────────────────────────
  let geminiConfig = null;
  let geminiTutor  = null;
  let tutorEnabled = false;

  // ── Notification system (exposed globally for recorder.js and player.js) ──

  window.OpheliaNotify = function(message, type = 'info') {
    document.querySelectorAll('.ophelia-notification').forEach(n => n.remove());

    const colors = {
      info:    '#1a73e8',
      success: '#34a853',
      error:   '#ea4335',
      warning: '#fbbc04'
    };
    const el = document.createElement('div');
    el.className = 'ophelia-notification';
    Object.assign(el.style, {
      position:     'fixed',
      top:          '16px',
      right:        '16px',
      background:   '#1a1a1a',
      border:       `1.5px solid ${colors[type] || colors.info}`,
      borderRadius: '10px',
      color:        '#fff',
      fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize:     '13px',
      lineHeight:   '1.5',
      padding:      '10px 16px',
      zIndex:       '2147483644',
      maxWidth:     '360px',
      boxShadow:    '0 4px 20px rgba(0,0,0,0.4)',
      opacity:      '0',
      transition:   'opacity 0.25s ease',
      pointerEvents:'none',
      whiteSpace:   'pre-wrap'
    });
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(() => { el.style.opacity = '1'; });

    // Keep success messages with URLs visible longer
    const duration = (type === 'success' && message.includes('http')) ? 10000 : 4000;
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  };

  // ── Message routing from background.js and popup ─────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'toggleSphere':
        // Ctrl+Shift+U → open the AI assistant dialog
        window.OpheliaAssistant?.activate();
        sendResponse({ success: true });
        break;

      case 'toggleRecording':
        if (window.OpheliaRecorder.isActive()) {
          stopSTT();
          window.OpheliaRecorder.stop();
          _justStoppedRecording = true;
          setTimeout(() => { _justStoppedRecording = false; }, 3000);
        } else {
          window.OpheliaRecorder.start();
          startSTT(); // Mic on for speech → attached to each step
        }
        sendResponse({ success: true });
        break;

      case 'loadTutorial':
        window.OpheliaPlayer.loadAndStart(msg.sessionId);
        sendResponse({ success: true });
        break;

      case 'getRecordingState':
        sendResponse({
          active:    window.OpheliaRecorder.isActive(),
          stepCount: window.OpheliaRecorder.stepCount()
        });
        break;

      case 'getAriaTree':
        sendResponse(window.OpheliaAssistant?.getAriaTree?.() || null);
        break;

      case 'inspectElement':
        sendResponse(window.OpheliaAssistant?.inspectElement?.(msg.hint) || null);
        break;
    }
    return true;
  });

  // ── Direct keyboard shortcut (reliable fallback for chrome.commands) ─────
  // chrome.commands → background → sendMessage can silently fail if the service
  // worker is inactive or the message channel drops. A direct keydown listener
  // always fires as long as the content script is loaded.

  document.addEventListener('keydown', (e) => {
    // Ctrl+Space  (Mac: Ctrl = MacCtrl = e.ctrlKey, not e.metaKey)
    if (e.ctrlKey && e.code === 'Space' && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      window.OpheliaAssistant?.activate();
    }
  }, true); // capture phase so it fires before page handlers

  // ── Init ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (document.getElementById('cross-tab-sphere')) return;
    createSphere();
    initGeminiTutor();
    // Check for a resumable session from a previous page (800ms delay lets all scripts load)
    setTimeout(() => window.OpheliaAssistant?.checkResume(), 800);
  }

  // ── Sphere ────────────────────────────────────────────────────────────────

  function createSphere() {
    const sphere = document.createElement('div');
    sphere.id = 'cross-tab-sphere';
    Object.assign(sphere.style, {
      position:     'fixed',
      width:        '18px',
      height:       '18px',
      background:   '#ff7a1a',
      borderRadius: '50%',
      bottom:       '20px',
      right:        '20px',
      cursor:       'pointer',
      zIndex:       '2147483645',
      opacity:      '0.85',
      boxShadow:    '0 0 16px #ff7a1a',
      transition:   'transform 0.1s ease-out, box-shadow 0.3s ease',
      pointerEvents:'auto'
    });
    sphere.title = 'Ophelia — click to talk, Ctrl+Shift+F to record';
    sphere.addEventListener('click', handleSphereClick);
    document.body.appendChild(sphere);
    setupMouseFollowing(sphere);
  }

  function handleSphereClick() {
    // Sphere click: stop recording if active, otherwise open assistant
    if (window.OpheliaRecorder.isActive()) {
      stopSTT();
      window.OpheliaRecorder.stop();
      _justStoppedRecording = true;
      setTimeout(() => { _justStoppedRecording = false; }, 3000);
      return;
    }
    window.OpheliaAssistant?.activate();
  }

  function setupMouseFollowing(sphere) {
    let mx = window.innerWidth - 40, my = window.innerHeight - 40;
    let sx = mx, sy = my;
    let following   = false;
    let followTimer = null;

    document.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;

      if (!following) {
        following = true;
        sphere.style.bottom = 'auto';
        sphere.style.right  = 'auto';
      }

      clearTimeout(followTimer);
      followTimer = setTimeout(() => {
        following = false;
        Object.assign(sphere.style, {
          bottom: '20px', right: '20px', left: 'auto', top: 'auto'
        });
      }, 2000);
    });

    (function animate() {
      // Disable mouse-following while a tutorial is playing
      if (!window.opheliaTutorialActive && following) {
        sx += (mx + 30 - sx) * 0.1;
        sy += (my + 30 - sy) * 0.1;
        sphere.style.left = `${sx}px`;
        sphere.style.top  = `${sy}px`;
      }
      requestAnimationFrame(animate);
    })();
  }

  // ── STT — dual purpose: feeds recorder buffer AND conversational AI ───────

  function startSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.OpheliaNotify('Speech recognition not supported', 'error'); return; }
    if (sttActive) return;

    recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = 'en-US';

    recognition.onstart = () => {
      sttActive = isListening = true;
      const sphere = document.getElementById('cross-tab-sphere');
      if (sphere) sphere.style.boxShadow = '0 0 18px #ff0000';
      if (!window.OpheliaRecorder.isActive()) {
        window.OpheliaNotify('Listening…', 'info');
      }
    };

    recognition.onresult = (e) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
      }
      if (!final.trim()) return;

      final = final.trim();
      console.log('🗣️', final);

      // Always push to recorder buffer (no-op if not recording)
      window.OpheliaRecorder.pushSpeech(final);

      // STT is now only used during recording (speech attached to each step)
      if (!window.OpheliaRecorder.isActive()) stopSTT();
    };

    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.error('STT error:', e.error);
    };

    recognition.onend = () => {
      sttActive = isListening = false;
      const sphere = document.getElementById('cross-tab-sphere');
      if (sphere) sphere.style.boxShadow = '0 0 16px #ff7a1a';
      // Auto-restart during recording so the mic never drops
      if (window.OpheliaRecorder.isActive()) {
        setTimeout(startSTT, 300);
      }
    };

    recognition.start();
  }

  function stopSTT() {
    if (recognition && sttActive) recognition.stop();
    sttActive = isListening = false;
  }

  // ── Gemini tutor (conversational AI — not used during recording) ──────────

  async function initGeminiTutor() {
    try {
      geminiConfig = new GeminiConfig();
      await geminiConfig.initialize();
      if (geminiConfig.isConfigured) {
        geminiTutor = new GeminiTutor(geminiConfig);
        await geminiTutor.initialize();
        geminiTutor.loadHistoryFromStorage();
        tutorEnabled = true;
        console.log('✅ Gemini Tutor ready');
      }
    } catch (e) {
      console.error('❌ Gemini Tutor init failed:', e);
    }
  }

  async function sendToTutor(text) {
    if (!tutorEnabled || !geminiTutor) return;
    try {
      window.OpheliaNotify('Thinking…', 'info');
      const response = await geminiTutor.getTutoringResponse(text);
      window.OpheliaNotify(`🤖 ${response}`, 'success');
      speakResponse(response);
    } catch (e) {
      console.error('❌ Tutor error:', e);
      window.OpheliaNotify(`AI error: ${e.message}`, 'error');
    }
  }

  function speakResponse(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt    = new SpeechSynthesisUtterance(text.substring(0, 300));
    utt.rate     = 1.0;
    utt.pitch    = 1.0;
    utt.volume   = 0.9;
    window.speechSynthesis.speak(utt);
  }

  // ── scanDOM exposed for legacy/Gemini tutor context ───────────────────────
  window.scanDOM = () => {
    const elements = [];
    const seen     = new Set();
    const vw = window.innerWidth, vh = window.innerHeight;
    const sel = 'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[aria-label],[data-testid]';

    document.querySelectorAll(sel).forEach(el => {
      const r  = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || r.width === 0) return;
      if (r.top >= vh || r.bottom <= 0 || r.left >= vw || r.right <= 0) return;

      const aria  = el.getAttribute('aria-label') || '';
      const label = aria || (el.textContent || '').trim().substring(0, 60) || el.tagName;
      const key   = `${label}|${Math.round(r.left)}|${Math.round(r.top)}`;
      if (seen.has(key)) return;
      seen.add(key);

      elements.push({
        label,
        aria_label:  aria || null,
        data_testid: el.getAttribute('data-testid') || null,
        tag:         el.tagName.toLowerCase(),
        pos: {
          x: Math.round(r.left + r.width  / 2),
          y: Math.round(r.top  + r.height / 2)
        }
      });
    });

    return { context: { url: location.href, title: document.title }, elements };
  };
})();

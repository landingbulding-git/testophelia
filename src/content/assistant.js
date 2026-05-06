// Ophelia Assistant — mic listening + screenshot capture base.
// AI workflows stripped. Mechanism: press → mic opens (red sphere) → press again → transcript
// logged + screenshot captured. Ready to reconnect to AI in next phase.
window.OpheliaAssistant = (() => {
  // ── Screenshot cache ──────────────────────────────────────────────────────
  let _lastPageKey    = '';   // "href|scrollBucket" of last capture
  let _lastScreenshot = null; // base64 of last capture (reused on cache hit)
  let _stepsSinceNav  = 0;    // steps taken on current URL (drives quality decay)

  // ── Mic state ─────────────────────────────────────────────────────────────
  let _mic          = null;  // active SpeechRecognition instance
  let _micActive    = false; // true while recording
  let _micFinalText = '';    // accumulated final transcript
  let _micCallback  = null;  // called with final text on _stopMic()

  /** Voice intent matcher with tolerance for common STT variations. */
  function matchesTutorialToGuidanceIntent(text) {
    const t = String(text).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const hasTutorial = /\btutorial\b/.test(t);
    const hasGuidanceFamily = /\bguidance\b|\bguidence\b|\bguide\b|\bguided\b/.test(t);
    return hasTutorial && hasGuidanceFamily;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function activate() {
    // Second press commits the recording
    if (_micActive) { _stopMic(); return; }

    if (window.opheliaTutorialActive) window.OpheliaPlayer?.stop();

    // Start listening — on commit: log transcript + capture screenshot
    _startMic((transcript) => {
      if (!transcript) return;
      console.log('🎤 Ophelia transcript:', transcript);
      _setDotLabel(`"${transcript.slice(0, 80)}"`);

      if (matchesTutorialToGuidanceIntent(transcript)) {
        console.log('🧭 Ophelia intent matched: tutorial-to-guidance');
        _setDotLabel('Creating Notion plan…');
        chrome.runtime.sendMessage(
          {
            action: 'tutorialToGuidance',
            userContext: transcript,
            speechTranscript: transcript
          },
          (res) => {
            if (chrome.runtime.lastError) {
              console.error('❌ tutorialToGuidance runtime error:', chrome.runtime.lastError.message);
              window.OpheliaNotify?.(`Ophelia: ${chrome.runtime.lastError.message}`, 'error');
              _clearDotLabel();
              return;
            }
            if (res?.error) {
              console.error('❌ tutorialToGuidance error:', res.error);
              window.OpheliaNotify?.(res.error, 'error');
              _clearDotLabel();
            } else if (res?.notionPageUrl) {
              console.log('✅ tutorialToGuidance success:', res.notionPageUrl);
              window.OpheliaNotify?.(
                `Notion plan ready (${res.stepCount || 0} steps):\n${res.notionPageUrl}`,
                'success'
              );
              _clearDotLabel();
            } else {
              console.warn('⚠️ tutorialToGuidance: empty response payload');
              window.OpheliaNotify?.('Ophelia: no response from tutorial pipeline.', 'warning');
              _clearDotLabel();
            }
          }
        );
      } else {
        console.log('ℹ️ Ophelia intent not matched for tutorial pipeline:', transcript);
        window.OpheliaNotify?.(
          'Intent not matched. Say: "tutorial to guidance".',
          'info'
        );
        _clearDotLabel();
      }

      // Capture screenshot alongside the transcript for other flows
      _captureScreen().then((shot) => {
        if (shot) console.log('📷 Screenshot ready alongside transcript.');
      });
    });
  }

  function stop() {
    _stopMic();
    _clearDotLabel();
    window.speechSynthesis?.cancel();
  }

  function isActive() { return _micActive; }

  // ── Persistent toggle-mic ───────────────────────────────────────────────────
  // First Ctrl+Shift+U → starts recording (continuous, shows live transcript).
  // Second Ctrl+Shift+U → commits text and processes it.

  function _startMic(callback) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { _showTextFallback(callback); return; }

    _micCallback  = callback;
    _micFinalText = '';
    _micActive    = true;
    _setDotLabel('🔴 Listening…  (press Ctrl+Shift+U to send)');

    // Sphere → red glow (per MECHANISM_RULES)
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.style.background  = '#ff2222';
      sphere.style.boxShadow   = '0 0 20px #ff0000, 0 0 40px rgba(255,0,0,0.4)';
    }

    _mic = new SR();
    _mic.lang            = 'en-US';
    _mic.continuous      = true;   // keep open until _stopMic()
    _mic.interimResults  = true;

    _mic.onresult = (e) => {
      // Accumulate final segments; show live interim text in label
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          _micFinalText += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      const preview = (_micFinalText + interim).trim().slice(-60);
      _setDotLabel(`🔴 ${preview || 'Listening…'}`);
    };

    _mic.onerror = (err) => {
      if (err.error === 'not-allowed') { _micActive = false; _mic = null; _clearDotLabel(); }
      // other errors (network, aborted): ignore — onend will restart if still active
    };

    // Chrome kills continuous sessions after ~60 s of silence → restart transparently
    _mic.onend = () => {
      if (_micActive && _mic) {
        try { _mic.start(); } catch (_) {}
      }
    };

    _mic.start();
  }

  function _stopMic() {
    if (!_micActive) return;
    _micActive = false;
    if (_mic) {
      _mic.onend = null; // prevent restart loop
      try { _mic.stop(); } catch (_) {}
      _mic = null;
    }
    _clearDotLabel();

    // Sphere → orange (inactive state)
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.style.background = '#ff7a1a';
      sphere.style.boxShadow  = '0 0 16px #ff7a1a';
    }

    const text = _micFinalText.trim();
    _micFinalText = '';
    const cb = _micCallback;
    _micCallback = null;
    if (text && cb) cb(text);
  }

  // ── Screenshot (with pageKey cache + adaptive JPEG quality) ────────────────────
  // Cache hit:  same URL + same 50px scroll bucket → return previous base64 (no network call)
  // Quality:    URL just changed → 75% | 0–1 steps on page → 70% | 2+ steps → 50%

  function _captureScreen() {
    // Round scrollY to 50px buckets — minor scroll jitter shouldn't bust the cache
    const pageKey = `${location.href}|${Math.round(window.scrollY / 50) * 50}`;

    // Cache hit: page hasn't meaningfully changed
    if (pageKey === _lastPageKey && _lastScreenshot) {
      console.log('📷 Screenshot cache hit');
      return Promise.resolve(_lastScreenshot);
    }

    // Detect navigation: href differs from what was cached
    const urlChanged = !!_lastPageKey && !_lastPageKey.startsWith(location.href + '|');
    if (urlChanged) _stepsSinceNav = 0;

    // Adaptive quality: high after nav, normal early-page, reduced once page is stable
    const quality = urlChanged ? 75 : (_stepsSinceNav >= 2 ? 50 : 70);

    _lastPageKey = pageKey;
    _stepsSinceNav++;
    console.log(`📷 Capturing screenshot — quality ${quality}%, stepsSinceNav ${_stepsSinceNav}`);

    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'captureTab', quality }, res => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const url = res?.dataUrl || null;
          const b64 = url ? url.replace(/^data:image\/[a-z]+;base64,/, '') : null;
          _lastScreenshot = b64;
          resolve(b64);
        });
      } catch (_) { resolve(null); }
    });
  }

  // ── Dot label — small text pill anchored next to the orange dot ─────────────

  function _setDotLabel(text) {
    let lbl = document.getElementById('ophelia-dot-label');
    if (!text) { lbl?.remove(); return; }
    if (!lbl) {
      lbl = document.createElement('div');
      lbl.id = 'ophelia-dot-label';
      lbl.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'pointer-events:none',
        'background:rgba(9,9,13,0.88)',
        'color:#fff', 'font-size:11px', 'font-weight:500',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'padding:3px 9px', 'border-radius:9px', 'white-space:nowrap',
        'border:1px solid rgba(255,122,26,0.35)',
        'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)'
      ].join(';');
      document.body.appendChild(lbl);
    }
    lbl.textContent = text;
    // Position: right of the orange dot if it exists, else bottom-center
    const dot = document.getElementById('ophelia-dot');
    if (dot) {
      const cx = parseFloat(dot.style.left) || 0; // dot center x
      const cy = parseFloat(dot.style.top)  || 0; // dot center y
      lbl.style.left      = `${cx + 16}px`;
      lbl.style.top       = `${cy - 10}px`;
      lbl.style.bottom    = 'auto';
      lbl.style.transform = 'none';
    } else {
      lbl.style.bottom    = '24px';
      lbl.style.left      = '50%';
      lbl.style.top       = 'auto';
      lbl.style.transform = 'translateX(-50%)';
    }
  }

  function _clearDotLabel() {
    document.getElementById('ophelia-dot-label')?.remove();
  }

  // ── TTS ─────────────────────────────────────────────────────────────────────

  function _speak(text, onEnd) {
    if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    if (onEnd) utt.onend = onEnd;
    utt.rate = _ttsRate; utt.pitch = 1.0; utt.volume = 1.0;
    utt.lang = navigator.language || 'en-US';
    const go = () => {
      const v    = window.speechSynthesis.getVoices();
      const pref = v.find(x => x.lang.startsWith('en') &&
                     (x.name.includes('Google') || x.name.includes('Samantha') || x.name.includes('Natural')))
                || v.find(x => x.lang.startsWith('en'));
      if (pref) utt.voice = pref;
      window.speechSynthesis.speak(utt);
    };
    window.speechSynthesis.getVoices().length ? go()
      : (window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; go(); });
  }

  return { activate, stop, isActive };
})();

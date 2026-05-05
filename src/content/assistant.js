// Ophelia Intelligent Agent — continuous screen-aware browser co-pilot
// Ctrl+Shift+U → goal dialog → screenshot + DOM → Claude → next step → highlight → wait → repeat
// Multi-turn conversation: Claude remembers what's been done and adapts to page changes.
window.OpheliaAssistant = (() => {
  const CLAUDE_WORKER = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude';
  // 4 messages = 2 full turns. Images stripped from all but latest → ~$0.005-0.008/step.
  const MAX_HISTORY     = 4;
  const MIN_CALL_GAP_MS = 2000; // minimum ms between consecutive Claude calls
  let   _lastCallAt     = 0;

  let _goal      = '';
  let _messages  = []; // multi-turn conversation history
  let _active    = false;
  let _stepCount = 0;
  let _waitingForAction = false;
  let _cleanupFns = []; // teardown callbacks for event listeners / timers
  let _highlightedEl = null;
  let _ttsRate        = 1.05; // loaded from chrome.storage.sync on session start

  // ── Screenshot cache ─────────────────────────────────────────────────
  let _lastPageKey    = '';   // "href|scrollBucket" of last capture
  let _lastScreenshot = null; // base64 of last capture (reused on cache hit)
  let _stepsSinceNav  = 0;    // steps taken on the current URL (drives quality decay)

  // ── Mic state ────────────────────────────────────────────────────────────────
  let _mic              = null;  // active SpeechRecognition instance
  let _micActive        = false; // true while recording
  let _micFinalText     = '';    // accumulated final transcript
  let _micCallback      = null;  // called with final text on _stopMic()

  // ── Public API ─────────────────────────────────────────────────────────────

  function activate() {
    // If mic is open: second press commits the recording
    if (_micActive) { _stopMic(); return; }

    if (_active) {
      // Session running: let user correct or ask via voice
      _listenForMessage();
    } else {
      if (window.opheliaTutorialActive) window.OpheliaPlayer?.stop();
      _listenForGoal();
    }
  }

  function stop() {
    _stopMic();  // kill any open mic first
    _active = false;
    _waitingForAction = false;
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
    _clearHighlight();
    _clearDotLabel();
    window.speechSynthesis?.cancel();
    _goal = ''; _messages = []; _stepCount = 0;
  }

  function isActive() { return _active; }

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

  // ── Goal / message listeners ────────────────────────────────────────────────

  function _listenForGoal() {
    _startMic(async (goal) => {
      const check = await _clarifyGoal(goal);
      if (check.clear) {
        _startSession(goal);
      } else {
        // Speak the question, then reopen mic once TTS finishes
        _speak(check.question, () => {
          _setDotLabel('🔴 Listening…  (press Ctrl+Space to send)');
          _startMic((refined) => _startSession(refined || goal));
        });
      }
    });
  }

  async function _clarifyGoal(goal) {
    _setDotLabel('Thinking…');
    try {
      const res = await fetch(CLAUDE_WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      'claude-sonnet-4-5',
          max_tokens: 120,
          system:
            `You assess whether a user's goal is specific enough to guide step by step in a browser.\n` +
            `Reply ONLY with valid JSON — no prose:\n` +
            `{"clear":true}  — goal is actionable and specific.\n` +
            `{"clear":false,"question":"..."}  — too vague; one short clarifying question, max 12 words.`,
          messages: [{ role: 'user', content: `Goal: "${goal}"` }]
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const raw   = data.content?.[0]?.text || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      return JSON.parse(match[0]);
    } catch (e) {
      console.warn('⚠️ _clarifyGoal failed, proceeding directly:', e);
      return { clear: true }; // fail open — never block the session
    }
  }

  function _listenForMessage() {
    _startMic((text) => _userMessage(text));
  }

  function _showTextFallback(callback) {
    const isGoal = !_active;
    const wrap = document.createElement('div');
    wrap.id = 'ophelia-fallback';
    wrap.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;display:flex;gap:7px;align-items:center;' +
      'background:rgba(9,9,13,0.95);border:1px solid rgba(255,122,26,0.4);' +
      'border-radius:12px;padding:10px 14px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 8px 28px rgba(0,0,0,0.6)';
    wrap.innerHTML =
      `<input id="ophelia-fb-input" type="text" placeholder="${isGoal ? 'What do you want to accomplish?' : 'Say something to Ophelia…'}"` +
      ' style="background:none;border:none;outline:none;color:#fff;font-size:13px;' +
      'font-family:inherit;width:300px"/>' +
      '<button id="ophelia-fb-go" style="background:#ff7a1a;border:none;border-radius:7px;' +
      'padding:6px 14px;cursor:pointer;color:#fff;font-size:13px;font-weight:600;' +
      'font-family:inherit">→</button>';
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('#ophelia-fb-input');
    inp.focus();
    const go = () => {
      const text = inp.value.trim();
      if (!text) return;
      wrap.remove();
      if (callback) callback(text);
    };
    wrap.querySelector('#ophelia-fb-go').addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') wrap.remove(); });
  }

  // ── Session start ───────────────────────────────────────────────────────────

  async function _startSession(goal) {
    _goal = goal;
    _messages = [];
    _active = true;
    _stepCount = 0;
    _lastPageKey = ''; _lastScreenshot = null; _stepsSinceNav = 0;

    // Load persisted TTS rate preference
    try {
      const s = await chrome.storage.sync.get('ttsRate');
      if (typeof s.ttsRate === 'number') _ttsRate = s.ttsRate;
    } catch (_) {}

    _watchPage();
    await _analyze('What is the first step the user should take?');
  }

  // ── Core analysis loop ──────────────────────────────────────────────────────
  // Called after every user action, navigation, or explicit message.

  async function _analyze(trigger, _retries = 0) {
    if (!_active) return;
    _waitingForAction = false;
    _clearHighlight();

    _setDotLabel('Thinking…');

    // 1. Take screenshot (visual context)
    const screenshot = await _captureScreen();

    // 2. Scan DOM
    const dom   = _scanPage();
    const elStr = _formatElements(dom.elements);

    // 3. Build this turn's user message (image + text)
    const userContent = [];
    if (screenshot) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: screenshot }
      });
    }
    userContent.push({
      type: 'text',
      text: `Goal: "${_goal}"\nPage: ${dom.url}\nTitle: ${dom.title}\n\nInteractive elements:\n${elStr}\n\n${trigger}`
    });

    // Store text-only copy in history (strip image from older turns to save tokens)
    _messages.push({ role: 'user', content: userContent });

    // 4. Call Claude (with trimmed history)
    const step = await _callClaude();

    if (!step) {
      _setDotLabel('No response — try again.');
      _waitingForAction = true;
      return;
    }

    // Store assistant reply in history
    _messages.push({ role: 'assistant', content: step._raw });

    // Trim history to MAX_HISTORY messages (keep token cost bounded)
    if (_messages.length > MAX_HISTORY) {
      _messages = _messages.slice(_messages.length - MAX_HISTORY);
    }

    _stepCount++;

    // 5a. Goal complete
    if (step.done) {
      _speak('Done! Your goal is complete.');
      _setDotLabel('✅ Done!');
      setTimeout(stop, 4000);
      return;
    }

    // 5b. Show next step
    const el = step.element ? _findEl(step.element) : null;

    if (!el && step.element && _retries < 2) {
      // Element described but not found — push feedback to Claude and retry silently
      const attrs = JSON.stringify(step.element);
      _messages.push({
        role: 'user',
        content: [{ type: 'text', text:
          `The element ${attrs} was not found in the DOM. ` +
          `Re-examine the screenshot and DOM list and provide a different descriptor or a different instruction.`
        }]
      });
      console.warn(`⚠️ _findEl failed (retry ${_retries + 1}/2), feeding back to Claude`);
      setTimeout(() => { if (_active) _analyze('Element not found, re-examining.', _retries + 1); }, 1200);
      return;
    }

    if (!step._instructionSpoken) _speak(step.instruction);

    if (el) {
      // Instant scroll so getBoundingClientRect is correct immediately.
      // Double-rAF ensures the browser has finished layout before we read positions.
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_active) _highlightElement(el);
      }));
    } else {
      _setDotLabel(`Step ${_stepCount}`);
    }

    _waitingForAction = true;
  }

  // ── Page watcher ────────────────────────────────────────────────────────────
  // Re-analyzes after any user click or URL change.

  function _watchPage() {
    let lastUrl = location.href;
    let debounceTimer = null;

    const reanalyze = (trigger) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (_active) _analyze(trigger);
      }, 900);
    };

    const onClick = (e) => {
      if (!_active || !_waitingForAction) return;
      // Ignore clicks on our own panel
      if (e.target.closest('#ophelia-fallback')) return;
      _clearHighlight();
      _setDotLabel('Processing…');
      reanalyze('User just performed an action. What is the next step toward the goal?');
    };

    const navPoll = setInterval(() => {
      if (!_active) { clearInterval(navPoll); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        _setDotLabel('Page changed…');
        reanalyze('User navigated to a new page. What is the next step toward the goal?');
      }
    }, 300);

    document.addEventListener('click', onClick, true);
    _cleanupFns.push(
      () => document.removeEventListener('click', onClick, true),
      () => clearInterval(navPoll)
    );
  }

  // ── User sends a message from the Ask field ─────────────────────────────────

  function _userMessage(text) {
    if (!_active) return;
    _clearHighlight();
    _setDotLabel('Processing…');
    _analyze(`User says: "${text}". Take this into account for the next step.`);
  }

  function _skip() {
    if (!_active) return;
    _analyze('User skipped this step. What is the next step toward the goal?');
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

  // ── Page scanning ───────────────────────────────────────────────────────────

  function _scanPage() {
    const SEL = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="option"]', '[role="tab"]', '[role="checkbox"]',
      '[role="switch"]', '[role="radio"]', '[aria-label]', '[data-testid]'
    ].join(',');

    const vw = window.innerWidth, vh = window.innerHeight;
    const elements = [];
    const seen = new Set();

    document.querySelectorAll(SEL).forEach(el => {
      const r  = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (parseFloat(cs.opacity) === 0 || r.width === 0 || r.height === 0) return;
      // Capture viewport + generous scroll buffer (sidebar menus, below-fold nav)
      if (r.bottom < -500 || r.top > vh + 1500 || r.right < 0 || r.left > vw + 300) return;

      const aria    = el.getAttribute('aria-label') || '';
      const testId  = el.getAttribute('data-testid') || '';
      const ownText = [...el.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim()).filter(Boolean)
        .join(' ').replace(/\s+/g, ' ').substring(0, 40);
      const fullText = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 40);
      const text  = ownText || fullText;
      const label = aria || testId || text || '';
      if (!label) return;

      const key = `${label.toLowerCase().substring(0, 30)}|${el.tagName}`;
      if (seen.has(key)) return;
      seen.add(key);

      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hR = cx < vw / 3 ? 'left'   : cx < 2 * vw / 3 ? 'center'  : 'right';
      const vR = cy < 0      ? 'above'  : cy < vh / 3      ? 'top'     :
                 cy < 2*vh/3 ? 'mid'    : cy < vh           ? 'bottom'  : 'below';

      elements.push({
        tag:          el.tagName.toLowerCase(),
        role:         el.getAttribute('role')        || null,
        aria_label:   aria   || null,
        data_testid:  testId || null,
        text_content: ownText || null,
        label,
        position:     `${vR}-${hR}`
      });
    });

    return { url: location.href, title: document.title, elements: elements.slice(0, 40) };
  }

  // ── Claude call (multi-turn) ────────────────────────────────────────────────

  async function _callClaude() {
    // Enforce minimum gap between calls to stay under token-per-minute rate limit
    const now = Date.now();
    const gap = MIN_CALL_GAP_MS - (now - _lastCallAt);
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    _lastCallAt = Date.now();

    try {
      // Build messages for API — strip images from all turns except the last user turn
      const apiMessages = _messages.map((m, i) => {
        const isLastUser = m.role === 'user' && i === _messages.length - 1;
        if (!isLastUser && Array.isArray(m.content)) {
          // Replace image blocks with a short text note to save tokens
          const textParts = m.content.filter(c => c.type === 'text');
          const hadImage  = m.content.some(c => c.type === 'image');
          return {
            role: m.role,
            content: hadImage
              ? [{ type: 'text', text: '[screenshot from previous step]' }, ...textParts]
              : textParts
          };
        }
        return { role: m.role, content: m.content };
      });

      const systemPrompt =
        `You are Ophelia, a live browser co-pilot. You see the user's browser via screenshots and a DOM element list.\n` +
        `After every user action you receive a new screenshot and DOM state.\n\n` +
        `YOUR ONLY JOB: identify the single next action the user must take to reach their goal.\n\n` +
        `RULES:\n` +
        `1. One action per response. Never combine multiple actions.\n` +
        `2. For elements in the DOM list: copy their JSON attributes verbatim into "element".\n` +
        `3. For elements not yet visible (inside menus/dialogs not yet open): use your site knowledge.\n` +
        `4. Instructions: short, plain English, max 12 words.\n` +
        `5. If the target element is likely below the visible area, include "scroll down to find it" in the instruction.\n` +
        `6. If the page shows a loading spinner or skeleton screen, instruct the user to wait before acting.\n` +
        `7. If you cannot identify the exact element, respond: {"instruction":"I couldn't find that element. Try scrolling or describe what you see.","element":null,"done":false}\n` +
        `8. Never invent element attributes not present in the DOM list — use only what appears verbatim.\n` +
        `Language: respond in "${navigator.language || 'en'}" — translate instructions naturally if not English.\n\n` +
        `RESPOND WITH ONLY VALID JSON — no prose, no markdown fences:\n` +
        `{"instruction":"short action","element":{"tag":"","aria_label":"","text_content":"","role":""},"done":false}\n` +
        `When the goal is fully achieved: {"instruction":"All done!","done":true,"element":null}`;

      const res = await fetch(CLAUDE_WORKER, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      'claude-sonnet-4-5',
          max_tokens: 400,
          stream:     true,
          system:     systemPrompt,
          messages:   apiMessages
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('❌ Claude error:', JSON.stringify(err));
        return null;
      }

      // ── SSE stream reader ──────────────────────────────────────────────────
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated        = '';
      let instructionSpoken  = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Parse SSE lines from this chunk
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              accumulated += evt.delta.text;
            }
          } catch (_) {}
        }

        // Speak instruction as soon as its closing quote appears in the stream
        if (!instructionSpoken) {
          const instMatch = accumulated.match(/"instruction"\s*:\s*"((?:[^"\\]|\\.)*?)"/);
          if (instMatch) {
            const instr = instMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
            _speak(instr);
            instructionSpoken = true;
            console.log('🔊 Streaming TTS fired early:', instr);
          }
        }
      }

      console.log('🧠 Claude (stream):', accumulated.substring(0, 300));
      const match = accumulated.match(/\{[\s\S]*\}/);
      if (!match) { console.error('No JSON in Claude stream'); return null; }
      const parsed = JSON.parse(match[0]);
      parsed._raw              = accumulated;
      parsed._instructionSpoken = instructionSpoken;
      return parsed;
    } catch (e) {
      console.error('❌ _callClaude failed:', e);
      return null;
    }
  }

  // ── Element finder — confidence scoring ────────────────────────────────────
  // Scores every visible candidate against Claude's descriptor.
  // Returns the best element only if score > 50; otherwise null so the
  // caller can push feedback to Claude instead of highlighting wrong element.

  function _findEl(d) {
    if (!d) return null;

    const nAria = (d.aria_label   || '').trim().toLowerCase();
    const nText = (d.text_content || '').trim().toLowerCase();
    const nTid  = (d.data_testid  || '').trim().toLowerCase();
    const nTag  = (d.tag          || '').trim().toLowerCase();

    if (!nAria && !nText && !nTid) return null;

    const SEL = [
      'button', 'a[href]', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="option"]', '[role="tab"]', '[role="checkbox"]',
      '[role="switch"]', '[role="radio"]', '[aria-label]', '[data-testid]'
    ].join(',');

    const vw = window.innerWidth, vh = window.innerHeight;
    let best = null, bestScore = 0;

    document.querySelectorAll(SEL).forEach(el => {
      const r  = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (parseFloat(cs.opacity) === 0) return;

      let score = 0;
      const eAria = (el.getAttribute('aria-label')  || '').trim().toLowerCase();
      const eTid  = (el.getAttribute('data-testid') || '').trim().toLowerCase();
      const eText = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      const eTag  = el.tagName.toLowerCase();

      if (nAria && eAria) {
        if (eAria === nAria)                                      score += 100;
        else if (eAria.includes(nAria) || nAria.includes(eAria)) score +=  90;
      }
      if (nTid && eTid && eTid === nTid)                          score +=  80;
      if (nText && eText) {
        if (eText === nText)                                       score +=  70;
        else if (eText.includes(nText) || nText.includes(eText))  score +=  50;
      }

      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx >= 0 && cx <= vw && cy >= 0 && cy <= vh)             score +=  20;
      if (nTag && eTag === nTag)                                   score +=  10;
      if (r.width < 10 || r.height < 10)                          score -=  30;

      if (score > bestScore) { bestScore = score; best = el; }
    });

    console.log(`🔍 _findEl score ${bestScore} for "${nAria || nText || nTid || '?'}"`);
    return bestScore > 50 ? best : null;
  }

  // ── Element highlight — delegates to OpheliaOverlay (same as tutorial player) ─

  function _highlightElement(el) {
    _clearHighlight();
    if (!el) return;
    _highlightedEl = el;
    _clearDotLabel(); // label not needed when dot is on the element

    try {
      window.OpheliaOverlay.show({
        stepNumber: _stepCount,
        totalSteps: _stepCount + 1,
        instruction: '',
        element: el,
        onCorrect: null
      });
      document.getElementById('ophelia-card')?.remove();
    } catch (e) {
      console.warn('OpheliaOverlay unavailable, using fallback highlight', e);
      _applyFallbackHighlight(el);
      return;
    }

    // Re-pin dot after any late layout shifts (e.g. sticky headers, animations)
    setTimeout(() => {
      const dot = document.getElementById('ophelia-dot');
      if (!dot || !_highlightedEl) return;
      const r = _highlightedEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        dot.style.left = `${r.left + r.width  / 2}px`;
        dot.style.top  = `${r.top  + r.height / 2}px`;
      }
    }, 250);
  }

  function _applyFallbackHighlight(el) {
    // Pure CSS fallback when OpheliaOverlay is not available
    if (!document.getElementById('ophelia-fb-css')) {
      const s = document.createElement('style');
      s.id = 'ophelia-fb-css';
      s.textContent = `
        .ophelia-fb-target {
          outline: 3px solid #ff7a1a !important;
          outline-offset: 4px !important;
          box-shadow: 0 0 0 6px rgba(255,122,26,0.3) !important;
        }`;
      document.head.appendChild(s);
    }
    el.classList.add('ophelia-fb-target');
    // Create a dot manually
    const r   = el.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.id = 'ophelia-dot';
    dot.style.cssText = [
      'position:fixed', `left:${r.left + r.width/2}px`, `top:${r.top + r.height/2}px`,
      'width:18px','height:18px','background:#ff7a1a','border-radius:50%',
      'transform:translate(-50%,-50%)','z-index:2147483647','pointer-events:none',
      'animation:opheliaDotPulse 1.2s ease-in-out infinite'
    ].join(';');
    document.body.appendChild(dot);
  }

  function _clearHighlight() {
    try { window.OpheliaOverlay.hide(); } catch (_) {}
    // Also clean up any fallback highlight
    document.getElementById('ophelia-dot')?.remove();
    document.querySelectorAll('.ophelia-fb-target').forEach(e => e.classList.remove('ophelia-fb-target'));
    _highlightedEl = null;
  }

  // ── Element format ──────────────────────────────────────────────────────────

  function _formatElements(elements) {
    return elements.map((e, i) => {
      const obj = { tag: e.tag };
      if (e.aria_label)   obj.aria_label   = e.aria_label;
      if (e.text_content) obj.text_content = e.text_content;
      if (e.role)         obj.role         = e.role;
      if (e.data_testid)  obj.data_testid  = e.data_testid;
      return `[${String(i).padStart(2)}] @${e.position}  ${JSON.stringify(obj)}`;
    }).join('\n');
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

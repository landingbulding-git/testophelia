// Ophelia Intelligent Agent — continuous screen-aware browser co-pilot
// Ctrl+Shift+U → goal dialog → screenshot + DOM → Claude → next step → highlight → wait → repeat
// Multi-turn conversation: Claude remembers what's been done and adapts to page changes.
window.OpheliaAssistant = (() => {
  const CLAUDE_WORKER = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude';
  const MAX_HISTORY   = 8; // keep last N messages to bound token cost

  let _goal      = '';
  let _messages  = []; // multi-turn conversation history
  let _active    = false;
  let _stepCount = 0;
  let _waitingForAction = false;
  let _cleanupFns = []; // teardown callbacks for event listeners / timers
  let _highlightedEl = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  function activate() {
    if (_active) { stop(); return; }
    if (window.opheliaTutorialActive) window.OpheliaPlayer?.stop();
    _listenForGoal();
  }

  function stop() {
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

  // ── Voice goal capture — no dialog, just mic ────────────────────────────────

  function _listenForGoal() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      // No speech API — tiny fallback input at bottom of screen
      _showTextFallback();
      return;
    }
    _setDotLabel('🎤 Say your goal…');
    const mic = new SR();
    mic.lang = 'en-US';
    mic.onresult = (e) => {
      const goal = [...e.results].map(r => r[0].transcript).join('').trim();
      if (goal && e.results[e.results.length - 1].isFinal) {
        _clearDotLabel();
        _startSession(goal);
      }
    };
    mic.onerror = () => { _clearDotLabel(); };
    mic.start();
  }

  function _showTextFallback() {
    const wrap = document.createElement('div');
    wrap.id = 'ophelia-fallback';
    wrap.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;display:flex;gap:7px;align-items:center;' +
      'background:rgba(9,9,13,0.95);border:1px solid rgba(255,122,26,0.4);' +
      'border-radius:12px;padding:10px 14px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 8px 28px rgba(0,0,0,0.6)';
    wrap.innerHTML =
      '<input id="ophelia-fb-input" type="text" placeholder="What do you want to accomplish?"' +
      ' style="background:none;border:none;outline:none;color:#fff;font-size:13px;' +
      'font-family:inherit;width:300px"/>' +
      '<button id="ophelia-fb-go" style="background:#ff7a1a;border:none;border-radius:7px;' +
      'padding:6px 14px;cursor:pointer;color:#fff;font-size:13px;font-weight:600;' +
      'font-family:inherit">→</button>';
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('#ophelia-fb-input');
    inp.focus();
    const go = () => {
      const goal = inp.value.trim();
      if (!goal) return;
      wrap.remove();
      _startSession(goal);
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

    _watchPage();
    await _analyze('What is the first step the user should take?');
  }

  // ── Core analysis loop ──────────────────────────────────────────────────────
  // Called after every user action, navigation, or explicit message.

  async function _analyze(trigger) {
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
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); _highlightElement(el); }

    _speak(step.instruction);
    if (!el) _setDotLabel(`Step ${_stepCount}`);

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

  // ── Screenshot ──────────────────────────────────────────────────────────────

  function _captureScreen() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'captureTab' }, res => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const url = res?.dataUrl || null;
          // Strip data URL prefix, return raw base64
          resolve(url ? url.replace(/^data:image\/[a-z]+;base64,/, '') : null);
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

    return { url: location.href, title: document.title, elements: elements.slice(0, 90) };
  }

  // ── Claude call (multi-turn) ────────────────────────────────────────────────

  async function _callClaude() {
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

      const res = await fetch(CLAUDE_WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      'claude-sonnet-4-5',
          max_tokens: 400,
          system:
            `You are Ophelia, a live browser co-pilot. You see the user's browser via screenshots and a DOM element list.\n` +
            `After every user action you receive a new screenshot and DOM state.\n\n` +
            `YOUR ONLY JOB: identify the single next action the user must take to reach their goal.\n\n` +
            `RULES:\n` +
            `1. One action per response. Never combine multiple actions.\n` +
            `2. For elements in the DOM list: copy their JSON attributes verbatim into "element".\n` +
            `3. For elements not yet visible (inside menus/dialogs not yet open): use your site knowledge.\n` +
            `4. Instructions: short, plain English, max 12 words.\n\n` +
            `RESPOND WITH ONLY VALID JSON — no prose, no markdown fences:\n` +
            `{"instruction":"short action","element":{"tag":"","aria_label":"","text_content":"","role":""},"done":false}\n` +
            `When the goal is fully achieved: {"instruction":"All done!","done":true,"element":null}`,
          messages: apiMessages
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('❌ Claude error:', JSON.stringify(err));
        return null;
      }

      const data = await res.json();
      const raw  = data.content?.[0]?.text || '';
      console.log('🧠 Claude:', raw.substring(0, 300));

      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) { console.error('No JSON in Claude response'); return null; }
      const parsed = JSON.parse(match[0]);
      parsed._raw = raw;
      return parsed;
    } catch (e) {
      console.error('❌ _callClaude failed:', e);
      return null;
    }
  }

  // ── Element finder ──────────────────────────────────────────────────────────

  function _findEl(d) {
    return window.OpheliaPlayer?.findElement(d) || null;
  }

  // ── Element highlight — delegates to OpheliaOverlay (same as tutorial player) ─

  function _highlightElement(el) {
    _clearHighlight();
    if (!el) return;
    _highlightedEl = el;

    // Use the overlay for identical orange dot + target glow as the tutorial player
    window.OpheliaOverlay.show({
      stepNumber: _stepCount,
      totalSteps: _stepCount + 1, // dummy — keeps progress bar non-NaN
      instruction: '',             // TTS handles the instruction
      element: el,
      onCorrect: null
    });

    // Remove the instruction card — we only want the dot and element highlight
    document.getElementById('ophelia-card')?.remove();
  }

  function _clearHighlight() {
    window.OpheliaOverlay.hide();
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

  function _speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05; utt.pitch = 1.0; utt.volume = 1.0;
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

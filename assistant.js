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
  let _badgeEl = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  function activate() {
    if (_active) { stop(); return; }
    if (window.opheliaTutorialActive) window.OpheliaPlayer?.stop();
    _showGoalDialog();
  }

  function stop() {
    _active = false;
    _waitingForAction = false;
    _cleanupFns.forEach(fn => fn());
    _cleanupFns = [];
    _clearHighlight();
    _hideBadge();
    window.speechSynthesis?.cancel();
    _goal = ''; _messages = []; _stepCount = 0;
  }

  function isActive() { return _active; }

  // ── Goal input dialog ───────────────────────────────────────────────────────

  function _showGoalDialog() {
    document.getElementById('ophelia-goal-dlg')?.remove();

    const dlg = document.createElement('div');
    dlg.id = 'ophelia-goal-dlg';
    dlg.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'background:rgba(9,9,13,0.98)','border:1.5px solid #4285f4',
      'border-radius:16px','padding:24px 26px','width:430px',
      'max-width:calc(100vw - 40px)','color:#fff','z-index:2147483647',
      'box-shadow:0 20px 64px rgba(0,0,0,0.85)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');

    dlg.innerHTML = `
      <div style="font-size:10px;font-weight:800;letter-spacing:.14em;color:#4285f4;
                  text-transform:uppercase;margin-bottom:10px">🤖 Ophelia Agent</div>
      <div style="font-size:15px;color:#e8e8e8;margin-bottom:4px">What do you want to accomplish?</div>
      <div style="font-size:12px;color:#555;margin-bottom:16px">
        I'll watch your screen and guide you step by step, adapting as you go.
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="ophelia-gdlg-input" type="text"
          placeholder="e.g. Change my profile picture on Facebook"
          autocomplete="off"
          style="flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.18);
                 border-radius:8px;padding:10px 14px;color:#fff;font-size:14px;
                 font-family:inherit;outline:none"/>
        <button id="ophelia-gdlg-mic"
          style="background:rgba(66,133,244,0.12);border:1.5px solid #4285f4;
                 border-radius:8px;padding:9px 11px;cursor:pointer;font-size:17px;flex-shrink:0">🎤</button>
        <button id="ophelia-gdlg-go"
          style="background:#4285f4;border:none;border-radius:8px;padding:10px 18px;
                 cursor:pointer;color:#fff;font-size:14px;font-weight:600;
                 font-family:inherit;flex-shrink:0">Start →</button>
      </div>
      <div id="ophelia-gdlg-status" style="font-size:11px;color:#555;margin-top:8px;min-height:14px"></div>
    `;
    document.body.appendChild(dlg);

    const input  = dlg.querySelector('#ophelia-gdlg-input');
    const micBtn = dlg.querySelector('#ophelia-gdlg-mic');
    const goBtn  = dlg.querySelector('#ophelia-gdlg-go');
    const status = dlg.querySelector('#ophelia-gdlg-status');

    input.focus();

    const submit = () => {
      const goal = input.value.trim();
      if (!goal) { input.style.borderColor = '#f44336'; return; }
      dlg.remove();
      _startSession(goal);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') dlg.remove(); });
    goBtn.addEventListener('click', submit);

    let mic = null;
    micBtn.addEventListener('click', () => {
      if (mic) { mic.stop(); mic = null; micBtn.textContent = '🎤'; return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { status.textContent = 'Speech not supported.'; return; }
      mic = new SR();
      mic.lang = 'en-US';
      mic.onstart  = () => { micBtn.textContent = '🔴'; status.textContent = 'Listening…'; };
      mic.onresult = (e) => {
        input.value = [...e.results].map(r => r[0].transcript).join('');
        if (e.results[e.results.length - 1].isFinal) {
          mic = null; micBtn.textContent = '🎤'; status.textContent = 'Press Start →';
        }
      };
      mic.onerror = (e) => { micBtn.textContent = '🎤'; mic = null; };
      mic.onend   = () => { micBtn.textContent = '🎤'; };
      mic.start();
    });

    setTimeout(() => {
      const outside = (e) => {
        if (!dlg.contains(e.target)) { dlg.remove(); document.removeEventListener('click', outside, true); }
      };
      document.addEventListener('click', outside, true);
    }, 150);
  }

  // ── Session start ───────────────────────────────────────────────────────────

  async function _startSession(goal) {
    _goal = goal;
    _messages = [];
    _active = true;
    _stepCount = 0;

    _showBadge();
    _setBadge('Starting…');
    _watchPage();
    await _analyze('What is the first step the user should take?');
  }

  // ── Core analysis loop ──────────────────────────────────────────────────────
  // Called after every user action, navigation, or explicit message.

  async function _analyze(trigger) {
    if (!_active) return;
    _waitingForAction = false;
    _clearHighlight();

    _setBadge('Thinking…');

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
      _setBadge('No response — try again.');
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
      _setBadge('✅ Done!');
      setTimeout(stop, 4000);
      return;
    }

    // 5b. Show next step
    const el = step.element ? _findEl(step.element) : null;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); _highlightElement(el); }

    _setBadge(`Step ${_stepCount}`);
    _speak(step.instruction);

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
      if (e.target.closest('#ophelia-badge') || e.target.closest('#ophelia-ask-popup') || e.target.closest('#ophelia-goal-dlg')) return;
      _clearHighlight();
      _setBadge('Processing…');
      reanalyze('User just performed an action. What is the next step toward the goal?');
    };

    const navPoll = setInterval(() => {
      if (!_active) { clearInterval(navPoll); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        _setBadge('Page changed…');
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
    _setBadge('Processing…');
    // Inject user message into trigger — don't push separately (avoids consecutive user turns)
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

  // ── Element highlight (CSS outline — no overlay dependency) ─────────────────

  function _highlightElement(el) {
    _clearHighlight();
    if (!el) return;
    _highlightedEl = el;
    el.classList.add('ophelia-agent-highlight');
  }

  function _clearHighlight() {
    if (_highlightedEl) {
      _highlightedEl.classList.remove('ophelia-agent-highlight');
      _highlightedEl = null;
    }
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

  // ── Minimal floating badge ───────────────────────────────────────────────────

  function _showBadge() {
    if (document.getElementById('ophelia-badge')) return;
    const b = document.createElement('div');
    b.id = 'ophelia-badge';
    b.style.cssText = [
      'position:fixed', 'top:14px', 'right:14px', 'z-index:2147483647',
      'background:rgba(9,9,13,0.92)', 'border:1px solid rgba(66,133,244,0.4)',
      'border-radius:20px', 'padding:5px 10px 5px 12px',
      'display:flex', 'align-items:center', 'gap:8px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'font-size:12px', 'color:#ccc',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.55)', 'cursor:default'
    ].join(';');
    b.innerHTML =
      '<span id="ophelia-badge-text">🤖</span>' +
      '<button id="ophelia-badge-ask" title="Ask Ophelia" style="background:none;border:none;' +
      'color:#666;cursor:pointer;font-size:12px;padding:0;line-height:1">💬</button>' +
      '<button id="ophelia-badge-stop" title="Stop" style="background:none;border:none;' +
      'color:#555;cursor:pointer;font-size:13px;padding:0;line-height:1">✕</button>';
    document.body.appendChild(b);
    _badgeEl = b;
    b.querySelector('#ophelia-badge-stop').addEventListener('click', stop);
    b.querySelector('#ophelia-badge-ask').addEventListener('click', _showAskPopup);
  }

  function _setBadge(text) {
    if (!_badgeEl) _showBadge();
    const el = document.getElementById('ophelia-badge-text');
    if (el) el.textContent = `🤖 ${text}`;
  }

  function _hideBadge() {
    document.getElementById('ophelia-badge')?.remove();
    document.getElementById('ophelia-ask-popup')?.remove();
    _badgeEl = null;
  }

  function _showAskPopup() {
    document.getElementById('ophelia-ask-popup')?.remove();
    const popup = document.createElement('div');
    popup.id = 'ophelia-ask-popup';
    popup.style.cssText = [
      'position:fixed', 'top:48px', 'right:14px', 'z-index:2147483647',
      'background:rgba(9,9,13,0.97)', 'border:1px solid rgba(66,133,244,0.35)',
      'border-radius:12px', 'padding:12px',
      'display:flex', 'gap:7px', 'align-items:center',
      'box-shadow:0 8px 28px rgba(0,0,0,0.6)', 'width:280px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');
    popup.innerHTML =
      '<input id="ophelia-ask-txt" type="text" placeholder="Tell me something…"' +
      ' style="flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);' +
      'border-radius:7px;padding:7px 10px;color:#fff;font-size:13px;font-family:inherit;outline:none"/>' +
      '<button id="ophelia-ask-mic" style="background:none;border:none;cursor:pointer;font-size:16px">🎤</button>' +
      '<button id="ophelia-ask-send" style="background:#4285f4;border:none;border-radius:7px;' +
      'padding:7px 12px;cursor:pointer;color:#fff;font-size:12px;font-weight:600;font-family:inherit">→</button>';
    document.body.appendChild(popup);
    const input = popup.querySelector('#ophelia-ask-txt');
    input.focus();
    const send = () => {
      const t = input.value.trim();
      if (!t) return;
      popup.remove();
      _userMessage(t);
    };
    popup.querySelector('#ophelia-ask-send').addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); if (e.key === 'Escape') popup.remove(); });
    let mic = null;
    popup.querySelector('#ophelia-ask-mic').addEventListener('click', function() {
      if (mic) { mic.stop(); mic = null; this.textContent = '🎤'; return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      mic = new SR();
      mic.lang = 'en-US';
      mic.onstart  = () => { this.textContent = '🔴'; };
      mic.onresult = (e) => { input.value = [...e.results].map(r => r[0].transcript).join(''); };
      mic.onend    = () => { this.textContent = '🎤'; if (input.value.trim()) send(); };
      mic.start();
    });
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

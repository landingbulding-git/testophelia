// Ophelia Assistant — AI-driven live page helper
// Ctrl+Shift+U → own dialog (own mic) → scan DOM → Gemini plan → OpheliaPlayer.playSteps()
// Completely independent of content.js STT routing.
window.OpheliaAssistant = (() => {
  const GM_WORKER  = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev';
  const ASSIST_KEY = 'opheliaAssistant'; // cross-page persistence for navigation resume

  let _active      = false;
  let _userRequest = '';

  // ── Public API ─────────────────────────────────────────────────────────────

  // activate(): show the input dialog. Called by Ctrl+Shift+U.
  function activate() {
    if (window.opheliaTutorialActive) {
      // A tutorial or previous assistant run is active — stop it first
      window.OpheliaPlayer?.stop();
    }
    _showDialog();
  }

  function stop() {
    _closeDialog();
    chrome.storage.local.remove(ASSIST_KEY);
    _active = false;
  }

  function isActive() { return _active; }

  // ── Input dialog ──────────────────────────────────────────────────────────
  // Completely self-contained: own STT recognition instance, no shared state.

  function _showDialog() {
    _closeDialog();

    const dlg = document.createElement('div');
    dlg.id = 'ophelia-ask-dialog';
    dlg.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(14,14,14,0.98)',
      'border:1.5px solid #4285f4',
      'border-radius:16px', 'padding:24px 26px',
      'width:400px', 'max-width:calc(100vw - 40px)',
      'color:#fff', 'z-index:2147483647',
      'box-shadow:0 16px 56px rgba(0,0,0,0.75)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'animation:opheliaCardIn 0.2s ease-out'
    ].join(';');

    dlg.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
                  color:#4285f4;margin-bottom:10px">🤖 Ophelia Assistant</div>
      <div style="font-size:15px;color:#e8e8e8;margin-bottom:16px;line-height:1.4">
        What do you need help with on this page?
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="ophelia-ask-input" type="text" placeholder="Describe your goal…"
          autocomplete="off" style="flex:1;background:rgba(255,255,255,0.07);
          border:1px solid rgba(255,255,255,0.18);border-radius:8px;padding:10px 14px;
          color:#fff;font-size:14px;font-family:inherit;outline:none;
          transition:border-color .15s" />
        <button id="ophelia-ask-mic" title="Click to speak"
          style="background:rgba(66,133,244,0.12);border:1.5px solid #4285f4;
          border-radius:8px;padding:9px 11px;cursor:pointer;font-size:17px;
          transition:background .15s;flex-shrink:0">🎤</button>
        <button id="ophelia-ask-go"
          style="background:#4285f4;border:none;border-radius:8px;padding:10px 18px;
          cursor:pointer;color:#fff;font-size:14px;font-weight:600;
          font-family:inherit;flex-shrink:0;transition:opacity .15s">Go →</button>
      </div>
      <div id="ophelia-ask-status"
        style="font-size:11px;color:#888;margin-top:8px;min-height:14px"></div>
    `;
    document.body.appendChild(dlg);

    const input  = dlg.querySelector('#ophelia-ask-input');
    const micBtn = dlg.querySelector('#ophelia-ask-mic');
    const goBtn  = dlg.querySelector('#ophelia-ask-go');
    const status = dlg.querySelector('#ophelia-ask-status');

    input.focus();

    // Submit on Enter or Go button
    const submit = () => {
      const text = input.value.trim();
      if (!text) { input.style.borderColor = '#f44336'; return; }
      _closeDialog();
      _processRequest(text);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') _closeDialog(); });
    goBtn.addEventListener('click', submit);

    // Dedicated one-shot mic — completely separate from content.js STT
    let _micRec = null;
    micBtn.addEventListener('click', () => {
      if (_micRec) { _micRec.stop(); _micRec = null; micBtn.textContent = '🎤'; return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { status.textContent = 'Speech not supported in this browser.'; return; }
      _micRec = new SR();
      _micRec.continuous = false;
      _micRec.interimResults = true;
      _micRec.lang = 'en-US';
      _micRec.onstart  = () => { micBtn.textContent = '🔴'; status.textContent = 'Listening…'; };
      _micRec.onresult = (e) => {
        const t = [...e.results].map(r => r[0].transcript).join('');
        input.value = t;
        if (e.results[e.results.length - 1].isFinal) {
          _micRec = null;
          micBtn.textContent = '🎤';
          status.textContent = '✓ Got it — press Go or Enter to start';
        }
      };
      _micRec.onerror = (e) => {
        micBtn.textContent = '🎤';
        status.textContent = `Mic error: ${e.error}`;
        _micRec = null;
      };
      _micRec.onend = () => { if (_micRec) { _micRec = null; } micBtn.textContent = '🎤'; };
      _micRec.start();
    });

    // Click outside → close
    const onOutside = (e) => {
      if (!dlg.contains(e.target)) {
        _closeDialog();
        document.removeEventListener('click', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside, true), 150);
  }

  function _closeDialog() {
    const dlg = document.getElementById('ophelia-ask-dialog');
    if (dlg) dlg.remove();
  }

  // ── Core: scan → plan → hand off to player ────────────────────────────────

  async function _processRequest(request) {
    _active = true;
    _userRequest = request;

    notify('🔍 Scanning page…', 'info');
    const ctx = scanPage();

    notify('🤖 Building your guide…', 'info');
    const plan = await generatePlan(request, ctx);

    if (!plan?.steps?.length) {
      notify(plan?.message || 'Could not plan steps for that on this page. Try rephrasing.', 'error');
      _active = false;
      return;
    }

    console.log(`✅ Assistant plan: ${plan.steps.length} step(s)`);

    // Save for cross-page resume
    chrome.storage.local.set({ [ASSIST_KEY]: { steps: plan.steps, stepIndex: 0, userRequest: request } });

    // Hand off entirely to the player — same overlay, TTS, ✏️ correct, navigation handling
    await window.OpheliaPlayer.playSteps(plan.steps);

    chrome.storage.local.remove(ASSIST_KEY);
    _active = false;
  }

  // ── Page scanning ──────────────────────────────────────────────────────────

  function scanPage() {
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
      // Include up to 200px outside viewport (captures near-scroll content)
      if (r.bottom < -200 || r.top > vh + 200 || r.right < 0 || r.left > vw + 200) return;

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

    return { url: location.href, title: document.title, elements: elements.slice(0, 65) };
  }

  // ── Gemini: generate plan ──────────────────────────────────────────────────

  async function generatePlan(request, ctx) {
    const elStr = _formatElements(ctx.elements);
    const prompt =
      `You are a browser step-by-step guide generator. Output ONLY a JSON object — no prose, no markdown.\n\n` +
      `Current page:\n  URL: ${ctx.url}\n  Title: ${ctx.title}\n\n` +
      `Interactive elements visible on this page (copy attribute values exactly as shown):\n${elStr}\n\n` +
      `User wants: "${request}"\n\n` +
      `STRICT RULES:\n` +
      `1. Only use elements listed above. Copy aria_label / text_content verbatim.\n` +
      `2. Each step = one click/action. Keep instructions under 12 words.\n` +
      `3. If a click will open a menu with NEW elements needed later, that click is its own step.\n` +
      `4. element can be null only for navigation-wait steps.\n\n` +
      `OUTPUT FORMAT (JSON only, no other text):\n` +
      `{"possible":true,"steps":[{"instruction":"SHORT sentence","element":{"tag":"","aria_label":"","text_content":"","role":""}}]}\n` +
      `If impossible: {"possible":false,"message":"one short sentence reason"}`;
    return callGemini(prompt);
  }

  // ── Gemini: re-plan remaining steps after DOM change ──────────────────────

  async function replan(originalRequest, remaining, ctx) {
    const remStr  = remaining.map((s, i) => `${i + 1}. ${s.instruction}`).join('\n');
    const elStr   = _formatElements(ctx.elements);
    const prompt  =
      `The user was trying to: "${originalRequest}"\n` +
      `Previously planned remaining steps:\n${remStr}\n\n` +
      `The page changed. Current page:\n  URL: ${ctx.url}\n  Title: ${ctx.title}\n` +
      `Now visible elements:\n${elStr}\n\n` +
      `Update the remaining steps to match the current page state. ` +
      `Keep the same goal; only adjust elements and wording as needed.\n` +
      `Return ONLY valid JSON: {"steps":[{"instruction":"...","element":{...}}]}`;
    const result = await callGemini(prompt);
    return result?.steps || null;
  }

  async function callGemini(prompt) {
    try {
      const res = await fetch(GM_WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
        })
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json();
      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('🤖 Gemini raw:', raw.substring(0, 300));
      // Extract the first JSON object — ignores surrounding prose / markdown fences
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object in response');
      return JSON.parse(match[0]);
    } catch (e) {
      console.error('❌ Assistant Gemini call failed:', e);
      return null;
    }
  }

  function _formatElements(elements) {
    return elements.map(e => {
      const attrs = [
        e.role         ? `role=${e.role}`              : null,
        e.aria_label   ? `aria="${e.aria_label}"`       : null,
        e.data_testid  ? `testid="${e.data_testid}"`    : null,
        e.text_content ? `text="${e.text_content}"`     : null
      ].filter(Boolean).join(' ');
      return `  [${e.tag}${attrs ? ' ' + attrs : ''} @${e.position}]`;
    }).join('\n');
  }

  // ── Cross-page resumption ──────────────────────────────────────────────────
  // When a navigation happens mid-session, player.js pre-saves PLAY_KEY and resumes.
  // ASSIST_KEY is a secondary backup; if player didn't pre-save, we re-plan here.

  function _checkForPending() {
    chrome.storage.local.get([ASSIST_KEY], async result => {
      const p = result[ASSIST_KEY];
      if (!p?.steps?.length) return;
      // Player already handles PLAY_KEY resume; only act if player has nothing
      chrome.storage.local.get(['opheliaTutorial'], r2 => {
        if (r2.opheliaTutorial?.steps?.length) return; // player will handle it
        console.log('🔄 Assistant resume (fallback)');
        chrome.storage.local.remove(ASSIST_KEY);
        _active = true;
        _userRequest = p.userRequest || '';
        window.OpheliaPlayer.playSteps(p.steps.slice(p.stepIndex));
      });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function notify(msg, type) {
    if (typeof window.OpheliaNotify === 'function') window.OpheliaNotify(msg, type);
    else console.log(`[Assistant][${type}] ${msg}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _checkForPending);
  } else {
    _checkForPending();
  }

  return { activate, stop, isActive };
})();

// Ophelia Assistant — AI-driven live page helper
// Ctrl+Shift+U → user speaks request → AI scans DOM → generates live steps → guides user
// After each interaction the DOM is re-checked; if the next element is missing, Gemini re-plans.
window.OpheliaAssistant = (() => {
  const GM_WORKER  = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev';
  const ASSIST_KEY = 'opheliaAssistant'; // cross-page persistence

  let _active      = false;
  let _userRequest = '';

  // ── Public API ─────────────────────────────────────────────────────────────

  async function ask(userRequest) {
    if (_active) { stop(); return; }
    _active = true;
    _userRequest = userRequest;
    window.opheliaTutorialActive = true;

    notify('🔍 Scanning page…', 'info');
    const ctx = scanPage();

    notify('🤖 Planning your steps…', 'info');
    const plan = await generatePlan(userRequest, ctx);

    if (!plan?.steps?.length) {
      const msg = plan?.message || "I'm not sure how to help with that on this page.";
      speak(msg);
      notify(msg, 'error');
      _reset();
      return;
    }

    speak(`I found ${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}. Let's go.`);
    await sleep(800);
    await runSteps(plan.steps, 0);
  }

  function stop() {
    window.OpheliaOverlay.hide();
    chrome.storage.local.remove(ASSIST_KEY);
    stopSpeaking();
    notify('Assistant stopped.', 'info');
    _reset();
  }

  function isActive() { return _active; }

  // ── Step execution loop ────────────────────────────────────────────────────

  async function runSteps(steps, startIndex) {
    for (let i = startIndex; i < steps.length; i++) {
      if (!_active) break;

      const step        = steps[i];
      const instruction = step.instruction || `Step ${i + 1}`;
      const elData      = step.element || null;

      await waitForDOMStable(500);

      // Find element — 2 attempts with a brief wait
      let el = elData ? findEl(elData) : null;
      if (!el && elData) { await sleep(900); el = findEl(elData); }

      const isLast = (i + 1 >= steps.length);

      // Pre-save remaining steps BEFORE showing overlay (handles hard navigation)
      if (!isLast) {
        chrome.storage.local.set({ [ASSIST_KEY]: {
          steps, stepIndex: i + 1, userRequest: _userRequest
        }});
      }

      // Correction callback
      const idx = i;
      const onCorrect = (correctedEl) => {
        const info = captureElement(correctedEl);
        if (info) steps[idx].element = info;
        notify(`Step ${idx + 1} corrected`, 'success');
      };

      // Show overlay
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
      window.OpheliaOverlay.show({
        stepNumber: i + 1, totalSteps: steps.length,
        instruction, element: el, onCorrect
      });
      speak(instruction);

      // Wait for user interaction (ignores correction-mode clicks)
      const startUrl = location.href;
      await waitForInteraction();
      window.OpheliaOverlay.hide();
      stopSpeaking();

      // 500 ms window: if page navigates, JS dies here; new page resumes via checkForPending
      await sleep(500);
      if (!_active) break;

      // Still alive → same-page or SPA; clear the pre-save
      if (!isLast) chrome.storage.local.remove(ASSIST_KEY);

      // After interaction: check if next element still exists; if not, re-plan
      if (!isLast && _active) {
        await waitForDOMStable(600);
        const next = steps[i + 1];
        if (next.element && !findEl(next.element)) {
          console.log('🔄 Assistant: next element missing — re-planning…');
          notify('Adapting plan to page changes…', 'info');
          const updated = await replan(_userRequest, steps.slice(i + 1), scanPage());
          if (updated?.length) {
            steps = [...steps.slice(0, i + 1), ...updated];
            console.log(`✅ Re-planned ${updated.length} remaining step(s)`);
          }
        }
      }
    }

    if (_active) {
      speak('Done! Task complete.');
      notify('✅ Done!', 'success');
      _reset();
    }
  }

  // ── Page scanning ──────────────────────────────────────────────────────────
  // Returns URL, title, and all visible/near-visible interactive elements.

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
      `You are a browser assistant. Help the user complete a task step by step.\n\n` +
      `Page:\n  URL: ${ctx.url}\n  Title: ${ctx.title}\n\n` +
      `Visible/nearby interactive elements (use EXACT attribute values):\n${elStr}\n\n` +
      `User request: "${request}"\n\n` +
      `Rules:\n` +
      `- Use ONLY elements from the list above. Copy their exact aria_label/text_content values.\n` +
      `- If a step opens a dropdown/dialog with new elements, include it as its own step.\n` +
      `- If navigation is expected, a "wait" step (element: null) is fine.\n` +
      `- Write instructions as short, friendly sentences a non-technical user can follow.\n\n` +
      `Return ONLY valid JSON (no markdown):\n` +
      `{"possible":true,"steps":[{"instruction":"...","element":{"tag":"...","aria_label":"...","text_content":"...","role":"...","data_testid":"..."}}]}\n` +
      `If the task is impossible with current elements: {"possible":false,"message":"short reason"}`;
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
      const data  = await res.json();
      const raw   = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(clean);
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

  function checkForPending() {
    chrome.storage.local.get([ASSIST_KEY], result => {
      const p = result[ASSIST_KEY];
      if (p?.steps?.length) {
        console.log(`🔄 Assistant resuming from step ${p.stepIndex + 1}`);
        chrome.storage.local.remove(ASSIST_KEY);
        _active = true;
        _userRequest = p.userRequest || '';
        window.opheliaTutorialActive = true;
        waitForDOMStable(800).then(async () => {
          // Re-plan remaining steps now that we're on a new page
          notify('Adapting plan to new page…', 'info');
          const updated = await replan(_userRequest, p.steps.slice(p.stepIndex), scanPage());
          const steps   = updated?.length
            ? [...p.steps.slice(0, p.stepIndex), ...updated]
            : p.steps;
          runSteps(steps, p.stepIndex);
        });
      }
    });
  }

  // ── Element finder — delegates to player's full 8-tier matcher ─────────────

  function findEl(d) {
    if (window.OpheliaPlayer?.findElement) return window.OpheliaPlayer.findElement(d);
    if (!d) return null;
    // Minimal fallback (player.js should always be present)
    if (d.aria_label) {
      const el = document.querySelector(`[aria-label="${d.aria_label}"]`);
      if (el && _visible(el)) return el;
    }
    if (d.text_content || d.label) {
      const t = (d.text_content || d.label).toLowerCase();
      const sel = 'button,a,[role="menuitem"],[role="option"],[role="tab"],[role="button"]';
      return [...document.querySelectorAll(sel)].find(e =>
        _visible(e) && (e.textContent || '').trim().toLowerCase() === t
      ) || null;
    }
    return null;
  }

  // ── Element capture (for corrections) ─────────────────────────────────────

  function captureElement(el) {
    try {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const aria    = el.getAttribute('aria-label') || '';
      const ownText = [...el.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim()).filter(Boolean)
        .join(' ').replace(/\s+/g, ' ').substring(0, 80);
      const fullText = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
      const text  = ownText || fullText;
      return {
        tag:          el.tagName.toLowerCase(),
        id:           (el.id && !/^injected_/i.test(el.id)) ? el.id : null,
        aria_label:   aria || null,
        data_testid:  el.getAttribute('data-testid') || null,
        text_content: text || null,
        role:         el.getAttribute('role') || null,
        label:        aria || text || el.tagName.toLowerCase(),
        pos: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      };
    } catch (_) { return null; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _visible(el) {
    const r = el.getBoundingClientRect(), cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' &&
           parseFloat(cs.opacity) > 0 && r.width > 0 && r.height > 0;
  }

  function waitForInteraction() {
    return new Promise(resolve => {
      const startUrl = location.href;
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        document.removeEventListener('click', onClick, true);
        clearInterval(poll);
        resolve();
      };
      const onClick = () => { if (window.opheliaCorrectionMode) return; finish(); };
      const poll = setInterval(() => { if (location.href !== startUrl) finish(); }, 200);
      document.addEventListener('click', onClick, true);
    });
  }

  function waitForDOMStable(quietMs = 500) {
    return new Promise(resolve => {
      let t;
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, quietMs); });
      const done = () => { obs.disconnect(); resolve(); };
      obs.observe(document.body, { childList: true, subtree: true });
      t = setTimeout(done, quietMs);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05; utt.pitch = 1.0; utt.volume = 1.0;
    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha')))
                || voices.find(v => v.lang.startsWith('en'));
      if (pref) utt.voice = pref;
      window.speechSynthesis.speak(utt);
    };
    window.speechSynthesis.getVoices().length > 0 ? doSpeak()
      : (window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); });
  }

  function stopSpeaking() { window.speechSynthesis?.cancel(); }

  function _reset() {
    _active = false;
    window.opheliaTutorialActive = false;
    window.OpheliaOverlay.hide();
  }

  function notify(msg, type) {
    if (typeof window.OpheliaNotify === 'function') window.OpheliaNotify(msg, type);
    else console.log(`[Assistant][${type}] ${msg}`);
  }

  // Auto-resume on every page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForPending);
  } else {
    checkForPending();
  }

  return { ask, stop, isActive, checkForPending };
})();

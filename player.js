// Ophelia Player - Guided tutorial playback with 5-tier element finding and DOM stability detection
window.OpheliaPlayer = (() => {
  const PLAY_KEY  = 'opheliaTutorial';
  const CORR_KEY  = 'opheliaCorrections'; // user-supplied corrections per session+step
  const FB_WORKER = 'https://ophelia-firebase-worker.norbertb-consulting.workers.dev';

  let _playing = false;

  // ── Load tutorial from Firebase and begin ────────────────────────────────

  async function loadAndStart(sessionId) {
    try {
      notify('Loading tutorial…', 'info');

      const res = await fetch(`${FB_WORKER}/load-tutorial?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.tutorial) throw new Error(`Tutorial "${sessionId}" not found`);

      const raw    = data.tutorial.fields.tutorial_steps?.stringValue;
      const parsed = JSON.parse(raw);
      const steps  = parsed.steps || parsed;
      const startUrl = data.tutorial.fields.starting_url?.stringValue || null;

      console.log(`📚 Tutorial loaded: ${steps.length} steps, start URL: ${startUrl}`);

      // If we're not already on the right page, navigate first
      if (startUrl && window.location.href !== startUrl) {
        chrome.storage.local.set({ [PLAY_KEY]: { steps, stepIndex: 0, sessionId } });
        chrome.runtime.sendMessage({ action: 'navigate', url: startUrl });
        return;
      }

      await play(steps, 0, sessionId);

    } catch (err) {
      console.error('❌ Tutorial load failed:', err);
      notify(`Tutorial load failed: ${err.message}`, 'error');
    }
  }

  // ── Resume after navigation (called on every page load) ──────────────────

  function checkForPending() {
    chrome.storage.local.get([PLAY_KEY], (result) => {
      const pending = result[PLAY_KEY];
      if (pending?.steps?.length) {
        console.log(`🔄 Resuming tutorial from step ${pending.stepIndex + 1}/${pending.steps.length}`);
        chrome.storage.local.remove(PLAY_KEY);
        // Wait for DOM to be ready and stable before starting
        waitForDOMStable(800).then(() => play(pending.steps, pending.stepIndex, pending.sessionId || null));
      }
    });
  }

  // ── Main playback loop ────────────────────────────────────────────────────

  async function play(steps, startIndex = 0, sessionId = null) {
    _playing = true;
    window.opheliaTutorialActive = true; // Tells content.js to stop sphere mouse-following

    // Load any user corrections saved for this tutorial
    const _corrections = await loadCorrections(sessionId);

    for (let i = startIndex; i < steps.length; i++) {
      if (!_playing) break;

      const step        = steps[i];
      const elData      = step.element || step.dom_element || step;
      const instruction = step.instruction || step.raw_instruction || `Step ${i + 1}`;

      console.log(`▶️  Step ${i + 1}/${steps.length}: ${instruction}`);
      notify(`Step ${i + 1} of ${steps.length}`, 'info');

      // Let the DOM settle before searching
      await waitForDOMStable(600);

      // T0: use a saved correction for this step (highest priority)
      let el = null;
      const savedCorr = _corrections[i];
      if (savedCorr?.element) {
        el = findElement(savedCorr.element);
        if (el) console.log(`  ✅ T0 correction (saved by user)`);
        else    console.log(`  ⚠️ T0 correction element not found, falling back`);
      }

      // Normal element finding if no correction or correction element not found
      if (!el) {
        for (let attempt = 0; attempt < 3 && !el; attempt++) {
          el = findElement(elData);
          if (!el && attempt < 2) {
            console.log(`   ↳ Attempt ${attempt + 1} failed, retrying…`);
            await sleep(1500);
          }
        }
      }

      const isLast = (i + 1 >= steps.length);

      // CRITICAL: Persist the NEXT step BEFORE showing the overlay.
      // If the user's click navigates away, Chrome kills this page's JS immediately
      // and any set() call after the click would never run. Pre-saving guarantees
      // the new page always has something to resume from.
      if (!isLast) {
        await chrome.storage.local.set({ [PLAY_KEY]: { steps, stepIndex: i + 1, sessionId } });
      }

      // Correction callback — called by overlay when user picks a different element
      const onCorrect = (correctedEl) => {
        const elInfo = captureElement(correctedEl);
        if (!elInfo) return;
        _corrections[i] = { element: elInfo, savedAt: Date.now() };
        if (sessionId) saveCorrection(sessionId, i, elInfo);
        console.log(`✏️  Correction saved for step ${i + 1}: "${elInfo.label}"`);
        notify(`Correction saved for step ${i + 1}`, 'success');
      };

      if (!el) {
        console.warn(`⚠️  Step ${i + 1}: element not found after 3 attempts`);
        notify(
          `Step ${i + 1}: Couldn't find the element. Please do this manually:\n"${instruction}"`,
          'error'
        );
        window.OpheliaOverlay.show({ stepNumber: i + 1, totalSteps: steps.length, instruction, element: null, onCorrect });
        await waitForAnyClick();
        window.OpheliaOverlay.hide();
        // Manual step done without navigation — clear the pre-saved state
        if (!isLast) chrome.storage.local.remove(PLAY_KEY);
        continue;
      }

      // Scroll into view smoothly, then show overlay
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);

      window.OpheliaOverlay.show({ stepNumber: i + 1, totalSteps: steps.length, instruction, element: el, onCorrect });
      speak(instruction);

      // Wait for any interaction (click OR programmatic URL change).
      // waitForInteraction ignores clicks while opheliaCorrectionMode is active.
      await waitForInteraction();
      window.OpheliaOverlay.hide();
      stopSpeaking();

      // Sleep 500ms to give Chrome a window to kill this page if it was a real
      // full-page navigation. If the page dies, JS stops here and PLAY_KEY
      // (already saved above) is found by the new page's checkForPending.
      // If we're still alive after 500ms → SPA route change, dropdown, or
      // no navigation → clear the pre-save and continue the loop.
      await sleep(500);

      console.log(`✅  Step ${i + 1} complete, continuing to next step`);
      if (!isLast) chrome.storage.local.remove(PLAY_KEY);
    }

    // All steps complete
    _playing = false;
    window.opheliaTutorialActive = false;
    window.OpheliaOverlay.hide();
    chrome.storage.local.remove(PLAY_KEY);
    speak('Tutorial complete!');
    notify('Tutorial complete! 🎉', 'success');
    console.log('🏁 Tutorial complete');
  }

  function stop() {
    _playing = false;
    window.opheliaTutorialActive = false;
    window.OpheliaOverlay.hide();
    chrome.storage.local.remove(PLAY_KEY);
    stopSpeaking();
    notify('Tutorial stopped.', 'info');
  }

  // ── Correction storage ────────────────────────────────────────────────────

  function loadCorrections(sessionId) {
    return new Promise(resolve => {
      if (!sessionId) return resolve({});
      chrome.storage.local.get([CORR_KEY], result => {
        resolve((result[CORR_KEY] || {})[sessionId] || {});
      });
    });
  }

  function saveCorrection(sessionId, stepIndex, elInfo) {
    chrome.storage.local.get([CORR_KEY], result => {
      const all = result[CORR_KEY] || {};
      if (!all[sessionId]) all[sessionId] = {};
      all[sessionId][stepIndex] = { element: elInfo, savedAt: Date.now() };
      chrome.storage.local.set({ [CORR_KEY]: all });
      console.log(`💾 Correction persisted: session=${sessionId}, step=${stepIndex + 1}`);
    });
  }

  // ── Element capture (for corrections) ────────────────────────────────────
  // Mirrors recorder.js extractElement — captures all matching signals from a live element.

  function captureElement(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const aria   = el.getAttribute('aria-label') || '';
      const testId = el.getAttribute('data-testid') || '';
      const ph     = el.getAttribute('placeholder') || '';
      const ownText = [...el.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim()).filter(Boolean)
        .join(' ').replace(/\s+/g, ' ').substring(0, 80);
      const fullText = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
      const text  = ownText || fullText;
      const label = aria || testId || ph || text || el.tagName.toLowerCase();
      return {
        tag:         el.tagName.toLowerCase(),
        id:          (el.id && !/^injected_/i.test(el.id)) ? el.id : null,
        aria_label:  aria   || null,
        data_testid: testId || null,
        text_content: text  || null,
        role:        el.getAttribute('role') || null,
        label,
        pos: {
          x: Math.round(rect.left + rect.width  / 2),
          y: Math.round(rect.top  + rect.height / 2)
        }
      };
    } catch (_) { return null; }
  }

  // ── Text-to-Speech ────────────────────────────────────────────────────────

  function speak(text) {
    if (!window.speechSynthesis) return;
    stopSpeaking();

    const utt  = new SpeechSynthesisUtterance(text);
    utt.rate   = 1.05;
    utt.pitch  = 1.0;
    utt.volume = 1.0;

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha'))
      ) || voices.find(v => v.lang.startsWith('en'));
      if (preferred) utt.voice = preferred;
      window.speechSynthesis.speak(utt);
    };

    // Voices load asynchronously on first use
    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    }
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Element finder ───────────────────────────────────────────────────────
  // Strategy: exact stable IDs first, then text/label signals, then scored
  // fallback, then spatial. CSS selectors are only trusted when they contain
  // a reliable anchor (#id or [data-testid]) AND match the recorded label.

  function findElement(d) {
    if (!d) return null;
    const tag   = d.tag   || '*';
    const label = (d.label        || '').trim().toLowerCase();
    const text  = (d.text_content || d.label || '').trim().toLowerCase();

    // ── T1: aria-label exact ─────────────────────────────────────────────
    if (d.aria_label) {
      const el = document.querySelector(`[aria-label="${d.aria_label}"]`);
      if (el && visible(el)) { log('T1 aria-label exact'); return el; }

      // Partial aria-label on matching tag
      const partial = [...document.querySelectorAll(`[aria-label]`)].find(e =>
        visible(e) &&
        e.tagName.toLowerCase() === tag &&
        e.getAttribute('aria-label').toLowerCase().includes(d.aria_label.toLowerCase())
      );
      if (partial) { log('T1 aria-label partial+tag'); return partial; }
    }

    // ── T2: data-testid ──────────────────────────────────────────────────
    if (d.data_testid) {
      const el = document.querySelector(`[data-testid="${d.data_testid}"]`);
      if (el && visible(el)) { log('T2 data-testid'); return el; }
    }

    // ── T3: anchored CSS selector (id or data-testid in path) + label check
    if (d.selector && (d.selector.includes('#') || d.selector.includes('[data-testid'))) {
      try {
        const el = document.querySelector(d.selector);
        if (el && visible(el) && labelMatches(el, text)) { log('T3 anchored selector'); return el; }
      } catch (_) {}
    }

    // ── T4: exact text content + tag ─────────────────────────────────────
    // Most reliable for menu items, buttons, links.
    if (text && tag !== '*') {
      const candidates = [...document.querySelectorAll(tag)].filter(visible);

      // Exact text match
      const exact = candidates.find(e =>
        cleanText(e) === text
      );
      if (exact) { log('T4 text+tag exact'); return exact; }

      // Text starts with our label (handles "Settings • 3 notifications" type text)
      const starts = candidates.find(e => cleanText(e).startsWith(text));
      if (starts) { log('T4 text+tag starts-with'); return starts; }
    }

    // ── T5: text match across all interactive elements ────────────────────
    if (text) {
      const INTERACTIVE = 'a,button,input,[role="menuitem"],[role="option"],[role="tab"],[role="button"],[role="link"],li,span';
      const all = [...document.querySelectorAll(INTERACTIVE)].filter(visible);

      const exact = all.find(e => cleanText(e) === text);
      if (exact) { log('T5 interactive text exact'); return exact; }

      const starts = all.find(e => cleanText(e).startsWith(text) && cleanText(e).length < text.length + 30);
      if (starts) { log('T5 interactive text starts-with'); return starts; }
    }

    // ── T6: scored matching across interactive elements ───────────────────
    // Picks the highest-scoring visible element using all available signals.
    {
      const INTERACTIVE = 'a,button,input,select,textarea,[role="menuitem"],[role="option"],[role="tab"],[role="button"],[role="link"],li';
      let best = null, bestScore = 0;

      for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!visible(el)) continue;
        const s = score(el, d, text, label, tag);
        if (s > bestScore) { bestScore = s; best = el; }
      }

      // Require at least 2 signals to agree before accepting
      if (best && bestScore >= 2) { log(`T6 scored (${bestScore}pts)`); return best; }
    }

    // ── T7: generic CSS selector (last-resort, no label check) ───────────
    if (d.selector) {
      try {
        const el = document.querySelector(d.selector);
        if (el && visible(el)) { log('T7 generic selector fallback'); return el; }
      } catch (_) {}
    }

    // ── T8: spatial (100px radius) ────────────────────────────────────────
    if (d.pos && tag !== '*') {
      for (const el of document.getElementsByTagName(tag)) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (Math.abs(r.left + r.width / 2  - d.pos.x) < 100 &&
            Math.abs(r.top  + r.height / 2 - d.pos.y) < 100) {
          log('T8 spatial');
          return el;
        }
      }
    }

    log('all tiers failed');
    return null;
  }

  // ── Scoring helper ────────────────────────────────────────────────────────

  function score(el, d, text, label, tag) {
    let s = 0;
    if (el.tagName.toLowerCase() === tag)              s += 1;
    if (d.aria_label && el.getAttribute('aria-label') === d.aria_label) s += 5;
    if (d.data_testid && el.getAttribute('data-testid') === d.data_testid) s += 5;
    if (d.id && el.id === d.id)                        s += 4;
    if (d.role && el.getAttribute('role') === d.role)  s += 1;

    const et = cleanText(el);
    if (text && et === text)                           s += 4;
    else if (text && et.startsWith(text))              s += 2;
    else if (label && et.includes(label))              s += 1;

    if (d.aria_label && (el.getAttribute('aria-label') || '').toLowerCase().includes(d.aria_label.toLowerCase())) s += 2;
    return s;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function cleanText(el) {
    return (el.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function labelMatches(el, text) {
    if (!text) return true;
    const t = cleanText(el);
    return t === text || t.startsWith(text) || t.includes(text);
  }

  function log(msg) { console.log(`  ✅ ${msg}`); }

  function visible(el) {
    const r  = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' &&
           cs.visibility !== 'hidden' &&
           parseFloat(cs.opacity) > 0 &&
           r.width > 0 && r.height > 0;
  }

  // ── Interaction & timing helpers ────────────────────────────────────────
  // Resolves on the FIRST of: a click, OR a programmatic URL change.
  // Does NOT try to classify navigation type — play() handles that via sleep.

  function waitForInteraction() {
    return new Promise((resolve) => {
      const startUrl = window.location.href;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener('click', onClick, true);
        clearInterval(navPoll);
        resolve();
      };

      // Ignore clicks that happen while the user is in correction mode
      const onClick = () => { if (window.opheliaCorrectionMode) return; finish(); };
      // Also resolve on programmatic navigation (no click involved)
      const navPoll = setInterval(() => { if (window.location.href !== startUrl) finish(); }, 200);

      document.addEventListener('click', onClick, true);
    });
  }

  function waitForAnyClick() {
    return new Promise((resolve) => {
      const h = () => { document.removeEventListener('click', h, true); resolve(); };
      document.addEventListener('click', h, true);
    });
  }

  // Waits until no DOM mutations for quietMs — ensures page is stable
  function waitForDOMStable(quietMs = 500) {
    return new Promise((resolve) => {
      let t = null;
      const obs = new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => { obs.disconnect(); resolve(); }, quietMs);
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: false });
      // Resolve immediately if already quiet
      t = setTimeout(() => { obs.disconnect(); resolve(); }, quietMs);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function notify(msg, type) {
    if (typeof window.OpheliaNotify === 'function') window.OpheliaNotify(msg, type);
    else console.log(`[Player][${type}] ${msg}`);
  }

  // ── Auto-check on every page load ───────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForPending);
  } else {
    checkForPending();
  }

  return { loadAndStart, checkForPending, stop, findElement };
})();

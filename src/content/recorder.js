// Ophelia Recorder - Cross-page session recording with rolling speech buffer
// Each click immediately produces a self-contained step: element info + speech at that moment.
// AI post-processing is disabled in this baseline build.
window.OpheliaRecorder = (() => {
  const REC_KEY   = 'opheliaRecording';
  const FB_WORKER = 'https://ophelia-firebase-worker.norbertb-consulting.workers.dev';

  let _state = { active: false, steps: [], startingUrl: null, startTime: null, sessionId: null };
  let _clickListener = null;
  let _speechBuffer  = []; // { text, ts }

  // ── Speech buffer ─────────────────────────────────────────────────────────
  // content.js calls pushSpeech() on every STT result during recording.
  // When a click fires, we consume the last N seconds to attach to that step.

  function pushSpeech(text) {
    _speechBuffer.push({ text, ts: Date.now() });
    if (_speechBuffer.length > 40) _speechBuffer.shift();
  }

  function consumeSpeech(windowMs = 6000) {
    const since = Date.now() - windowMs;
    return _speechBuffer
      .filter(e => e.ts >= since)
      .map(e => e.text)
      .join(' ')
      .trim();
  }

  // ── Element extraction ────────────────────────────────────────────────────

  function selectorPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id && !/^injected_/i.test(cur.id)) {
        seg += `#${CSS.escape(cur.id)}`;
        parts.unshift(seg);
        break;
      }
      if (cur.getAttribute('data-testid')) {
        seg += `[data-testid="${cur.getAttribute('data-testid')}"]`;
        parts.unshift(seg);
        break;
      }
      const sibs = cur.parentNode
        ? Array.from(cur.parentNode.children).filter(s => s.tagName === cur.tagName)
        : [];
      if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function extractElement(el) {
    try {
      const rect = el.getBoundingClientRect();
      const cs   = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || rect.width === 0) return null;

      const aria   = el.getAttribute('aria-label') || '';
      const testId = el.getAttribute('data-testid') || '';
      const ph     = el.getAttribute('placeholder') || '';

      // Own text nodes only (avoids capturing all nested children's text)
      const ownText = [...el.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .substring(0, 80);
      // Full text as fallback
      const fullText = (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
      const text  = ownText || fullText;
      const label = aria || testId || ph || text || el.tagName.toLowerCase();

      // Screen region hint (top/middle/bottom + left/center/right)
      const vw = window.innerWidth, vh = window.innerHeight;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const hReg = cx < vw / 3 ? 'left' : cx < (2 * vw) / 3 ? 'center' : 'right';
      const vReg = cy < vh / 3 ? 'top'  : cy < (2 * vh) / 3 ? 'middle' : 'bottom';

      return {
        tag:           el.tagName.toLowerCase(),
        id:            (el.id && !/^injected_/i.test(el.id)) ? el.id : null,
        aria_label:    aria   || null,
        data_testid:   testId || null,
        text_content:  text   || null,
        role:          el.getAttribute('role') || null,
        screen_region: `${vReg}-${hReg}`,
        selector:      selectorPath(el),
        label,
        pos: {
          x: Math.round(rect.left + rect.width  / 2),
          y: Math.round(rect.top  + rect.height / 2)
        }
      };
    } catch (_) { return null; }
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function persist() {
    chrome.storage.local.set({ [REC_KEY]: _state });
  }

  // ── Meaningful target resolver ──────────────────────────────────────────
  // When user clicks an <img> or <svg> inside a <button>, we want the button.
  // Walk up to find the nearest interactive / labelled ancestor.

  function meaningfulTarget(el) {
    const GOOD_TAGS  = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);
    const GOOD_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

    // Original element already has a stable identifier → keep it
    if (el.getAttribute('aria-label') || el.getAttribute('data-testid')) return el;

    let cur = el;
    while (cur && cur !== document.body) {
      const tag  = (cur.tagName || '').toLowerCase();
      const role = cur.getAttribute('role') || '';
      if (GOOD_TAGS.has(tag) || GOOD_ROLES.has(role) ||
          cur.getAttribute('aria-label') || cur.getAttribute('data-testid')) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el; // fallback to original
  }

  // ── Click capture ─────────────────────────────────────────────────────────

  function attachClicks() {
    _clickListener = (e) => {
      if (!_state.active) return;

      // Ignore clicks on Ophelia's own UI
      if (e.target.closest('#cross-tab-sphere, #ophelia-card, #ophelia-dot')) return;

      // Use the nearest meaningful ancestor (e.g. button wrapping an img/svg)
      const target = meaningfulTarget(e.target);
      const elInfo = extractElement(target);
      if (!elInfo) return;

      const speech = consumeSpeech(6000);
      const step = {
        step_number:     _state.steps.length + 1,
        url:             window.location.href,
        raw_instruction: speech,
        element:         elInfo,
        timestamp:       Date.now()
      };

      _state.steps.push(step);
      persist();
      notify(`Step ${step.step_number} captured: "${elInfo.label}"`, 'info');
      console.log(`📝 Step ${step.step_number}`, elInfo.label, speech ? `| "${speech}"` : '| (no speech)');
    };

    document.addEventListener('click', _clickListener, true);
  }

  function detachClicks() {
    if (_clickListener) {
      document.removeEventListener('click', _clickListener, true);
      _clickListener = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function start() {
    if (_state.active) {
      notify('Recording already active', 'warning');
      return _state.sessionId;
    }
    _state = {
      active:      true,
      steps:       [],
      startingUrl: window.location.href,
      startTime:   Date.now(),
      sessionId:   `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    _speechBuffer = [];
    persist();
    attachClicks();
    console.log('🔴 Recording started:', _state.sessionId);
    notify('Recording started — speak your instructions as you click!', 'success');
    return _state.sessionId;
  }

  function resume(saved) {
    _state = { ...saved, active: true };
    attachClicks();
    console.log(`🔄 Recording resumed (${_state.steps.length} steps so far)`);
    notify(`Recording resumed on new page (${_state.steps.length} steps)`, 'info');
  }

  async function stop() {
    if (!_state.active) return;
    _state.active = false;
    detachClicks();

    const snap = { ..._state };
    chrome.storage.local.remove(REC_KEY);

    if (snap.steps.length === 0) {
      notify('No steps were recorded.', 'error');
      return;
    }

    notify(`Finalizing ${snap.steps.length} recorded steps…`, 'info');
    console.log(`⏹️ Recording stopped: ${snap.steps.length} steps`);

    try {
      snap.steps = attachFallbackInstructions(snap.steps);
      await saveToFirebase(snap);

      const tutorialUrl = `https://testophelia.vercel.app/tutorial.html?id=${snap.sessionId}`;
      console.log('🔗 Tutorial URL:', tutorialUrl);
      notify(`✅ Tutorial saved! Share this link:\n${tutorialUrl}`, 'success');
      chrome.storage.local.set({ opheliaLastTutorialUrl: tutorialUrl });

    } catch (err) {
      console.error('❌ Save failed:', err);
      notify(`Save failed: ${err.message}`, 'error');
    }
  }

  // ── Deterministic instruction fallback (no AI calls) ─────────────────────
  function attachFallbackInstructions(steps) {
    return steps.map((s) => ({
      ...s,
      instruction: s.raw_instruction || `Click on "${s.element.label}"`
    }));
  }

  // ── Firebase save ─────────────────────────────────────────────────────────

  async function saveToFirebase(snap) {
    const res = await fetch(`${FB_WORKER}/save-tutorial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firebaseData: {
          fields: {
            session_id:     { stringValue: snap.sessionId },
            starting_url:   { stringValue: snap.startingUrl },
            start_time:     { stringValue: new Date(snap.startTime).toISOString() },
            created_at:     { stringValue: new Date().toISOString() },
            tutorial_steps: { stringValue: JSON.stringify({ steps: snap.steps }) }
          }
        }
      })
    });
    if (!res.ok) throw new Error(`Firebase save failed (${res.status})`);
    console.log('✅ Tutorial saved to Firebase');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isActive()  { return _state.active; }
  function stepCount() { return _state.steps.length; }

  function notify(msg, type) {
    if (typeof window.OpheliaNotify === 'function') window.OpheliaNotify(msg, type);
    else console.log(`[Recorder][${type}] ${msg}`);
  }

  // Auto-resume on page load if a recording was active
  chrome.storage.local.get([REC_KEY], (result) => {
    const saved = result[REC_KEY];
    if (saved && saved.active) resume(saved);
  });

  return { start, stop, pushSpeech, isActive, stepCount };
})();

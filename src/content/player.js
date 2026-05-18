// Ophelia Player - Guide playback with 8-tier element finding and DOM stability detection
window.OpheliaPlayer = (() => {
  const GUIDE_PLAY_KEY = 'opheliaGuidePending';
  const WORKER_BASE    = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev';

  let _playing         = false;
  let _activeGuide     = null;
  let _activeStepIndex = 0;
  let _sessionId       = 0;
  let _lastStepTs      = 0;
  let _visitedDomains  = new Set();
  let _distractionTimer = null;
  let _distractionFired = false;

  // ── Resume after navigation (called on every page load) ──────────────────

  function checkForPending() {
    chrome.storage.local.get([GUIDE_PLAY_KEY], (result) => {
      const pending = result[GUIDE_PLAY_KEY];
      if (pending?.guide) {
        console.log(`🔄 Resuming guide from step ${(pending.stepIndex || 0) + 1}`);
        chrome.storage.local.remove(GUIDE_PLAY_KEY);
        waitForDOMStable(800).then(() => startGuide(pending.guide, pending.stepIndex || 0));
      }
    });
  }

  // ── Guide playback ────────────────────────────────────────────────────────

  async function startGuide(guideOrId, startIndex) {
    let guide = guideOrId;
    if (typeof guideOrId === 'string') {
      notify('⏳ Loading guide…', 'info');
      try {
        const res = await fetch(`${WORKER_BASE}/guide/${guideOrId}`);
        if (!res.ok) throw new Error('Guide not found');
        guide = await res.json();
      } catch (err) {
        notify(`Could not load guide: ${err.message}`, 'error');
        return;
      }
    }

    const startIdx = startIndex || 0;
    const targetUrl = guide.steps?.[startIdx]?.url || guide.pageUrl || `https://${guide.domain}`;
    let targetDomain = guide.domain;
    try {
      if (targetUrl.startsWith('http')) targetDomain = new URL(targetUrl).hostname;
    } catch (_) {}

    // Check if the user is trying to start a guide on the wrong website entirely
    if (targetDomain && location.hostname !== targetDomain && !location.hostname.endsWith('.' + targetDomain)) {
      notify(`Redirecting to guide...`, 'info');
      chrome.storage.local.set({ [GUIDE_PLAY_KEY]: { guide, stepIndex: startIdx } });
      window.location.href = targetUrl;
      return;
    }

    const mySessionId = ++_sessionId;
    _playing = true;
    window.opheliaTutorialActive = true;

    _activeGuide    = guide;
    _visitedDomains = new Set([location.hostname]);
    _startDistractionMonitor(guide);

    for (let i = startIdx; i < guide.steps.length; i++) {
      if (!_playing || mySessionId !== _sessionId) return;

      // Persist current state immediately so we can survive a reload at any point in this step
      chrome.storage.local.set({ [GUIDE_PLAY_KEY]: { guide, stepIndex: i } });

      _activeStepIndex  = i;
      _lastStepTs       = Date.now();
      _distractionFired = false;

      const step   = guide.steps[i];
      const isLast = (i + 1 >= guide.steps.length);

      console.log(`[Player] Step ${i + 1}/${guide.steps.length}: Starting navigation check...`);
      const onPage = await _ensureOnStepPage(step, i, guide, mySessionId);
      if (!onPage) return;

      console.log(`[Player] Step ${i + 1}: On correct page. Waiting for DOM to settle...`);
      await waitForDOMStable(600);
      if (!_playing || mySessionId !== _sessionId) return;

      console.log(`[Player] Step ${i + 1}: Searching for element...`);
      let el = null;
      for (let attempt = 0; attempt < 4 && !el; attempt++) {
        el = _reidentifyElement(step);
        if (!el && attempt < 3) {
          console.log(`   ↳ Attempt ${attempt + 1} failed, waiting for elements...`);
          await waitForDOMStable(attempt === 0 ? 500 : 1000);
          if (!_playing || mySessionId !== _sessionId) return;
        }
      }

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(350);
      } else {
        console.warn(`⚠️  Step ${i + 1}: element not found after 3 attempts`);
      }

      const instruction = step.narration || `Step ${i + 1}.`;
      window.OpheliaOverlay.show({
        stepNumber:  i + 1,
        totalSteps:  guide.steps.length,
        instruction,
        element:     el || null,
        onCorrect:   null
      });
      speak(instruction);

      // Auto-advance: wait for specific interaction based on step action type
      await waitForInteraction(step, el);
      if (!_playing || mySessionId !== _sessionId) return;

      window.OpheliaOverlay.hide();
      stopSpeaking();

      // 500ms window for full-page navigation to kill this page.
      // If still alive → SPA / no nav → clear pre-save and loop.
      await sleep(500);
      if (!_playing || mySessionId !== _sessionId) return;

      console.log(`✅  Step ${i + 1} complete`);
    }

    if (_playing && mySessionId === _sessionId) {
      _playing         = false;
      _activeGuide     = null;
      window.opheliaTutorialActive = false;
      _stopDistractionMonitor();
      window.OpheliaOverlay.hide();
      chrome.storage.local.remove(GUIDE_PLAY_KEY);
      speak('Guide complete! Great job.');
      notify('Guide complete! 🎉', 'success');
      console.log('🏁 Guide complete');
    }
  }

  function stop() {
    _playing         = false;
    _activeGuide     = null;
    window.opheliaTutorialActive = false;
    _stopDistractionMonitor();
    window.OpheliaOverlay.hide();
    chrome.storage.local.remove(GUIDE_PLAY_KEY);
    stopSpeaking();
    document.getElementById('ophelia-distraction-prompt')?.remove();
    notify('Guide stopped.', 'info');
  }

  // ── Tab / page navigation ─────────────────────────────────────────────────

  const IDENTITY_PARAMS = ['id', 'app', 'project', 'workspace', 'org', 'team', 'slug', 'v', 'key'];
  const STATE_PARAMS    = ['tab', 'view', 'mode', 'section', 'page', 'pane', 'step', 'name', 'type', 'action'];

  function _normalizeUrl(u) {
    try {
      const url  = new URL(u);
      const base = url.origin + url.pathname.replace(/\/$/, '');
      
      // We ignore identity params (id, app) but keep state params (tab, view)
      // This ensures we don't navigate if we're on the same "screen" but a different "project"
      const params = [];
      for (const [k, v] of url.searchParams.entries()) {
        if (STATE_PARAMS.includes(k.toLowerCase())) {
          params.push(`${k.toLowerCase()}=${v.toLowerCase()}`);
        }
      }
      return params.length ? `${base}?${params.sort().join('&')}` : base;
    } catch (_) { return u; }
  }

  /**
   * Patches a recorded URL with identity parameters from the current session.
   * If recorded is ?id=A and current is ?id=B, returns ?id=B.
   */
  function _getSmartUrl(recordedUrl) {
    try {
      const target  = new URL(recordedUrl);
      const current = new URL(location.href);

      // Only patch if we are on the same domain
      if (target.origin !== current.origin) return recordedUrl;

      let modified = false;
      IDENTITY_PARAMS.forEach(key => {
        if (target.searchParams.has(key) && current.searchParams.has(key)) {
          const curVal = current.searchParams.get(key);
          if (target.searchParams.get(key) !== curVal) {
            target.searchParams.set(key, curVal);
            modified = true;
          }
        }
      });

      return modified ? target.toString() : recordedUrl;
    } catch (_) { return recordedUrl; }
  }

  async function _ensureOnStepPage(step, stepIndex, guide, currentSessionId) {
    let stepUrl = step.url;
    if (!stepUrl) return true;

    const checkMatch = () => {
      try {
        stepUrl = _getSmartUrl(step.url); // Re-patch in case current URL changed during a wait
        return _normalizeUrl(location.href) === _normalizeUrl(stepUrl);
      } catch (_) { return true; }
    };

    // 1. Instant match
    if (checkMatch()) return true;

    // 2. Soft wait (up to 6s) for natural navigation (SPA transition or slow server load)
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      if (!_playing || currentSessionId !== _sessionId) return false;
      if (checkMatch()) {
        await waitForDOMStable(600);
        return true;
      }
    }

    // 3. Still mismatched. Check if it's an "unresolvable" identity mismatch.
    // (Target needs an ID parameter that the current session doesn't have yet).
    const t = new URL(stepUrl);
    const c = new URL(location.href);
    const missingId = IDENTITY_PARAMS.some(key => t.searchParams.has(key) && !c.searchParams.has(key));

    if (missingId) {
      notify('Waiting for the app to finish loading...', 'info');
      let waited = 0;
      // Pause indefinitely (up to 2 mins) until the app generates the new URL with the ID
      while (_playing && currentSessionId === _sessionId) {
        await sleep(500);
        waited += 500;
        if (checkMatch()) {
          notify('App ready. Resuming guide...', 'success');
          await waitForDOMStable(1000);
          return true;
        }
        if (waited > 120_000) {
          notify('Guide paused. Re-open the extension when the app is ready.', 'warning');
          stop();
          return false;
        }
      }
      return false;
    }

    // 4. Resolvable mismatch. Safe to force navigate.
    try {
      const stepOrigin = new URL(stepUrl).origin;

      if (stepOrigin === location.origin) {
        // Same origin, different path — navigate in this tab.
        chrome.storage.local.set({ [GUIDE_PLAY_KEY]: { guide, stepIndex } });
        window.location.href = stepUrl;
        return false;
      }

      // Different origin — ask background to switch / open the right tab.
      chrome.storage.local.set({ [GUIDE_PLAY_KEY]: { guide, stepIndex } });
      chrome.runtime.sendMessage({ action: 'activateTabForGuide', url: stepUrl, guide, stepIndex });
      _playing = false;
      window.opheliaTutorialActive = false;
      _stopDistractionMonitor();
      window.OpheliaOverlay.hide();
      return false;

    } catch (_) {
      // Malformed URL — skip the check and proceed
      return true;
    }
  }

  // ── Element re-identification ─────────────────────────────────────────────
  // Adapts a CreatorLayer fingerprint to findElement format, then falls back
  // to XPath, CSS selector, elementFromPoint, and Computer Use API.

  function _reidentifyElement(step) {
    const fp = step.fingerprint;
    if (!fp) return null;

    const isExcluded = (el) => {
      if (!step.excludedElements?.length) return false;
      return step.excludedElements.some(ex => {
        if (ex.xpath) {
          try {
            const res = document.evaluate(ex.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (res.singleNodeValue === el) return true;
          } catch (_) {}
        }
        return false;
      });
    };

    // Tier 0: semantic finder (8-tier text/aria/scored matching)
    const el0 = findElement({
      tag:          fp.tag,
      aria_label:   fp.aria_label,
      data_testid:  fp.data_testid,
      text_content: fp.text_content,
      label:        fp.aria_label || fp.text_content?.substring(0, 80) || fp.tag,
      selector:     fp.selector,
      id:           null,
      role:         fp.role,
      pos:          fp.position ? { x: fp.position.x, y: fp.position.y } : null
    });
    if (el0 && !isExcluded(el0)) return el0;

    // Tier 1: XPath
    if (fp.xpath) {
      try {
        const res = document.evaluate(fp.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el  = res.singleNodeValue;
        if (el && el !== document.body && !isExcluded(el)) return el;
      } catch (_) {}
    }

    // Tier 1b: CSS selector
    if (fp.selector) {
      try {
        const el = document.querySelector(fp.selector);
        if (el && el !== document.body && !isExcluded(el)) return el;
      } catch (_) {}
    }

    // Tier 2: elementFromPoint using stored point
    if (step.point) {
      const dpr = window.devicePixelRatio || 1;
      const el  = document.elementFromPoint(Math.round(step.point.x / dpr), Math.round(step.point.y / dpr));
      if (el && el !== document.body && el !== document.documentElement && !isExcluded(el)) return el;
    }

    return null;
  }

  // ── Text-to-Speech ────────────────────────────────────────────────────────

  let _currentAudio = null;

  async function speak(text) {
    if (!text) return;
    stopSpeaking();
    const clean = text.replace(/\[POINT:[^\]]+\]/g, '').trim();
    if (!clean) return;
    try {
      const res = await fetch(`${WORKER_BASE}/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: clean })
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      _currentAudio = audio;
      await audio.play();
    } catch (err) {
      console.warn('Ophelia player TTS fallback:', err?.message || err);
      _speakFallback(clean);
    }
  }

  function _speakFallback(text) {
    if (!window.speechSynthesis) return;
    const utt  = new SpeechSynthesisUtterance(text);
    utt.rate   = 1.05;
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    const doSpeak = () => {
      const voices    = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha'))
      ) || voices.find(v => v.lang.startsWith('en'));
      if (preferred) utt.voice = preferred;
      window.speechSynthesis.speak(utt);
    };
    if (window.speechSynthesis.getVoices().length > 0) doSpeak();
    else window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); };
  }

  function stopSpeaking() {
    if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Element finder (8 tiers) ─────────────────────────────────────────────

  function findElement(d) {
    if (!d) return null;
    const tag   = d.tag   || '*';
    const label = (d.label        || '').trim().toLowerCase();
    const text  = (d.text_content || d.label || '').trim().toLowerCase();

    // T1: aria-label exact
    if (d.aria_label) {
      const el = document.querySelector(`[aria-label="${d.aria_label}"]`);
      if (el && visible(el)) { log('T1 aria-label exact'); return el; }

      const needle  = d.aria_label.toLowerCase();
      const allAria = [...document.querySelectorAll('[aria-label]')];

      const ciExact = allAria.find(e => visible(e) && e.getAttribute('aria-label').toLowerCase() === needle);
      if (ciExact) { log('T1b aria-label case-insensitive'); return ciExact; }

      const partial = allAria.find(e => {
        if (!visible(e)) return false;
        const val = e.getAttribute('aria-label').toLowerCase();
        return val.includes(needle) || needle.includes(val);
      });
      if (partial) { log('T1c aria-label partial'); return partial; }
    }

    // T2: data-testid
    if (d.data_testid) {
      const el = document.querySelector(`[data-testid="${d.data_testid}"]`);
      if (el && visible(el)) { log('T2 data-testid'); return el; }
    }

    // T3: anchored CSS selector + label check
    if (d.selector && (d.selector.includes('#') || d.selector.includes('[data-testid'))) {
      try {
        const el = document.querySelector(d.selector);
        if (el && visible(el) && labelMatches(el, text)) { log('T3 anchored selector'); return el; }
      } catch (_) {}
    }

    // T4: exact text + tag
    if (text && tag !== '*') {
      const candidates = [...document.querySelectorAll(tag)].filter(visible);
      const exact  = candidates.find(e => cleanText(e) === text);
      if (exact)  { log('T4 text+tag exact'); return exact; }
      const starts = candidates.find(e => cleanText(e).startsWith(text));
      if (starts) { log('T4 text+tag starts-with'); return starts; }
    }

    // T5: text across interactive elements
    if (text) {
      const INTERACTIVE = 'a,button,input,[role="menuitem"],[role="option"],[role="tab"],[role="button"],[role="link"],li,span';
      const all = [...document.querySelectorAll(INTERACTIVE)].filter(visible);
      const exact  = all.find(e => cleanText(e) === text);
      if (exact)  { log('T5 interactive text exact'); return exact; }
      const starts = all.find(e => cleanText(e).startsWith(text) && cleanText(e).length < text.length + 30);
      if (starts) { log('T5 interactive text starts-with'); return starts; }
    }

    // T6: scored matching
    {
      const INTERACTIVE = 'a,button,input,select,textarea,[role="menuitem"],[role="option"],[role="tab"],[role="button"],[role="link"],li';
      let best = null, bestScore = 0;
      for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!visible(el)) continue;
        const s = score(el, d, text, label, tag);
        if (s > bestScore) { bestScore = s; best = el; }
      }
      if (best && bestScore >= 2) { log(`T6 scored (${bestScore}pts)`); return best; }
    }

    // T7: generic CSS selector fallback
    if (d.selector) {
      try {
        const el = document.querySelector(d.selector);
        if (el && visible(el)) { log('T7 generic selector fallback'); return el; }
      } catch (_) {}
    }

    // T8: spatial (100px radius)
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
    if (el.tagName.toLowerCase() === tag)                                     s += 1;
    if (d.aria_label  && el.getAttribute('aria-label')  === d.aria_label)    s += 5;
    if (d.data_testid && el.getAttribute('data-testid') === d.data_testid)   s += 5;
    if (d.id          && el.id === d.id)                                      s += 4;
    if (d.role        && el.getAttribute('role') === d.role)                  s += 1;
    const et = cleanText(el);
    if (text && et === text)            s += 4;
    else if (text && et.startsWith(text)) s += 2;
    else if (label && et.includes(label)) s += 1;
    const elAria = (el.getAttribute('aria-label') || '').toLowerCase();
    const dAria  = (d.aria_label || '').toLowerCase();
    if (dAria && (elAria.includes(dAria) || dAria.includes(elAria))) s += 3;
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

  // ── Interaction & timing helpers ──────────────────────────────────────────

  function waitForInteraction(step, targetEl) {
    return new Promise((resolve) => {
      const startUrl = window.location.href;
      let done = false;
      const action = step?.action || 'click';

      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener('click', onClick, true);
        if (targetEl) {
          targetEl.removeEventListener('input', onTypeCheck, true);
          targetEl.removeEventListener('change', onTypeCheck, true);
          targetEl.removeEventListener('blur', onTypeCheck, true);
          targetEl.removeEventListener('mouseover', onHover, true);
        }
        clearInterval(navPoll);
        resolve();
      };

      // URL Navigation is an instant pass for any step type
      const navPoll = setInterval(() => {
        if (window.location.href !== startUrl) {
          _visitedDomains.add(location.hostname);
          finish();
        }
      }, 200);

      const onClick = (e) => {
        if (window.opheliaCorrectionMode) return;
        if (window.opheliaHelperActive) return;
        if (document.getElementById('ophelia-distraction-prompt')) return;
        
        // If the action is specifically 'type' or 'hover', a click on the target element shouldn't advance the guide prematurely
        if ((action === 'type' || action === 'hover') && targetEl && (e.target === targetEl || targetEl.contains(e.target))) {
            return; // Wait for the actual type/hover event
        }
        
        // Otherwise, any general click (fallback) advances
        finish();
      };
      
      const onTypeCheck = (e) => {
          if (step.textValue && targetEl) {
              // Wait until they've at least typed something similar, or if they blur
              if (e.type === 'blur' || (targetEl.value && targetEl.value.length >= Math.min(3, step.textValue.length))) {
                  finish();
              }
          } else {
              finish(); // No required text, just advance on input
          }
      };

      const onHover = (e) => {
          // Add a tiny delay to ensure it wasn't a fleeting mouse pass
          setTimeout(() => {
              if (targetEl && targetEl.matches(':hover')) finish();
          }, 400);
      };

      document.addEventListener('click', onClick, true);

      if (action === 'type' && targetEl) {
          targetEl.addEventListener('input', onTypeCheck, true);
          targetEl.addEventListener('change', onTypeCheck, true);
          targetEl.addEventListener('blur', onTypeCheck, true);
      } else if (action === 'hover' && targetEl) {
          targetEl.addEventListener('mouseover', onHover, true);
      }
    });
  }

  function waitForDOMStable(quietMs = 500) {
    return new Promise((resolve) => {
      let t = null;
      let obs = null;

      const isBubbleLoading = () => {
        // Detect Bubble's loading overlays/masks only if they are actually visible
        const loaders = document.querySelectorAll('.loading-mask, .bubble-loading-spinner, .pulse-loader, #loading-mask');
        for (const el of loaders) {
          if (visible(el)) return true;
        }
        // Also check for the high-z-index gray-out div often used by Bubble
        const grayOut = document.querySelector('div[style*="z-index: 1000001"]');
        if (grayOut && visible(grayOut)) return true;
        return false;
      };

      const finish = () => {
        if (obs) { obs.disconnect(); obs = null; }
        clearTimeout(t);
        resolve();
      };

      const check = () => {
        if (isBubbleLoading()) {
          t = setTimeout(check, 500); 
          return;
        }
        finish();
      };

      obs = new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(check, quietMs);
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: false });
      t = setTimeout(check, quietMs);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function notify(msg, type) {
    if (typeof window.OpheliaNotify === 'function') window.OpheliaNotify(msg, type);
    else console.log(`[Player][${type}] ${msg}`);
  }

  // ── Distraction detection ─────────────────────────────────────────────────

  function _startDistractionMonitor(guide) {
    _stopDistractionMonitor();
    _distractionTimer = setInterval(() => {
      if (!_playing) { _stopDistractionMonitor(); return; }
      if (_distractionFired) return;
      if (Date.now() - _lastStepTs > 120_000) {
        _distractionFired = true;
        _promptPauseOrContinue(guide);
      }
    }, 30_000);
  }

  function _stopDistractionMonitor() {
    if (_distractionTimer) { clearInterval(_distractionTimer); _distractionTimer = null; }
  }

  function _promptPauseOrContinue(guide) {
    document.getElementById('ophelia-distraction-prompt')?.remove();
    speak("Looks like you wandered off \u2014 want to pause the guide or jump back in?");

    const wrap = document.createElement('div');
    wrap.id = 'ophelia-distraction-prompt';
    wrap.style.cssText = 'position:fixed;top:16px;right:16px;background:#1a1a1a;border:1.5px solid rgba(255,122,26,0.5);border-radius:10px;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;padding:14px 16px;z-index:2147483644;max-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

    const msg = document.createElement('div');
    msg.textContent = `Still with you? Step ${_activeStepIndex + 1}\u202f/\u202f${guide.steps.length} of \u201c${guide.name || 'your guide'}\u201d`;
    msg.style.cssText = 'color:#ccc;margin-bottom:12px;line-height:1.4;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const continueBtn = document.createElement('button');
    continueBtn.textContent = 'Jump back in';
    continueBtn.style.cssText = 'flex:1;background:#ff7a1a;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer;';

    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause';
    pauseBtn.style.cssText = 'background:#222;color:#aaa;border:1px solid #333;border-radius:6px;padding:7px 10px;font-size:12px;cursor:pointer;';

    const dismiss = () => { wrap.remove(); _distractionFired = false; };
    const autoTimer = setTimeout(dismiss, 30_000);

    continueBtn.onclick = (e) => {
      e.stopPropagation();
      clearTimeout(autoTimer);
      dismiss();
    };
    pauseBtn.onclick = (e) => {
      e.stopPropagation();
      clearTimeout(autoTimer);
      wrap.remove();
      chrome.storage.local.set({ [GUIDE_PLAY_KEY]: { guide, stepIndex: _activeStepIndex } });
      stop();
      notify('Guide paused \u2014 reopen the popup to resume.', 'info');
    };

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(pauseBtn);
    wrap.appendChild(msg);
    wrap.appendChild(btnRow);
    document.body.appendChild(wrap);
  }

  function getState() {
    return { guide: _activeGuide, stepIndex: _activeStepIndex, playing: _playing };
  }

  // ── Auto-check on every page load ────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForPending);
  } else {
    checkForPending();
  }

  return { startGuide, stop, findElement, checkForPending, getState };
})();

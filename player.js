// Ophelia Player - Guided tutorial playback with 5-tier element finding and DOM stability detection
window.OpheliaPlayer = (() => {
  const PLAY_KEY  = 'opheliaTutorial';
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
        chrome.storage.local.set({ [PLAY_KEY]: { steps, stepIndex: 0 } });
        chrome.runtime.sendMessage({ action: 'navigate', url: startUrl });
        return;
      }

      await play(steps, 0);

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
        waitForDOMStable(800).then(() => play(pending.steps, pending.stepIndex));
      }
    });
  }

  // ── Main playback loop ────────────────────────────────────────────────────

  async function play(steps, startIndex = 0) {
    _playing = true;
    window.opheliaTutorialActive = true; // Tells content.js to stop sphere mouse-following

    for (let i = startIndex; i < steps.length; i++) {
      if (!_playing) break;

      const step        = steps[i];
      const elData      = step.element || step.dom_element || step;
      const instruction = step.instruction || step.raw_instruction || `Step ${i + 1}`;

      console.log(`▶️  Step ${i + 1}/${steps.length}: ${instruction}`);
      notify(`Step ${i + 1} of ${steps.length}`, 'info');

      // Let the DOM settle before searching
      await waitForDOMStable(600);

      // Find element — up to 3 attempts with 1.5s between each
      let el = null;
      for (let attempt = 0; attempt < 3 && !el; attempt++) {
        el = findElement(elData);
        if (!el && attempt < 2) {
          console.log(`   ↳ Attempt ${attempt + 1} failed, retrying…`);
          await sleep(1500);
        }
      }

      if (!el) {
        console.warn(`⚠️  Step ${i + 1}: element not found after 3 attempts`);
        notify(
          `Step ${i + 1}: Couldn't find the element. Please do this manually:\n"${instruction}"`,
          'error'
        );
        // Show card without highlight, wait for ANY click before continuing
        window.OpheliaOverlay.show({ stepNumber: i + 1, totalSteps: steps.length, instruction, element: null });
        await waitForAnyClick();
        window.OpheliaOverlay.hide();
        continue;
      }

      // Scroll into view smoothly, then show overlay
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);

      window.OpheliaOverlay.show({ stepNumber: i + 1, totalSteps: steps.length, instruction, element: el });

      // Wait for user to click somewhere — detect if page navigated
      const navigated = await waitForInteraction();
      window.OpheliaOverlay.hide();

      console.log(`✅  Step ${i + 1} complete (navigated: ${navigated})`);

      if (navigated) {
        const next = i + 1;
        if (next < steps.length) {
          // Persist remaining steps so the new page picks them up
          chrome.storage.local.set({ [PLAY_KEY]: { steps, stepIndex: next } });
        }
        return; // Stop here — new page's content script will resume
      }
    }

    // All steps complete
    _playing = false;
    window.opheliaTutorialActive = false;
    window.OpheliaOverlay.hide();
    notify('Tutorial complete! 🎉', 'success');
    console.log('🏁 Tutorial complete');
  }

  function stop() {
    _playing = false;
    window.opheliaTutorialActive = false;
    window.OpheliaOverlay.hide();
    chrome.storage.local.remove(PLAY_KEY);
    notify('Tutorial stopped.', 'info');
  }

  // ── 5-Tier element finder ────────────────────────────────────────────────
  // T1: CSS selector path (most precise, recorded at capture time)
  // T2: aria-label exact → partial (most stable on React/SPA)
  // T3: data-testid
  // T4: XPath text match in interactive tags
  // T5: Spatial match within 100px

  function findElement(d) {
    if (!d) return null;

    // T1 — CSS selector path
    if (d.selector) {
      try {
        const el = document.querySelector(d.selector);
        if (el && visible(el)) { console.log('  ✅ T1 selector'); return el; }
      } catch (_) { /* invalid selector */ }
      console.log('  ⏭️  T1 selector: no match');
    }

    // T2 — aria-label (exact, then partial)
    if (d.aria_label) {
      const exact = document.querySelector(`[aria-label="${d.aria_label}"]`);
      if (exact && visible(exact)) { console.log('  ✅ T2 aria-label exact'); return exact; }

      const partial = [...document.querySelectorAll('[aria-label]')].find(el =>
        el.getAttribute('aria-label').toLowerCase().includes(d.aria_label.toLowerCase()) && visible(el)
      );
      if (partial) { console.log('  ✅ T2 aria-label partial'); return partial; }
      console.log('  ⏭️  T2 aria-label: no match');
    }

    // T3 — data-testid
    if (d.data_testid) {
      const el = document.querySelector(`[data-testid="${d.data_testid}"]`);
      if (el && visible(el)) { console.log('  ✅ T3 data-testid'); return el; }
      console.log('  ⏭️  T3 data-testid: no match');
    }

    // T4 — XPath text match in interactive tags
    if (d.label) {
      const lc = d.label.toLowerCase().replace(/'/g, "\\'");
      for (const tag of ['button', 'a', 'input', 'span', 'div']) {
        try {
          const xp  = `//${tag}[normalize-space(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))='${lc}']`;
          const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const el  = res.singleNodeValue;
          if (el && visible(el)) { console.log(`  ✅ T4 XPath <${tag}>`); return el; }
        } catch (_) { /* bad xpath */ }
      }
      console.log('  ⏭️  T4 XPath: no match');
    }

    // T5 — Spatial (100px radius)
    if (d.pos && d.tag) {
      for (const el of document.getElementsByTagName(d.tag)) {
        if (!visible(el)) continue;
        const r  = el.getBoundingClientRect();
        const cx = r.left + r.width  / 2;
        const cy = r.top  + r.height / 2;
        if (Math.abs(cx - d.pos.x) < 100 && Math.abs(cy - d.pos.y) < 100) {
          console.log('  ✅ T5 spatial match');
          return el;
        }
      }
      console.log('  ⏭️  T5 spatial: no match');
    }

    return null;
  }

  function visible(el) {
    const r  = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' &&
           cs.visibility !== 'hidden' &&
           parseFloat(cs.opacity) > 0 &&
           r.width > 0 && r.height > 0;
  }

  // ── Interaction & timing helpers ────────────────────────────────────────

  function waitForInteraction() {
    return new Promise((resolve) => {
      const startUrl = window.location.href;
      let done = false;

      const finish = (navigated) => {
        if (done) return;
        done = true;
        document.removeEventListener('click', onClick, true);
        clearInterval(navPoll);
        resolve(navigated);
      };

      // Any document click counts as the user completing the step
      const onClick = () => setTimeout(() => finish(window.location.href !== startUrl), 300);
      // Poll for URL changes (programmatic navigation)
      const navPoll = setInterval(() => { if (window.location.href !== startUrl) finish(true); }, 300);

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

  return { loadAndStart, checkForPending, stop };
})();

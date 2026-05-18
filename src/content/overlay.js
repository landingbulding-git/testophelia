// Ophelia Overlay - Tutorial UI: instruction card, progress, pulsing dot, target highlight
window.OpheliaOverlay = (() => {
  const STYLE_ID = 'ophelia-overlay-css';
  let _currentTarget      = null;
  let _currentInstruction = '';
  let _onCorrect          = null;
  let _corrMouseHandler   = null;
  let _corrClickHandler   = null;
  let _corrHovered        = null;

  // ── Styles ────────────────────────────────────────────────────────────────

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #ophelia-card {
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(16, 16, 16, 0.97);
        border: 1.5px solid #ff7a1a;
        border-radius: 14px;
        padding: 14px 20px;
        min-width: 300px;
        max-width: 460px;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 2147483646;
        pointer-events: none;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,122,26,0.15);
        animation: opheliaCardIn 0.25s ease-out;
      }
      @keyframes opheliaCardIn {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      #ophelia-step-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #ff7a1a;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #ophelia-correct-btn {
        pointer-events: auto;
        cursor: pointer;
        background: transparent;
        border: 1px solid rgba(255,122,26,0.45);
        border-radius: 5px;
        color: #ff7a1a;
        font-size: 10px;
        font-family: inherit;
        padding: 1px 7px;
        margin-left: auto;
        opacity: 0.7;
        transition: opacity 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      #ophelia-correct-btn:hover { opacity: 1; background: rgba(255,122,26,0.15); }
      #ophelia-correct-btn.active {
        opacity: 1;
        background: rgba(255,122,26,0.2);
        border-color: #ff7a1a;
      }
      #ophelia-instruction-text {
        font-size: 14px;
        line-height: 1.6;
        color: #f0f0f0;
        margin-bottom: 12px;
      }
      #ophelia-progress-track {
        height: 3px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        overflow: hidden;
      }
      #ophelia-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #ff7a1a, #ff4500);
        border-radius: 2px;
        transition: width 0.4s ease;
      }
      #ophelia-dot {
        position: fixed;
        width: 18px;
        height: 18px;
        background: #ff7a1a;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        z-index: 2147483647;
        pointer-events: none;
        animation: opheliaDotPulse 1.2s ease-in-out infinite;
        transition: left 0.35s cubic-bezier(0.4,0,0.2,1), top 0.35s cubic-bezier(0.4,0,0.2,1);
      }
      @keyframes opheliaDotPulse {
        0%   { box-shadow: 0 0 0 0    rgba(255,122,26,0.6); }
        70%  { box-shadow: 0 0 0 14px rgba(255,122,26,0); }
        100% { box-shadow: 0 0 0 0    rgba(255,122,26,0); }
      }
      .ophelia-target {
        outline: 3px solid #ff7a1a !important;
        outline-offset: 4px !important;
        border-radius: 4px !important;
        animation: opheliaTargetGlow 1.2s ease-in-out infinite !important;
        position: relative !important;
        z-index: 2147483645 !important;
      }
      @keyframes opheliaTargetGlow {
        0%, 100% { box-shadow: 0 0 0  0    rgba(255,122,26,0.4); }
        50%      { box-shadow: 0 0 14px 4px rgba(255,122,26,0.25); }
      }
      .ophelia-correct-hover {
        outline: 2px dashed #ff7a1a !important;
        outline-offset: 3px !important;
        cursor: crosshair !important;
      }

      /* --- Recording Confirmation --- */
      #ophelia-confirm-pill {
        position: fixed;
        background: rgba(16, 16, 16, 0.95);
        border: 1.5px solid #ff7a1a;
        border-radius: 20px;
        padding: 6px 8px;
        display: flex;
        gap: 8px;
        z-index: 2147483647;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        pointer-events: auto;
        animation: opheliaPillIn 0.2s ease-out;
      }
      @keyframes opheliaPillIn {
        from { opacity: 0; transform: scale(0.9); }
        to   { opacity: 1; transform: scale(1); }
      }
      .ophelia-pill-btn {
        border: none;
        border-radius: 14px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: filter 0.15s;
      }
      .ophelia-pill-btn:hover { filter: brightness(1.2); }
      .ophelia-btn-accept { background: #22c55e; color: #fff; }
      .ophelia-btn-edit   { background: #f59e0b; color: #fff; }
      .ophelia-captured {
        outline: 3px solid #ff7a1a !important;
        outline-offset: 4px !important;
        border-radius: 4px !important;
        box-shadow: 0 0 15px rgba(255,122,26,0.5) !important;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function show({ stepNumber, totalSteps, instruction, element, onCorrect }) {
    ensureStyles();
    hide();

    _currentInstruction = instruction;
    _onCorrect = onCorrect || null;

    const pct  = Math.round((stepNumber / totalSteps) * 100);
    const card = document.createElement('div');
    card.id    = 'ophelia-card';
    card.innerHTML =
      `<div id="ophelia-step-label">` +
        `<span>Step ${stepNumber} of ${totalSteps}</span>` +
        (onCorrect ? `<button id="ophelia-correct-btn" title="Drag the pointer to the right element">✏️ Correct</button>` : '') +
      `</div>` +
      `<div id="ophelia-instruction-text">${esc(instruction)}</div>` +
      `<div id="ophelia-progress-track"><div id="ophelia-progress-fill" style="width:${pct}%"></div></div>`;
    document.body.appendChild(card);

    const dot = document.createElement('div');
    dot.id = 'ophelia-dot';
    document.body.appendChild(dot);

    if (element) pinTo(element);

    // Wire correction button
    const btn = document.getElementById('ophelia-correct-btn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (window.opheliaCorrectionMode) {
          _exitCorrectionMode(false); // cancel
        } else {
          _enterCorrectionMode();
        }
      });
    }
  }

  /**
   * Shows an 'Accept/Edit' pill near a captured element during recording.
   * Phase 1: Active Recording Foundation.
   * Updated: Supports Enter (Accept) and Esc (Edit) keys.
   */
  function showRecordingConfirm(element, onAccept, onEdit) {
    ensureStyles();
    hide();

    _currentTarget = element;
    element.classList.add('ophelia-captured');

    const pill = document.createElement('div');
    pill.id = 'ophelia-confirm-pill';
    pill.innerHTML = `
      <div style="color:#888;font-size:9px;margin-bottom:4px;text-align:center;width:100%;">[Enter] Accept  |  [Esc] Edit</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="ophelia-pill-btn ophelia-btn-accept">Accept</button>
        <button class="ophelia-pill-btn ophelia-btn-edit">Edit</button>
      </div>
    `;
    document.body.appendChild(pill);

    // Position pill
    const r = element.getBoundingClientRect();
    const pillR = pill.getBoundingClientRect();
    let top = r.top - pillR.height - 12;
    if (top < 10) top = r.bottom + 12; // flip to bottom if no space above
    
    pill.style.top = `${top}px`;
    pill.style.left = `${Math.max(10, r.left + (r.width/2) - (pillR.width/2))}px`;

    const handleKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        onAccept();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        onEdit();
      }
    };

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey, true);
      hide();
    };

    pill.querySelector('.ophelia-btn-accept').onclick = (e) => {
      e.stopPropagation();
      cleanup();
      onAccept();
    };
    pill.querySelector('.ophelia-btn-edit').onclick = (e) => {
      e.stopPropagation();
      cleanup();
      onEdit();
    };

    document.addEventListener('keydown', handleKey, true);
  }

  function pinTo(element) {
    if (_currentTarget) {
      _currentTarget.classList.remove('ophelia-target');
      _currentTarget.classList.remove('ophelia-captured');
    }
    _currentTarget = element;
    element.classList.add('ophelia-target');
    _moveDot(element);
  }

  function hide() {
    _exitCorrectionMode(false);
    document.getElementById('ophelia-card')?.remove();
    document.getElementById('ophelia-dot')?.remove();
    document.getElementById('ophelia-confirm-pill')?.remove();
    if (_currentTarget) {
      _currentTarget.classList.remove('ophelia-target');
      _currentTarget.classList.remove('ophelia-captured');
      _currentTarget = null;
    }
  }

  // ── Correction mode ───────────────────────────────────────────────────────

  function _enterCorrectionMode() {
    window.opheliaCorrectionMode = true;

    const instrEl = document.getElementById('ophelia-instruction-text');
    const btn     = document.getElementById('ophelia-correct-btn');
    if (instrEl) instrEl.innerHTML = '<span style="color:#ffa06a">👆 Click the correct element on the page…</span>';
    if (btn)     { btn.textContent = '✕ Cancel'; btn.classList.add('active'); }

    // Temporarily remove the glow so user can see what they're hovering
    if (_currentTarget) _currentTarget.classList.remove('ophelia-target');

    _corrMouseHandler = (e) => {
      const el = e.target;
      if (el.closest('#ophelia-card') || el.closest('#ophelia-dot')) return;
      if (_corrHovered && _corrHovered !== el) _corrHovered.classList.remove('ophelia-correct-hover');
      el.classList.add('ophelia-correct-hover');
      _corrHovered = el;
    };

    _corrClickHandler = (e) => {
      const el = e.target;
      // Cancel button click
      if (el.id === 'ophelia-correct-btn') return;
      // Clicks on our own UI — ignore
      if (el.closest('#ophelia-card') || el.closest('#ophelia-dot')) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (_corrHovered) _corrHovered.classList.remove('ophelia-correct-hover');
      _corrHovered = null;

      _exitCorrectionMode(true, el);
    };

    document.addEventListener('mouseover', _corrMouseHandler, true);
    document.addEventListener('click',     _corrClickHandler, true);
  }

  function _exitCorrectionMode(accepted, correctedEl) {
    if (!window.opheliaCorrectionMode && !_corrMouseHandler) return;
    window.opheliaCorrectionMode = false;

    if (_corrMouseHandler) { document.removeEventListener('mouseover', _corrMouseHandler, true); _corrMouseHandler = null; }
    if (_corrClickHandler) { document.removeEventListener('click',     _corrClickHandler, true); _corrClickHandler = null; }
    if (_corrHovered)      { _corrHovered.classList.remove('ophelia-correct-hover'); _corrHovered = null; }

    const instrEl = document.getElementById('ophelia-instruction-text');
    const btn     = document.getElementById('ophelia-correct-btn');

    if (accepted && correctedEl) {
      // Re-pin dot to new element
      pinTo(correctedEl);
      if (instrEl) instrEl.innerHTML = esc(_currentInstruction);
      if (btn)     { btn.textContent = '✏️ Correct'; btn.classList.remove('active'); }
      // Notify player
      if (_onCorrect) _onCorrect(correctedEl);
    } else {
      // Cancelled — restore original highlight
      if (_currentTarget) _currentTarget.classList.add('ophelia-target');
      if (instrEl) instrEl.innerHTML = esc(_currentInstruction);
      if (btn)     { btn.textContent = '✏️ Correct'; btn.classList.remove('active'); }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _moveDot(element) {
    const dot = document.getElementById('ophelia-dot');
    if (!dot || !element) return;
    const r = element.getBoundingClientRect();
    dot.style.left = `${r.left + r.width  / 2}px`;
    dot.style.top  = `${r.top  + r.height / 2}px`;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { show, hide, pinTo, showRecordingConfirm };
})();

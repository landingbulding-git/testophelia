// Ophelia Overlay - Tutorial UI: instruction card, progress, pulsing dot, target highlight
window.OpheliaOverlay = (() => {
  const STYLE_ID = 'ophelia-overlay-css';
  let _currentTarget = null;

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
        0%   { box-shadow: 0 0 0 0   rgba(255,122,26,0.6); }
        70%  { box-shadow: 0 0 0 14px rgba(255,122,26,0); }
        100% { box-shadow: 0 0 0 0   rgba(255,122,26,0); }
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
        0%, 100% { box-shadow: 0 0 0  0   rgba(255,122,26,0.4); }
        50%       { box-shadow: 0 0 14px 4px rgba(255,122,26,0.25); }
      }
    `;
    document.head.appendChild(s);
  }

  function show({ stepNumber, totalSteps, instruction, element }) {
    ensureStyles();
    hide();

    const pct = Math.round((stepNumber / totalSteps) * 100);

    const card = document.createElement('div');
    card.id = 'ophelia-card';
    card.innerHTML =
      `<div id="ophelia-step-label">Step ${stepNumber} of ${totalSteps}</div>` +
      `<div id="ophelia-instruction-text">${esc(instruction)}</div>` +
      `<div id="ophelia-progress-track"><div id="ophelia-progress-fill" style="width:${pct}%"></div></div>`;
    document.body.appendChild(card);

    const dot = document.createElement('div');
    dot.id = 'ophelia-dot';
    document.body.appendChild(dot);

    if (element) pinTo(element);
  }

  function pinTo(element) {
    if (_currentTarget) _currentTarget.classList.remove('ophelia-target');
    _currentTarget = element;
    element.classList.add('ophelia-target');
    _moveDot(element);
  }

  function _moveDot(element) {
    const dot = document.getElementById('ophelia-dot');
    if (!dot || !element) return;
    const r = element.getBoundingClientRect();
    dot.style.left = `${r.left + r.width  / 2}px`;
    dot.style.top  = `${r.top  + r.height / 2}px`;
  }

  function hide() {
    document.getElementById('ophelia-card')?.remove();
    document.getElementById('ophelia-dot')?.remove();
    if (_currentTarget) {
      _currentTarget.classList.remove('ophelia-target');
      _currentTarget = null;
    }
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { show, hide, pinTo };
})();

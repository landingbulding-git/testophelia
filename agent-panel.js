// Ophelia Agent Panel — persistent bottom-bar UI for the live agent
// Shows goal, current instruction, step count, and action buttons.
window.OpheliaAgentPanel = (() => {
  const PANEL_ID    = 'ophelia-agent-panel';
  const ASK_ROW_ID  = 'ophelia-ap-ask-row';
  const STYLE_ID    = 'ophelia-ap-style';

  let _onSkip = null;
  let _onStop = null;
  let _onAsk  = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  function show({ goal, instruction, onSkip, onStop, onAsk }) {
    _onSkip = onSkip;
    _onStop = onStop;
    _onAsk  = onAsk;

    _injectStyles();

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = _buildPanel();
      document.body.appendChild(panel);
      _buildAskRow();
    }

    _set('ophelia-ap-goal',        goal        || '');
    _setInstruction(instruction    || '');
  }

  function setStatus(text) { _set('ophelia-ap-status', text || ''); }

  function setInstruction(text) { _setInstruction(text); }

  function hide() {
    document.getElementById(PANEL_ID)   ?.remove();
    document.getElementById(ASK_ROW_ID) ?.remove();
    document.getElementById(STYLE_ID)   ?.remove();
  }

  // ── Build DOM ───────────────────────────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #ophelia-agent-panel {
        animation: opheliaSlideUp 0.28s cubic-bezier(0.22,1,0.36,1);
      }
      @keyframes opheliaSlideUp {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);   opacity: 1; }
      }
      #ophelia-agent-panel button:hover { filter: brightness(1.2); }
      .ophelia-agent-highlight {
        outline: 3px solid #4285f4 !important;
        outline-offset: 3px !important;
        border-radius: 4px !important;
        animation: opheliaAgentPulse 1.6s ease-in-out infinite !important;
        position: relative !important;
        z-index: 999998 !important;
      }
      @keyframes opheliaAgentPulse {
        0%,100% { outline-color:#4285f4; box-shadow:0 0 0 0 rgba(66,133,244,0.5); }
        50%     { outline-color:#66a3ff; box-shadow:0 0 0 10px rgba(66,133,244,0); }
      }
    `;
    document.head.appendChild(s);
  }

  function _buildPanel() {
    const p = document.createElement('div');
    p.id = PANEL_ID;
    p.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:2147483647',
      'background:rgba(9,9,13,0.97)',
      'border-top:1.5px solid rgba(66,133,244,0.45)',
      'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
      'padding:10px 20px 12px',
      'display:flex', 'align-items:center', 'gap:14px',
      'box-shadow:0 -6px 28px rgba(0,0,0,0.55)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');

    p.innerHTML = `
      <div style="flex-shrink:0;padding-right:4px">
        <div style="font-size:9px;font-weight:800;letter-spacing:.14em;color:#4285f4;
                    text-transform:uppercase;margin-bottom:2px">🤖 Ophelia</div>
        <div id="ophelia-ap-goal"
             style="font-size:11px;color:#666;max-width:180px;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <div style="width:1px;height:38px;background:rgba(255,255,255,0.08);flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div id="ophelia-ap-instruction"
             style="font-size:15px;font-weight:500;color:#f0f0f0;line-height:1.35;
                    transition:opacity 0.18s ease"></div>
        <div id="ophelia-ap-status"
             style="font-size:11px;color:#555;margin-top:3px;min-height:14px"></div>
      </div>
      <div style="display:flex;gap:7px;flex-shrink:0;align-items:center">
        <button id="ophelia-ap-ask-btn"
          style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.13);
                 border-radius:7px;padding:7px 13px;cursor:pointer;color:#bbb;
                 font-size:12px;font-family:inherit">💬 Ask</button>
        <button id="ophelia-ap-skip-btn"
          style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.13);
                 border-radius:7px;padding:7px 13px;cursor:pointer;color:#bbb;
                 font-size:12px;font-family:inherit">⏭ Skip</button>
        <button id="ophelia-ap-stop-btn"
          style="background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.28);
                 border-radius:7px;padding:7px 13px;cursor:pointer;color:#ef5350;
                 font-size:12px;font-family:inherit">✕ Stop</button>
      </div>
    `;

    p.querySelector('#ophelia-ap-stop-btn').addEventListener('click', () => _onStop?.());
    p.querySelector('#ophelia-ap-skip-btn').addEventListener('click', () => _onSkip?.());
    p.querySelector('#ophelia-ap-ask-btn').addEventListener('click', () => {
      const row = document.getElementById(ASK_ROW_ID);
      if (!row) return;
      const visible = row.style.display !== 'none';
      row.style.display = visible ? 'none' : 'flex';
      if (!visible) document.getElementById('ophelia-ap-ask-input')?.focus();
    });

    return p;
  }

  function _buildAskRow() {
    const row = document.createElement('div');
    row.id = ASK_ROW_ID;
    row.style.cssText = [
      'display:none', 'position:fixed', 'bottom:58px', 'left:0', 'right:0',
      'z-index:2147483647',
      'background:rgba(12,12,18,0.98)',
      'border-top:1px solid rgba(66,133,244,0.25)',
      'padding:10px 20px', 'align-items:center', 'gap:8px'
    ].join(';');

    row.innerHTML = `
      <input id="ophelia-ap-ask-input" type="text"
        placeholder="Tell me something or ask a question…"
        style="flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.16);
               border-radius:7px;padding:9px 14px;color:#fff;font-size:13px;
               font-family:inherit;outline:none;min-width:0"/>
      <button id="ophelia-ap-ask-send"
        style="background:#4285f4;border:none;border-radius:7px;padding:9px 18px;
               cursor:pointer;color:#fff;font-size:13px;font-weight:600;
               font-family:inherit;flex-shrink:0">Send</button>
    `;
    document.body.appendChild(row);

    const send = () => {
      const inp = document.getElementById('ophelia-ap-ask-input');
      const txt = inp?.value?.trim();
      if (!txt) return;
      inp.value = '';
      row.style.display = 'none';
      _onAsk?.(txt);
    };

    row.querySelector('#ophelia-ap-ask-send').addEventListener('click', send);
    row.querySelector('#ophelia-ap-ask-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') send();
      if (e.key === 'Escape') { row.style.display = 'none'; }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _setInstruction(text) {
    const el = document.getElementById('ophelia-ap-instruction');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 160);
  }

  return { show, hide, setStatus, setInstruction };
})();

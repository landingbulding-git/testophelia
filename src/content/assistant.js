// Ophelia Assistant — AI co-pilot and guide creator.

window.OpheliaAssistant = (() => {
  // ── Constants ─────────────────────────────────────────────────────────────
  const WORKER_BASE  = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev';
  const _ttsRate     = 1.05;

  // ── State ─────────────────────────────────────────────────────────────────
  let _isActive       = false;
  let _isLearning     = false; // true while CreatorLayer is recording
  let _currentAudio   = null;

  // ── AI co-pilot state ─────────────────────────────────────────────────────
  let _messages       = [];
  let _stepCount      = 0;
  let _goal           = '';
  let _lastPageKey    = '';
  let _lastScreenshot = null;
  let _stepsSinceNav  = 0;
  let _micTeardown    = null;

  // ── Creator mode state ────────────────────────────────────────────────────
  let _isCreatorMode = false;
  let _guideSteps    = [];   // committed step objects surfaced after recording finishes
  let _creatorLayer  = null; // active CreatorLayer instance

  // ── Public API ────────────────────────────────────────────────────────────

  async function activate(fromShortcut = false) {
    if (_isActive || _isLearning) { stop(); return; }

    const guideState = window.OpheliaPlayer?.getState?.();
    if (guideState?.playing && guideState.guide) {
      _isActive = true;
      window.opheliaHelperActive = true;
      _startGuideMicSession(guideState.guide, guideState.stepIndex);
      return;
    }

    _isActive = true;
    _startFreeMicSession();
  }

  async function _startFreeMicSession() {
    _setDotLabel('🔴 Listening…');
    let autoStopTimer = null;
    await _startMic(
      (text) => {
        clearTimeout(autoStopTimer);
        if (!text) { _isActive = false; _clearDotLabel(); return; }
        _goal      = text;
        _messages  = [];
        _stepCount = 0;
        _setDotLabel('Thinking…');
        _analyze(text);
      },
      (text) => { _setDotLabel(`🔴 ${text.slice(-70)}`); },
      () => { clearTimeout(autoStopTimer); autoStopTimer = setTimeout(() => _micTeardown?.(), 700); }
    );
  }

  async function _startGuideMicSession(guide, stepIndex) {
    _setDotLabel('🔴 Listening…');
    let autoStopTimer = null;
    await _startMic(
      async (text) => {
        clearTimeout(autoStopTimer);
        if (!text) { _isActive = false; window.opheliaHelperActive = false; _clearDotLabel(); return; }
        _setDotLabel('Thinking…');
        const result = await _analyzeGuideQuestion(text, guide, stepIndex);
        _isActive = false;
        window.opheliaHelperActive = false;
        _clearDotLabel();
        if (result?.spokenText) {
          _showGuideAnswerCard(result.spokenText);
          await _speak(result.spokenText);
        }
      },
      (text) => { _setDotLabel(`🔴 ${text.slice(-70)}`); },
      () => { clearTimeout(autoStopTimer); autoStopTimer = setTimeout(() => _micTeardown?.(), 700); }
    );
  }

  function _showGuideAnswerCard(text) {
    document.getElementById('ophelia-answer-card')?.remove();
    const card = document.createElement('div');
    card.id = 'ophelia-answer-card';
    card.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483646;background:#111;border:1px solid rgba(255,122,26,0.5);border-radius:12px;padding:16px 18px;max-width:320px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:10px;';
    const lbl = document.createElement('div');
    lbl.textContent = '✶ Ophelia';
    lbl.style.cssText = 'color:#ff7a1a;font-size:12px;font-weight:700;';
    const body = document.createElement('div');
    body.textContent = text;
    body.style.cssText = 'color:#ddd;font-size:13px;line-height:1.5;';
    const btn = document.createElement('button');
    btn.textContent = 'Back to guide →';
    btn.style.cssText = 'background:#ff7a1a;border:none;border-radius:7px;color:#fff;font-size:12px;font-weight:600;padding:8px;cursor:pointer;';
    btn.onclick = () => card.remove();
    card.append(lbl, body, btn);
    document.body.appendChild(card);
    setTimeout(() => card.remove(), 30_000);
  }

  function _showGoalDialog() {
    if (document.getElementById('ophelia-goal-dialog')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ophelia-goal-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px)';

    const box = document.createElement('div');
    box.style.cssText = 'background:#111;border:1px solid rgba(255,122,26,0.5);border-radius:14px;padding:24px 28px;width:420px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.6);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

    const label = document.createElement('div');
    label.textContent = '\u2736 What do you want to do?';
    label.style.cssText = 'color:#ff7a1a;font-size:13px;font-weight:600;margin-bottom:12px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. Book a flight to Lisbon';
    input.style.cssText = 'width:100%;box-sizing:border-box;background:#1e1e1e;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;padding:10px 12px;outline:none';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'position:relative;display:flex;align-items:center;gap:8px';

    input.style.cssText += ';flex:1';

    const micBtn = document.createElement('button');
    micBtn.textContent = '🎤';
    micBtn.title = 'Speak your goal';
    micBtn.style.cssText = 'background:rgba(255,122,26,0.12);border:1px solid rgba(255,122,26,0.4);border-radius:8px;color:#ff7a1a;font-size:18px;padding:8px 10px;cursor:pointer;flex-shrink:0';

    let micActive = false;
    micBtn.onclick = async (e) => {
      e.preventDefault();
      if (!micActive) {
        micActive = true;
        micBtn.textContent = '🔴';
        micBtn.style.borderColor = '#ff4444';
        input.placeholder = 'Listening…';
        await _startMic((text) => {
          micActive = false;
          micBtn.textContent = '🎤';
          micBtn.style.borderColor = 'rgba(255,122,26,0.4)';
          input.placeholder = 'e.g. Book a flight to Lisbon';
          if (text) { input.value = text; input.focus(); }
        });
      } else {
        _micTeardown?.();
      }
    };

    const btn = document.createElement('button');
    btn.textContent = 'Go \u2192';
    btn.style.cssText = 'margin-top:14px;width:100%;background:#ff7a1a;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;padding:10px;cursor:pointer';

    const submit = () => {
      const goal = input.value.trim();
      if (!goal) return;
      _micTeardown?.();
      overlay.remove();
      _goal      = goal;
      _messages  = [];
      _stepCount = 0;
      _analyze('Page loaded — what should I do first?');
    };

    btn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') { _micTeardown?.(); overlay.remove(); _isActive = false; }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { _micTeardown?.(); overlay.remove(); _isActive = false; } });

    inputRow.append(input, micBtn);
    box.append(label, inputRow, btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);
  }

  function _removeGoalDialog() { document.getElementById('ophelia-goal-dialog')?.remove(); }

  function _showGuideHelperDialog(guide, stepIndex) {
    document.getElementById('ophelia-helper-dialog')?.remove();
    const step = guide.steps?.[stepIndex];

    const overlay = document.createElement('div');
    overlay.id = 'ophelia-helper-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(4px)';

    const box = document.createElement('div');
    box.style.cssText = 'background:#111;border:1px solid rgba(255,122,26,0.5);border-radius:14px;padding:24px 28px;width:420px;max-width:90vw;box-shadow:0 8px 40px rgba(0,0,0,0.6);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:12px;';

    const stepLabel = document.createElement('div');
    stepLabel.style.cssText = 'background:#1a1a2e;border:1px solid rgba(255,122,26,0.2);border-radius:8px;padding:9px 12px;';
    stepLabel.innerHTML = `<span style="color:#888;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Step ${stepIndex + 1} of ${guide.steps.length}</span><div style="color:#ccc;font-size:12px;margin-top:4px;line-height:1.4;">${step?.narration || '—'}</div>`;

    const questionLabel = document.createElement('div');
    questionLabel.textContent = 'What do you need?';
    questionLabel.style.cssText = 'color:#ff7a1a;font-size:13px;font-weight:600;';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = "e.g. I can't find the button…";
    input.style.cssText = 'flex:1;background:#1e1e1e;border:1px solid #333;border-radius:8px;color:#fff;font-size:14px;padding:10px 12px;outline:none;';

    const micBtn = document.createElement('button');
    micBtn.textContent = '🎤';
    micBtn.style.cssText = 'background:rgba(255,122,26,0.12);border:1px solid rgba(255,122,26,0.4);border-radius:8px;color:#ff7a1a;font-size:18px;padding:8px 10px;cursor:pointer;flex-shrink:0;';

    let micActive = false;
    micBtn.onclick = async (e) => {
      e.preventDefault();
      if (!micActive) {
        micActive = true;
        micBtn.textContent = '🔴';
        micBtn.style.borderColor = '#ff4444';
        input.placeholder = 'Listening…';
        await _startMic((text) => {
          micActive = false;
          micBtn.textContent = '🎤';
          micBtn.style.borderColor = 'rgba(255,122,26,0.4)';
          input.placeholder = "e.g. I can't find the button…";
          if (text) { input.value = text; input.focus(); }
        });
      } else {
        _micTeardown?.();
      }
    };

    const askBtn = document.createElement('button');
    askBtn.textContent = 'Ask Ophelia →';
    askBtn.style.cssText = 'background:#ff7a1a;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;padding:10px;cursor:pointer;';

    const closeHelper = () => {
      _micTeardown?.();
      overlay.remove();
      _isActive = false;
      window.opheliaHelperActive = false;
    };

    const submit = async () => {
      const q = input.value.trim();
      if (!q) return;
      _micTeardown?.();
      askBtn.textContent = 'Thinking…';
      askBtn.disabled    = true;
      input.disabled     = true;

      const result = await _analyzeGuideQuestion(q, guide, stepIndex);
      if (!result?.spokenText) { closeHelper(); return; }

      box.innerHTML = '';
      const answerLabel = document.createElement('div');
      answerLabel.textContent = '✶ Ophelia';
      answerLabel.style.cssText = 'color:#ff7a1a;font-size:13px;font-weight:600;';

      const answerText = document.createElement('div');
      answerText.textContent = result.spokenText;
      answerText.style.cssText = 'color:#ddd;font-size:14px;line-height:1.6;';

      const continueBtn = document.createElement('button');
      continueBtn.textContent = 'Back to guide →';
      continueBtn.style.cssText = 'margin-top:4px;width:100%;background:#ff7a1a;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;padding:10px;cursor:pointer;';
      continueBtn.onclick = closeHelper;

      box.appendChild(answerLabel);
      box.appendChild(answerText);
      box.appendChild(continueBtn);

      await _speak(result.spokenText);
    };

    askBtn.onclick = submit;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') closeHelper();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHelper(); });

    inputRow.append(input, micBtn);
    box.append(stepLabel, questionLabel, inputRow, askBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);
  }

  async function _analyzeGuideQuestion(question, guide, stepIndex) {
    const screenshot = await _captureScreen();
    const userContent = [];
    if (screenshot) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } });
    }
    userContent.push({ type: 'text', text: question });

    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        {
          action:       'analyze',
          apiMessages:  [{ role: 'user', content: userContent }],
          language:     navigator.language || 'en',
          pageUrl:      location.href,
          pageTitle:    document.title,
          goal:         question,
          guideContext: { guide, stepIndex }
        },
        res => {
          if (chrome.runtime.lastError || !res) { resolve(null); return; }
          const p = _parsePointTag(res._raw || '');
          resolve({ spokenText: p.spokenText || res.spokenText || '' });
        }
      );
    });
  }

  // ── Phase 4 — AssemblyAI Streaming STT ──────────────────────────────────────

  async function _startMic(onFinal, onTurn, onEndOfTurn) {
    _micTeardown?.();
    // Set an abort stub immediately so _micTeardown is never null for callers like
    // pauseCreatorForTabSwitch — even if called before the WebSocket finishes opening.
    let canceled = false;
    _micTeardown = () => { canceled = true; _micTeardown = null; };

    try {
      console.log('🎤 _startMic: fetching token…');
      const tokenRes = await fetch(`${WORKER_BASE}/transcribe-token`, { method: 'POST' });
      if (canceled) return;
      console.log('🎤 token response status:', tokenRes.status);
      const tokenData = await tokenRes.json();
      if (canceled) return;
      console.log('🎤 token data:', tokenData);
      const token = tokenData.token;
      if (!token) throw new Error('No token in response: ' + JSON.stringify(tokenData));

      console.log('🎤 requesting mic…');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (canceled) { stream.getTracks().forEach(t => t.stop()); return; }
      console.log('🎤 mic granted');
      const ctx    = new AudioContext({ sampleRate: 16000 });

      // Load PCM16 converter as inline AudioWorklet (avoids ScriptProcessorNode deprecation)
      const workletSrc = `
        class PCM16Processor extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (ch) {
              const int16 = new Int16Array(ch.length);
              for (let i = 0; i < ch.length; i++)
                int16[i] = Math.max(-32768, Math.min(32767, ch[i] * 32768));
              this.port.postMessage(int16.buffer, [int16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('ophelia-pcm16', PCM16Processor);
      `;
      const blobUrl = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }));
      console.log('🎤 loading AudioWorklet…');
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      if (canceled) { stream.getTracks().forEach(t => t.stop()); ctx.close(); return; }
      console.log('🎤 AudioWorklet loaded');

      const source   = ctx.createMediaStreamSource(stream);
      const worklet  = new AudioWorkletNode(ctx, 'ophelia-pcm16');

      console.log('🎤 opening WebSocket…');
      const ws = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=u3-rt-pro&token=${token}`
      );

      // Upgrade teardown now that all handles exist — callers get full cleanup
      _micTeardown = () => {
        canceled = true;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' }));
        try { worklet.disconnect(); source.disconnect(); } catch (_) {}
        stream.getTracks().forEach(t => t.stop());
        ctx.close().catch?.(() => {});
        setTimeout(() => { if (ws.readyState !== WebSocket.CLOSED) ws.close(); }, 300);
        _micTeardown = null;
        onFinal?.(finalText.trim());
      };

      ws.onopen = () => {
        if (canceled) { ws.close(); return; }
        console.log('🎤 WS open — streaming binary audio');
        const MIN_SAMPLES = 1600; // 100ms at 16kHz
        let pending = new Int16Array(0);
        worklet.port.onmessage = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const chunk = new Int16Array(e.data);
          const merged = new Int16Array(pending.length + chunk.length);
          merged.set(pending);
          merged.set(chunk, pending.length);
          pending = merged;
          if (pending.length >= MIN_SAMPLES) {
            ws.send(pending.buffer);
            pending = new Int16Array(0);
          }
        };
        source.connect(worklet);
        worklet.connect(ctx.destination);
      };

      let finalText = '';
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'Begin' && msg.type !== 'SpeechStarted') console.log('🎤', msg.type, msg.end_of_turn ?? '', msg.transcript || '');
        const text = msg.transcript || msg.text || '';
        if (msg.type === 'Turn' && text) {
          if (msg.end_of_turn === true) {
            finalText += text + ' ';
            if (!onTurn) _setDotLabel(`🔴 ${finalText.trim().slice(-60)}`);
            onEndOfTurn?.();
          } else {
            if (!onTurn) _setDotLabel(`🔴 ${text.slice(-60)}`);
          }
          onTurn?.(text, msg.end_of_turn === true);
        }
      };

      ws.onerror = (err) => console.warn('🎤 AssemblyAI WS error:', err);
      ws.onclose = (e) => console.log('🎤 WS closed:', e.code, e.reason);

    } catch (err) {
      _micTeardown = null;
      console.warn('🎤 _startMic failed:', err?.message || err?.name || String(err));
      onFinal?.('');
    }
  }

  function stop() {
    _isActive      = false;
    _isLearning    = false;
    _isCreatorMode = false;
    _guideSteps    = [];
    _creatorLayer?.unmount();
    _creatorLayer  = null;
    _clearCreatorSession?.();

    _removeTextInputDialog();
    _removeGoalDialog();
    document.getElementById('ophelia-helper-dialog')?.remove();
    document.getElementById('ophelia-guide-save-dialog')?.remove();
    document.getElementById('ophelia-answer-card')?.remove();
    window.opheliaHelperActive = false;
    window.OpheliaOverlay?.hide();
    window.opheliaTutorialActive = false;
    chrome.storage.local.remove('opheliaGuidePending');
    _clearDotLabel();

    _micTeardown?.();
    _micTeardown = null;
    _currentAudio?.pause();
    _currentAudio = null;
    window.speechSynthesis?.cancel();

    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) {
      sphere.style.background = '#ff7a1a';
      sphere.style.boxShadow  = '0 0 16px #ff7a1a';
      sphere.style.transform  = 'scale(1)';
    }
  }

  function isActive() { return _isActive || _isLearning || _isCreatorMode; }

  function onSphereClick() {
    if (_isCreatorMode) {
      _finishCreatorRecording();
      return true;
    }
    return false;
  }

  // ── Creator Recording Layer ────────────────────────────────────────────────

  class CreatorLayer {
    constructor() {
      this.stepIndex         = 0;
      this.pendingSteps      = [];
      this.pendingNarrations = [];
      this._hoverOutlineEl     = null;
      this._activeInput        = null;
      this._initialInputValue  = '';
      this._scanningKeyHandler = null;
      this._dispatching        = false;
      this._isBurstMode        = false;
      this._speechBuffer       = [];
      this._onHover     = this._onHover.bind(this);
      this._onMouseOut  = this._onMouseOut.bind(this);
      this._onCapture   = this._onCapture.bind(this);
      this._onFocus     = this._onFocus.bind(this);
      this._onBlur      = this._onBlur.bind(this);
      this._onKeyDown   = this._onKeyDown.bind(this);
    }

    mount() {
      document.addEventListener('mouseover', this._onHover,   true);
      document.addEventListener('mouseout',  this._onMouseOut, true);
      document.addEventListener('click',     this._onCapture, true);
      document.addEventListener('focusin',   this._onFocus,   true);
      document.addEventListener('focusout',  this._onBlur,    true);
      document.addEventListener('keydown',   this._onKeyDown, true);
      this._scanningKeyHandler = this._onScanningKey.bind(this);
      document.addEventListener('keydown',   this._scanningKeyHandler, true);
      _setDotLabel('🔴 Recording — click, type, or press H to record hover');
    }

    unmount() {
      document.removeEventListener('mouseover', this._onHover,   true);
      document.removeEventListener('mouseout',  this._onMouseOut, true);
      document.removeEventListener('click',     this._onCapture, true);
      document.removeEventListener('focusin',   this._onFocus,   true);
      document.removeEventListener('focusout',  this._onBlur,    true);
      document.removeEventListener('keydown',   this._onKeyDown, true);
      if (this._scanningKeyHandler) { document.removeEventListener('keydown', this._scanningKeyHandler, true); this._scanningKeyHandler = null; }
      this._clearHoverPreview();
      document.body.style.overflow = '';
      this._isBurstMode = false;
    }

    // ── Scanning keyboard shortcuts ─────────────────────────────────────────

    async _onScanningKey(e) {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 'z') {
        e.preventDefault();
        e.stopPropagation();
        this.undoLastStep();
        return;
      }

      // Burst Mode Toggle: Ctrl+B
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        this._isBurstMode = !this._isBurstMode;
        const msg = this._isBurstMode ? 'Burst Mode: ON (Auto-accepting steps)' : 'Burst Mode: OFF (Manual confirmation)';
        window.OpheliaNotify?.(msg, 'info');
        _setDotLabel(`🔴 Recording — ${this._isBurstMode ? 'BURST MODE' : 'Step ' + this.stepIndex}`);
        return;
      }

      // Hover Trigger: Press 'H' while hovering, and NOT currently typing in an input
      if (!mod && e.key.toLowerCase() === 'h' && !this._activeInput && this._hoverOutlineEl) {
        e.preventDefault();
        e.stopPropagation();
        const screenshot = await _captureScreen();
        this._commitStep(this._hoverOutlineEl, screenshot, 'hover');
        window.OpheliaNotify?.('Hover step recorded', 'info');
      }
    }

    undoLastStep() {
      if (this.pendingSteps.length === 0) {
        window.OpheliaNotify?.('Nothing to undo.', 'info');
        return;
      }
      this.pendingSteps.pop();
      this.pendingNarrations.pop();
      this.stepIndex--;
      _persistCreatorSession();
      _setDotLabel(`🔴 Recording — Step ${this.stepIndex} (undone, Ctrl+Z for more)`);
      window.OpheliaNotify?.(`Step ${this.stepIndex + 1} removed — re-click to re-record.`, 'info');
    }

    // ── Intent Detection: Hover ─────────────────────────────────────────────

    _onHover(e) {
      const el = e.target;
      if (!el || el === document.body || el === document.documentElement) { this._clearHoverPreview(); return; }
      if (el.id === 'cross-tab-sphere') { this._clearHoverPreview(); return; }
      if (el.closest('#ophelia-guide-save-dialog,#ophelia-goal-dialog,#ophelia-helper-dialog,#ophelia-dot-label,#ophelia-answer-card,#ophelia-confirm-pill')) { this._clearHoverPreview(); return; }
      const resolved = _meaningfulTarget(el);
      if (this._hoverOutlineEl && this._hoverOutlineEl !== resolved) {
        this._hoverOutlineEl.style.outline      = '';
        this._hoverOutlineEl.style.outlineOffset = '';
      }
      this._hoverOutlineEl = resolved;
      resolved.style.outline      = '2px dashed rgba(139,92,246,0.35)';
      resolved.style.outlineOffset = '2px';
      
      // Pre-warm screenshot
      _captureScreen();
    }

    _onMouseOut(e) {
      // Intentionally empty, handled by _onHover and _clearHoverPreview
    }

    _clearHoverPreview() {
      if (this._hoverOutlineEl) {
        this._hoverOutlineEl.style.outline      = '';
        this._hoverOutlineEl.style.outlineOffset = '';
        this._hoverOutlineEl = null;
      }
    }

    // ── Intent Detection: Type ──────────────────────────────────────────────

    _onFocus(e) {
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        this._activeInput = el;
        this._initialInputValue = el.value || '';
      }
    }

    async _onBlur(e) {
      if (this._activeInput && this._activeInput === e.target) {
        this._checkTypeIntent(this._activeInput);
        this._activeInput = null;
      }
    }

    _onKeyDown(e) {
      if (e.key === 'Enter' && this._activeInput && this._activeInput === e.target) {
        this._checkTypeIntent(this._activeInput);
        this._activeInput = null; // Prevent blur from double-firing
      }
    }

    async _checkTypeIntent(el) {
      const currentValue = el.value || '';
      if (currentValue !== this._initialInputValue) {
        const screenshot = await _captureScreen();
        this._commitStep(el, screenshot, 'type', currentValue);
        window.OpheliaNotify?.('Type step recorded', 'info');
      }
    }

    // ── Active click recording (Interception + Confirmation) ────────────────

    async _onCapture(e) {
      if (this._dispatching) return;
      
      const el = e.target;
      if (!el || el.id === 'cross-tab-sphere') return;
      if (el.closest('#ophelia-guide-save-dialog,#ophelia-goal-dialog,#ophelia-helper-dialog,#ophelia-dot-label,#ophelia-answer-card,#ophelia-confirm-pill')) return;

      // Phase 1: Intercept and prevent default
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const resolved = _meaningfulTarget(el);
      this._clearHoverPreview();

      // Capture screenshot immediately for high-fidelity recording (before Ophelia UI appears)
      const screenshot = await _captureScreen();

      const onAccept = () => {
        document.body.style.overflow = '';
        this._commitStep(resolved, screenshot, 'click');
        
        // Re-dispatch click to allow the actual site logic to fire
        this._dispatching = true;
        resolved.click();
        this._dispatching = false;
      };

      if (this._isBurstMode) {
        onAccept();
        return;
      }

      // Show confirmation UI
      document.body.style.overflow = 'hidden'; // Lock scroll
      window.OpheliaOverlay.showRecordingConfirm(
        resolved,
        onAccept,
        () => { // onEdit
          document.body.style.overflow = '';
          // Simply return to scanning mode
        }
      );
    }

    pushSpeech(text) {
      if (!text) return;
      this._speechBuffer.push({ text, ts: Date.now() });
      if (this._speechBuffer.length > 200) this._speechBuffer.shift();
    }

    consumeSpeech() {
      const text = this._speechBuffer.map(e => e.text).join(' ').trim();
      this._speechBuffer = [];
      return text;
    }

    // ── Step commit + async Claude narration ────────────────────────────────────────

    _commitStep(el, screenshot, action = 'click', textValue = null) {
      const r               = el.getBoundingClientRect();
      const raw_instruction = this.consumeSpeech() || null;
      const stepN           = this.stepIndex + 1;
      const step = {
        order:          this.stepIndex++,
        action:         action,
        textValue:      textValue,
        screenshot,
        url:            window.location.href,
        fingerprint:    _fingerprintElement(el),
        point:          { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
        raw_instruction,
        narration:      null
      };
      this.pendingSteps.push(step);

      let actionDesc = 'Interacted with';
      if (action === 'click') actionDesc = 'Clicked';
      if (action === 'type') actionDesc = `Typed "${textValue}" into`;
      if (action === 'hover') actionDesc = 'Hovered over';

      const label = el.getAttribute('aria-label') || el.innerText?.trim().substring(0, 30) || el.tagName.toLowerCase();
      const toast = document.createElement('div');
      toast.textContent = `✓ Step ${stepN} — ${actionDesc} ${label}`;
      toast.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.92);color:#fff;font-size:12px;font-weight:600;padding:5px 14px;border-radius:999px;pointer-events:none;transition:opacity 500ms ease;font-family:-apple-system,sans-serif;white-space:nowrap;';
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; }, 1200);
      setTimeout(() => toast.remove(), 1700);
      _setDotLabel(`🔴 Recording — Step ${this.stepIndex} (Ctrl+Z to undo)`);

      const voiceHint = raw_instruction ? ` Creator's raw transcript: "${raw_instruction}".` : ' No transcript provided.';
      let contextMsg = `Step ${stepN}. Action: ${action.toUpperCase()}. Element: "${label}".`;
      if (action === 'type') contextMsg += ` The user typed: "${textValue}".`;
      contextMsg += voiceHint;

      const sysPrompt = stepN === 1 
        ? 'You are an expert guide writing spoken narration for a product tutorial. This is the FIRST step. Understand the creator\'s raw transcript and pair it with the interacted element data and action type. Write a warm 1-2 sentence introduction about the overall task based on the transcript, followed by a short instruction for this specific step (e.g., "I am going to show you how to change your password. First, click on Settings" or "First, type your email here"). Use present-tense action language. Do NOT include any markers like [POINT] or coordinates.'
        : 'You are an expert guide writing spoken narration for a product tutorial step. Understand the creator\'s raw transcript and pair it with the interacted element data and action type (e.g. click, type, hover). Write ONE short, natural sentence instructing the viewer on what to do (e.g., "Click the...", "Type your name into...", "Hover over..."). Be specific and warm. Do NOT include any markers like [POINT] or coordinates.';

      const p = (async () => {
        try {
          const res = await fetch(`${WORKER_BASE}/claude`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5', max_tokens: 150,
              system: sysPrompt,
              messages: [{ role: 'user', content: [{ type: 'text', text: contextMsg }] }]
            })
          });
          if (res.ok) {
            const data   = await res.json();
            const raw    = data?.content?.[0]?.text || '';
            const parsed = _parsePointTag(raw);
            step.narration = parsed.spokenText || raw;
            if (parsed.x != null) step.point = { x: parsed.x, y: parsed.y };
          }
        } catch (_) { 
            step.narration = raw_instruction || `${action === 'type' ? 'Type into' : (action === 'hover' ? 'Hover over' : 'Click')} ${label}.`; 
        }
        _updateStepNarrationInStorage(step.order, step.narration, step.point);
      })();
      this.pendingNarrations.push(p);

      _persistCreatorSession(); // persist immediately (narration may still be null)
    }
  }

  // ── Semantic target resolver (port from recorder.js) ─────────────────────

  function _meaningfulTarget(el) {
    const GOOD_TAGS  = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);
    const GOOD_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);
    if (el.getAttribute('aria-label') || el.getAttribute('data-testid')) return el;
    let cur = el;
    while (cur && cur !== document.body) {
      const tag  = (cur.tagName || '').toLowerCase();
      const role = cur.getAttribute('role') || '';
      if (GOOD_TAGS.has(tag) || GOOD_ROLES.has(role) ||
          cur.getAttribute('aria-label') || cur.getAttribute('data-testid')) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  // ── Creator session persistence (Phase C) ─────────────────────────────────

  const CREATOR_SESSION_KEY = 'opheliaCreatorSession';

  function _persistCreatorSession() {
    if (!_creatorLayer) return;
    chrome.storage.local.set({
      [CREATOR_SESSION_KEY]: {
        active:     true,
        stepIndex:  _creatorLayer.stepIndex,
        steps:      _creatorLayer.pendingSteps.map(s => ({
          order:           s.order,
          action:          s.action,
          textValue:       s.textValue,
          url:             s.url || null,
          fingerprint:     s.fingerprint,
          point:           s.point,
          raw_instruction: s.raw_instruction,
          narration:       s.narration
        }))
      }
    });
  }

  function _clearCreatorSession() {
    chrome.storage.local.remove(CREATOR_SESSION_KEY);
  }

  // ── Start / Finish / Resume ────────────────────────────────────────────────

  function _startCreatorRecording() {
    _isActive      = false;
    _isCreatorMode = true;
    _isLearning    = true;
    _guideSteps    = [];
    _clearCreatorSession();

    _creatorLayer = new CreatorLayer();
    _creatorLayer.mount();

    // Start mic — only push final (end_of_turn) turns into the speech buffer
    _startMic(
      () => {},
      (text, isFinal) => { if (isFinal) _creatorLayer?.pushSpeech(text); }
    );

    chrome.runtime.sendMessage({ action: 'creatorModeStarted' }).catch(() => {});
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) { sphere.style.background = '#34a853'; sphere.style.boxShadow = '0 0 20px #34a853'; }
    window.OpheliaNotify?.('Recording — click anything to add steps. Ctrl+Z to undo. Green sphere to finish.', 'info');
  }

  function pauseCreatorForTabSwitch() {
    if (!_isCreatorMode || !_creatorLayer) return null;
    // Build the snapshot BEFORE unmounting so pendingSteps is still intact
    const session = {
      active:    true,
      stepIndex: _creatorLayer.stepIndex,
      steps:     _creatorLayer.pendingSteps.map(s => ({
        order:           s.order,
        action:          s.action,
        textValue:       s.textValue,
        url:             s.url || null,
        fingerprint:     s.fingerprint,
        point:           s.point,
        raw_instruction: s.raw_instruction,
        narration:       s.narration
      }))
    };
    _persistCreatorSession();  // also write to storage as crash-recovery fallback
    _creatorLayer.unmount();
    _creatorLayer  = null;
    _isCreatorMode = false;
    _isLearning    = false;
    _micTeardown?.(); _micTeardown = null;
    _clearDotLabel();
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) { sphere.style.background = '#ff7a1a'; sphere.style.boxShadow = '0 0 16px #ff7a1a'; }
    return session;  // returned to background.js via sendResponse
  }

  function _finishCreatorRecording() {
    if (!_isCreatorMode) return;
    _creatorLayer?.unmount();
    _isCreatorMode = false;
    _isLearning    = false;
    _micTeardown?.(); _micTeardown = null;
    _clearDotLabel();
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) { sphere.style.background = '#ff7a1a'; sphere.style.boxShadow = '0 0 16px #ff7a1a'; }

    // Flush this tab's latest steps to storage first
    _persistCreatorSession();
    const layer   = _creatorLayer;
    _creatorLayer = null;
    _isActive     = true;

    chrome.runtime.sendMessage({ action: 'creatorModeStopped' }).catch(() => {});

    // Read ALL accumulated steps from storage (spans all tabs)
    chrome.storage.local.get([CREATOR_SESSION_KEY], (result) => {
      _clearCreatorSession();
      _guideSteps = result[CREATOR_SESSION_KEY]?.steps || layer?.pendingSteps || [];
      const narrationPromises = _rebuildNarrationPromises(_guideSteps);
      _showGuideSaveDialog(narrationPromises);
    });
  }

  async function resumeCreatorMode(session) {
    if (_isActive) return;
    if (_isCreatorMode) {
      if (_creatorLayer) {
        _creatorLayer.stepIndex    = session.stepIndex || 0;
        _creatorLayer.pendingSteps = session.steps    || [];
        _creatorLayer.pendingNarrations = _rebuildNarrationPromises(_creatorLayer.pendingSteps);
        _setDotLabel(`🔴 Recording — Step ${_creatorLayer.stepIndex} (resumed)`);
      }
      return;
    }

    _isCreatorMode = true;
    _isLearning    = true;
    _guideSteps    = [];

    _creatorLayer = new CreatorLayer();
    _creatorLayer.stepIndex    = session.stepIndex || 0;
    _creatorLayer.pendingSteps = session.steps    || [];

    _creatorLayer.pendingNarrations = _rebuildNarrationPromises(_creatorLayer.pendingSteps);

    _creatorLayer.mount();

    _startMic(
      () => {},
      (text, isFinal) => { if (isFinal) _creatorLayer?.pushSpeech(text); }
    );

    chrome.runtime.sendMessage({ action: 'creatorModeStarted' }).catch(() => {});
    const sphere = document.getElementById('cross-tab-sphere');
    if (sphere) { sphere.style.background = '#34a853'; sphere.style.boxShadow = '0 0 20px #34a853'; }
    _setDotLabel(`🔴 Recording — Step ${_creatorLayer.stepIndex} (resumed)`);
    window.OpheliaNotify?.(`Guide recording resumed (${_creatorLayer.stepIndex} steps so far). Green sphere to finish.`, 'info');
  }

  // ── Narration helpers (shared by resumeCreatorMode + _finishCreatorRecording) ─

  function _rebuildNarrationPromises(steps) {
    return steps.map(s => {
      if (s.narration) return Promise.resolve();
      const label     = s.fingerprint?.aria_label || s.fingerprint?.text_content?.substring(0, 30) || s.fingerprint?.tag || 'element';
      const voiceHint = s.raw_instruction ? ` Creator's raw transcript: "${s.raw_instruction}".` : ' No transcript provided.';
      const stepN     = s.order + 1;
      const action    = s.action || 'click';

      let contextMsg = `Step ${stepN}. Action: ${action.toUpperCase()}. Element: "${label}".`;
      if (action === 'type') contextMsg += ` The user typed: "${s.textValue}".`;
      contextMsg += voiceHint;

      const sysPrompt = stepN === 1 
        ? 'You are an expert guide writing spoken narration for a product tutorial. This is the FIRST step. Understand the creator\'s raw transcript and pair it with the interacted element data and action type. Write a warm 1-2 sentence introduction about the overall task based on the transcript, followed by a short instruction for this specific step (e.g., "I am going to show you how to change your password. First, click on Settings" or "First, type your email here"). Use present-tense action language. Do NOT include any markers like [POINT] or coordinates.'
        : 'You are an expert guide writing spoken narration for a product tutorial step. Understand the creator\'s raw transcript and pair it with the interacted element data and action type (e.g. click, type, hover). Write ONE short, natural sentence instructing the viewer on what to do (e.g., "Click the...", "Type your name into...", "Hover over..."). Be specific and warm. Do NOT include any markers like [POINT] or coordinates.';

      return (async () => {
        try {
          const res = await fetch(`${WORKER_BASE}/claude`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5', max_tokens: 150,
              system: sysPrompt,
              messages: [{ role: 'user', content: [{ type: 'text', text: contextMsg }] }]
            })
          });
          if (res.ok) {
            const data   = await res.json();
            const raw    = data?.content?.[0]?.text || '';
            const parsed = _parsePointTag(raw);
            s.narration = parsed.spokenText || raw;
            if (parsed.x != null) s.point = { x: parsed.x, y: parsed.y };
          }
        } catch (_) { 
             s.narration = s.raw_instruction || `${action === 'type' ? 'Type into' : (action === 'hover' ? 'Hover over' : 'Click')} ${label}.`; 
        }
        _updateStepNarrationInStorage(s.order, s.narration, s.point);
      })();
    });
  }

  function _updateStepNarrationInStorage(order, narration, point) {
    chrome.storage.local.get([CREATOR_SESSION_KEY], (r) => {
      const session = r[CREATOR_SESSION_KEY];
      if (!session?.steps) return;
      const found = session.steps.find(st => st.order === order);
      if (found) { found.narration = narration; if (point) found.point = point; }
      chrome.storage.local.set({ [CREATOR_SESSION_KEY]: session });
    });
  }

  function _highlightElement(el, color = '#ff7a1a') {
    if (!el) return;
    const original = el.style.boxShadow;
    el.style.boxShadow = `0 0 20px ${color}, 0 0 40px ${color}66`;
    setTimeout(() => { if (el) el.style.boxShadow = original; }, 1500);
  }

  function _removeTextInputDialog() {
    document.getElementById('ophelia-save-dialog')?.remove();
  }

  // ── Guide Save Dialog (Phase 3) ────────────────────────────────────────────

  function _showGuideSaveDialog(narrationPromises = []) {
    document.getElementById('ophelia-guide-save-dialog')?.remove();

    const total   = _guideSteps.length;
    let   pending = _guideSteps.filter(s => !s.narration).length;

    const wrap = document.createElement('div');
    wrap.id = 'ophelia-guide-save-dialog';
    wrap.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#111;border:1px solid rgba(255,122,26,0.5);border-radius:14px;padding:20px 22px;width:400px;max-width:92vw;box-shadow:0 8px 40px rgba(0,0,0,0.7);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:12px;';

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
    const titleEl = document.createElement('span');
    titleEl.innerHTML = `<span style="color:#ff7a1a;font-weight:700;font-size:15px;">✶ Save Guide</span><span style="color:#888;font-size:12px;margin-left:8px;">${total} step${total !== 1 ? 's' : ''}</span>`;
    const statusEl = document.createElement('span');
    statusEl.style.cssText = 'color:#888;font-size:11px;';
    statusEl.textContent   = pending > 0 ? `⏳ ${pending}/${total} narrations…` : '';
    header.appendChild(titleEl);
    header.appendChild(statusEl);
    wrap.appendChild(header);

    // Name input
    const nameInp = document.createElement('input');
    nameInp.placeholder = 'Guide name (e.g. "How to create a Bubble app")';
    nameInp.style.cssText = 'width:100%;background:#1e1e24;border:1px solid #444;border-radius:7px;padding:9px 11px;color:#fff;font-size:13px;outline:none;box-sizing:border-box;';
    wrap.appendChild(nameInp);

    // Step preview — all steps, placeholders for pending narrations
    const preview = document.createElement('div');
    preview.style.cssText = 'max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;';
    const stepRows = _guideSteps.map((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';
      const num = document.createElement('span');
      num.textContent = `${i + 1}.`;
      num.style.cssText = 'color:#ff7a1a;font-size:11px;font-weight:700;min-width:18px;padding-top:2px;';
      const txt = document.createElement('div');
      txt.contentEditable = 'true';
      if (s.narration) {
        txt.textContent = s.narration;
        txt.style.cssText = 'color:#ccc;font-size:12px;line-height:1.5;flex:1;background:#1e1e24;border-radius:5px;padding:4px 7px;outline:none;border:1px solid transparent;';
      } else {
        txt.textContent = 'Generating narration…';
        txt.dataset.generating = '1';
        txt.style.cssText = 'color:#555;font-size:12px;font-style:italic;line-height:1.5;flex:1;background:#1a1a1a;border-radius:5px;padding:4px 7px;outline:none;border:1px solid transparent;';
      }
      txt.onfocus = () => { txt.style.borderColor = 'rgba(255,122,26,0.4)'; };
      txt.onblur  = () => { txt.style.borderColor = 'transparent'; if (!txt.dataset.generating) s.narration = txt.textContent.trim(); };
      row.appendChild(num);
      row.appendChild(txt);
      preview.appendChild(row);
      return txt;
    });
    if (total > 0) wrap.appendChild(preview);

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const saveBtn = document.createElement('button');
    saveBtn.disabled    = pending > 0;
    saveBtn.textContent = pending > 0 ? `Waiting for ${pending} narration${pending > 1 ? 's' : ''}…` : 'Save & Share →';
    saveBtn.style.cssText = `flex:1;background:${pending > 0 ? '#444' : '#ff7a1a'};color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;font-size:13px;cursor:${pending > 0 ? 'default' : 'pointer'};`;

    // Wire each narration promise to update its row live
    narrationPromises.forEach((p, i) => {
      if (i >= stepRows.length) return;
      p.then(() => {
        const txt = stepRows[i];
        const s   = _guideSteps[i];
        if (txt.dataset.generating) {
          delete txt.dataset.generating;
          txt.textContent   = s.narration || `Step ${i + 1}.`;
          txt.style.color      = '#ccc';
          txt.style.fontStyle  = '';
          txt.style.background = '#1e1e24';
        }
        pending = Math.max(0, pending - 1);
        statusEl.textContent = pending > 0 ? `⏳ ${pending}/${total} narrations…` : `✓ All ${total} narrations ready`;
        saveBtn.disabled    = pending > 0;
        saveBtn.textContent = pending > 0 ? `Waiting for ${pending} narration${pending > 1 ? 's' : ''}…` : 'Save & Share →';
        saveBtn.style.background = pending > 0 ? '#444' : '#ff7a1a';
        saveBtn.style.cursor     = pending > 0 ? 'default' : 'pointer';
      });
    });

    const cancelBtn = document.createElement('div');
    cancelBtn.textContent = 'Discard';
    cancelBtn.style.cssText = 'color:#888;font-size:11px;text-align:center;cursor:pointer;align-self:center;';
    cancelBtn.onclick = stop;

    saveBtn.onclick = async () => {
      const name = nameInp.value.trim() || 'Untitled Guide';
      saveBtn.textContent = 'Uploading…';
      saveBtn.disabled = true;

      const startStepUrl = _guideSteps[0]?.url;
      const startDomain = startStepUrl ? new URL(startStepUrl).hostname : location.hostname;

      // Strip screenshots from steps to reduce payload if needed, keep narration + fingerprint + point
      const payload = {
        name,
        domain:  startDomain,
        pageUrl: startStepUrl || location.href,
        steps:   _guideSteps.map(s => ({
          order:       s.order,
          action:      s.action,
          narration:   s.narration || `Step ${s.order + 1}.`,
          fingerprint: s.fingerprint,
          point:       s.point,
          url:         s.url || null,
          screenshot:  s.screenshot   // base64 JPEG
        }))
      };

      try {
        const res  = await fetch(`${WORKER_BASE}/guide`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);

        // Cache locally
        chrome.storage.local.get(['opheliaGuides'], (stored) => {
          const all    = stored.opheliaGuides || {};
          const domain = location.hostname;
          all[domain]  = all[domain] || [];
          all[domain].push({ id: data.id, name, shareUrl: data.shareUrl, stepCount: payload.steps.length, savedAt: Date.now() });
          chrome.storage.local.set({ opheliaGuides: all });
        });

        // Show success with copy link
        wrap.innerHTML = '';
        const msg = document.createElement('div');
        msg.innerHTML = `<div style="color:#34a853;font-weight:700;font-size:14px;margin-bottom:8px;">✅ Guide saved!</div>
          <div style="color:#888;font-size:11px;margin-bottom:8px;">${name} — ${payload.steps.length} steps</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input readonly value="${data.shareUrl}" style="flex:1;background:#1e1e24;border:1px solid #444;border-radius:6px;padding:7px 9px;color:#aaa;font-size:11px;outline:none;">
            <button id="ophelia-copy-link" style="background:#ff7a1a;color:#fff;border:none;border-radius:6px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Copy</button>
          </div>
          <div id="ophelia-guide-close" style="color:#888;font-size:11px;text-align:center;cursor:pointer;margin-top:10px;">Close</div>`;
        wrap.appendChild(msg);
        document.getElementById('ophelia-copy-link').onclick = () => {
          navigator.clipboard.writeText(data.shareUrl);
          document.getElementById('ophelia-copy-link').textContent = 'Copied!';
        };
        document.getElementById('ophelia-guide-close').onclick = stop;

      } catch (err) {
        saveBtn.textContent = 'Save & Share →';
        saveBtn.disabled = false;
        window.OpheliaNotify?.(`Failed to save guide: ${err.message}`, 'error');
      }
    };

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    wrap.appendChild(btnRow);

    document.body.appendChild(wrap);
    setTimeout(() => nameInp.focus(), 10);
  }

  // ── Screenshot capture ──────────────────────────────────────────────────────

  function _captureScreen() {
    const pageKey = `${location.href}|${Math.round(window.scrollY / 50) * 50}`;
    if (pageKey === _lastPageKey && _lastScreenshot) return Promise.resolve(_lastScreenshot);
    const urlChanged = !!_lastPageKey && !_lastPageKey.startsWith(location.href + '|');
    if (urlChanged) _stepsSinceNav = 0;
    const quality = urlChanged ? 75 : (_stepsSinceNav >= 2 ? 50 : 70);
    _lastPageKey = pageKey;
    _stepsSinceNav++;
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'captureTab', quality }, res => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          const b64 = (res?.dataUrl || '').replace(/^data:image\/[a-z]+;base64,/, '') || null;
          _lastScreenshot = b64;
          resolve(b64);
        });
      } catch (_) { resolve(null); }
    });
  }

  // ── Parse [POINT:x,y:label] from response text ───────────────────────────

  function _parsePointTag(text) {
    const m = text.match(/\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]]+))?)\]\s*$/);
    if (!m) return { spokenText: text, x: null, y: null, label: null };
    const spokenText = text.slice(0, m.index).trim();
    if (!m[1]) return { spokenText, x: null, y: null, label: 'none' };
    return { spokenText, x: parseInt(m[1]), y: parseInt(m[2]), label: m[3] || null };
  }

  // ── Claude call ─────────────────────────────────────────────────────────────

  function _callClaude() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { action: 'analyze', apiMessages: _messages, language: navigator.language || 'en',
          pageUrl: location.href, pageTitle: document.title, goal: _goal },
        res => {
          if (chrome.runtime.lastError || !res) { resolve(null); return; }
          const p = _parsePointTag(res._raw || '');
          resolve({
            spokenText:         p.spokenText || res.spokenText || '',
            x:                  p.x,
            y:                  p.y,
            label:              p.label,
            done:               res.done               || false,
            _instructionSpoken: res._instructionSpoken  || false,
            _raw:               res._raw               || ''
          });
        }
      );
    });
  }

  // ── Vision-only analyze ─────────────────────────────────────────────────────

  async function _analyze(trigger) {
    _setDotLabel('Thinking…');

    const screenshot = await _captureScreen();

    const userContent = [];
    if (screenshot) {
      userContent.push({
        type:   'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: screenshot }
      });
    }
    userContent.push({
      type: 'text',
      text: `Step ${_stepCount + 1}. ${trigger}`
    });

    _messages.push({ role: 'user', content: userContent });

    const parsed = await _callClaude();
    if (!parsed) { _setDotLabel('No response.'); return; }

    _messages.push({ role: 'assistant', content: parsed._raw });
    _stepCount++;

    if (parsed.done) {
      await _speak('Done! Your goal is complete.');
      _setDotLabel('✅ Done!');
      return;
    }

    // 5.2: TTS always fires after full response — ElevenLabs needs the complete sentence
    const el = (parsed.x != null)
      ? await _resolveFromCoords(parsed.x, parsed.y, screenshot, parsed.spokenText)
      : null;
    await _speak(parsed.spokenText);
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      requestAnimationFrame(() => requestAnimationFrame(() => _highlightElement(el)));
    }
  }

  // ── Map screenshot coordinates → DOM element (+ Computer Use fallback) ────

  async function _resolveFromCoords(screenshotX, screenshotY, screenshot, instruction) {
    const dpr  = window.devicePixelRatio || 1;
    const cssX = Math.round(screenshotX / dpr);
    const cssY = Math.round(screenshotY / dpr);
    const el   = document.elementFromPoint(cssX, cssY);
    if (el && el !== document.body && el !== document.documentElement) {
      console.log(`✅ _resolveFromCoords: (${screenshotX},${screenshotY}) → CSS (${cssX},${cssY}) → <${el.tagName}>`);
      return el;
    }

    // 2.2 fallback: Computer Use API for pixel-precise re-detection
    if (screenshot && instruction) {
      console.log('🔍 _resolveFromCoords: primary miss — trying Computer Use fallback');
      const coords = await _computerUseLookup(screenshot, instruction);
      if (coords) {
        const el2 = document.elementFromPoint(
          Math.round(coords.x * window.innerWidth  / coords.targetWidth),
          Math.round(coords.y * window.innerHeight / coords.targetHeight)
        );
        if (el2 && el2 !== document.body && el2 !== document.documentElement) {
          console.log(`✅ Computer Use fallback: [${coords.x},${coords.y}] → <${el2.tagName}>`);
          return el2;
        }
      }
    }
    return null;
  }

  async function _computerUseLookup(screenshot, instruction) {
    try {
      const res = await fetch(`${WORKER_BASE}/computer-use`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          screenshot,
          question: instruction,
          width:    window.innerWidth  * (window.devicePixelRatio || 1),
          height:   window.innerHeight * (window.devicePixelRatio || 1)
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.x != null) ? data : null;
    } catch (_) { return null; }
  }

  // ── TTS (ElevenLabs via /tts worker, speechSynthesis fallback) ─────────────

  async function _speak(text, onEnd) {
    if (!text) { onEnd?.(); return; }
    const cleanText = text.replace(/\[POINT:[^\]]+\]/g, '').trim();
    try {
      const res = await fetch(`${WORKER_BASE}/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: cleanText })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(`TTS ${res.status}: ${JSON.stringify(errBody)}`);
      }
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
      _currentAudio = audio;
      await audio.play();
    } catch (err) {
      console.warn('Ophelia TTS fallback:', err?.message || err);
      const utt   = new SpeechSynthesisUtterance(cleanText);
      utt.rate    = _ttsRate;
      utt.onend   = onEnd;
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(utt);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _fingerprintElement(el) {
    const r = el.getBoundingClientRect();
    return {
      tag:          el.tagName.toLowerCase(),
      role:         el.getAttribute('role'),
      aria_label:   el.getAttribute('aria-label'),
      data_testid:  el.getAttribute('data-testid'),
      text_content: el.textContent.trim().substring(0, 100),
      xpath:        _getXPath(el),
      selector:     _getCSSSelector(el),
      boundingRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      position:     { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), scroll_y: Math.round(window.scrollY) }
    };
  }

  function _isFragileId(id) {
    if (!id) return true;
    // Bubble hashes (5-6 chars, e.g. bTGYf)
    if (/^[a-zA-Z0-9]{5,6}$/.test(id)) return true;
    // Bubble internal paths (e.g. pages.elements.properties)
    if (id.includes('.') || id.includes(':')) return true;
    // GUIDs/UUIDs
    if (/[0-9a-f-]{32,}/i.test(id)) return true;
    // Likely auto-generated numeric suffixes
    if (/\d{5,}$/.test(id)) return true;
    return false;
  }

  function _getCSSSelector(el) {
    if (el.id && !_isFragileId(el.id)) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id && !_isFragileId(cur.id)) { seg += `#${CSS.escape(cur.id)}`; parts.unshift(seg); break; }
      const cls = Array.from(cur.classList).filter(c => !/ophelia|bubble-element/.test(c)).slice(0, 2);
      if (cls.length) seg += '.' + cls.map(c => CSS.escape(c)).join('.');
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function _getXPath(el) {
    if (el.id && !_isFragileId(el.id)) return `//*[@id="${el.id}"]`;
    if (el === document.body) return '/html/body';
    if (!el.parentNode) return '';
    let ix = 0;
    const sibs = el.parentNode.childNodes;
    for (let i = 0; i < sibs.length; i++) {
      const s = sibs[i];
      if (s === el) return `${_getXPath(el.parentNode)}/${el.tagName.toLowerCase()}[${ix + 1}]`;
      if (s.nodeType === 1 && s.tagName === el.tagName) ix++;
    }
  }

  function _setDotLabel(text) {
    let lbl = document.getElementById('ophelia-dot-label');
    if (!text) { lbl?.remove(); return; }
    if (!lbl) {
      lbl = document.createElement('div');
      lbl.id = 'ophelia-dot-label';
      lbl.style.cssText = 'position:fixed; z-index:2147483647; pointer-events:none; background:rgba(9,9,13,0.88); color:#fff; font-size:11px; font-weight:500; padding:3px 9px; border-radius:9px; white-space:nowrap; border:1px solid rgba(255,122,26,0.35); backdrop-filter:blur(6px);';
      document.body.appendChild(lbl);
    }
    lbl.textContent = text;
    lbl.style.bottom = '24px'; lbl.style.right = '60px'; 
  }

  function _clearDotLabel() { document.getElementById('ophelia-dot-label')?.remove(); }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'streamingText') _setDotLabel(msg.text.slice(-80));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CREATOR_SESSION_KEY]) {
      const session = changes[CREATOR_SESSION_KEY].newValue;
      if (session && _isCreatorMode && _creatorLayer) {
        if (session.steps && session.steps.length !== _creatorLayer.pendingSteps.length) {
          _creatorLayer.stepIndex    = session.stepIndex || 0;
          _creatorLayer.pendingSteps = session.steps    || [];
          _creatorLayer.pendingNarrations = _rebuildNarrationPromises(_creatorLayer.pendingSteps);
          _setDotLabel(`🔴 Recording — Step ${_creatorLayer.stepIndex}`);
        }
      }
    }
  });

  function startAI(goal, trigger = 'What should I do?') {
    _goal      = goal;
    _messages  = [];
    _stepCount = 0;
    _analyze(trigger);
  }

  function startCreatorMode() {
    if (_isActive || _isLearning || _isCreatorMode) { stop(); return; }
    _startCreatorRecording();
  }

  function startGuide(guideOrId, startIndex) {
    return window.OpheliaPlayer.startGuide(guideOrId, startIndex);
  }

  function advanceGuide() { return false; }

  return { activate, stop, isActive, onSphereClick, startAI, startCreatorMode, resumeCreatorMode, pauseCreatorForTabSwitch, startGuide, advanceGuide };
})();

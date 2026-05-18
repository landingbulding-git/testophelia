// Ophelia Content Script - Coordinator
// Guide playback → player.js | Creator/AI assistant → assistant.js | Overlay UI → overlay.js
(() => {
  // -- Notification system (exposed globally for all content modules) -------

  window.OpheliaNotify = function(message, type = 'info', options = {}) {
    document.querySelectorAll('.ophelia-notification').forEach(n => n.remove());

    const colors = {
      info:    '#1a73e8',
      success: '#34a853',
      error:   '#ea4335',
      warning: '#fbbc04'
    };
    
    const el = document.createElement('div');
    el.className = 'ophelia-notification';
    Object.assign(el.style, {
      position:     'fixed',
      top:          '16px',
      right:        '16px',
      background:   '#1a1a1a',
      border:       `1.5px solid ${colors[type] || colors.info}`,
      borderRadius: '10px',
      color:        '#fff',
      fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize:     '13px',
      lineHeight:   '1.5',
      padding:      '12px 16px',
      zIndex:       '2147483644',
      maxWidth:     '360px',
      boxShadow:    '0 4px 20px rgba(0,0,0,0.4)',
      opacity:      '0',
      transition:   'opacity 0.25s ease',
      pointerEvents: options.button ? 'auto' : 'none',
      whiteSpace:   'pre-wrap',
      display:      'flex',
      flexDirection: 'column',
      gap:          '10px'
    });

    const textEl = document.createElement('div');
    textEl.textContent = message;
    el.appendChild(textEl);

    if (options.button) {
      const btn = document.createElement('button');
      btn.textContent = options.button.label;
      Object.assign(btn.style, {
        background: colors[type] || colors.info,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: 'bold',
        cursor: 'pointer',
        alignSelf: 'flex-start',
        transition: 'filter 0.15s ease'
      });
      btn.onmouseover = () => { btn.style.filter = 'brightness(1.1)'; };
      btn.onmouseout = () => { btn.style.filter = 'none'; };
      btn.onclick = (e) => {
        e.stopPropagation();
        options.button.onClick();
      };
      el.appendChild(btn);
    }

    document.body.appendChild(el);

    requestAnimationFrame(() => { el.style.opacity = '1'; });

    // Keep success messages with URLs or buttons visible longer
    const hasUrl = message.includes('http');
    const duration = (type === 'success' && (hasUrl || options.button)) ? 12000 : 4000;
    
    setTimeout(() => {
      if (!el.parentNode) return;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  };

  // -- Message routing from background.js and popup -------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'toggleSphere':
        // Ctrl+Shift+U -> open the AI assistant dialog
        window.OpheliaAssistant?.activate();
        sendResponse({ success: true });
        break;

      case 'startCreatorMode':
        window.OpheliaAssistant?.startCreatorMode();
        sendResponse({ success: true });
        break;

      case 'pauseCreatorForTabSwitch': {
        const session = window.OpheliaAssistant?.pauseCreatorForTabSwitch?.() ?? null;
        sendResponse({ session });
        break;
      }

      case 'resumeCreatorMode': {
        const tryResume = () => {
          if (window.OpheliaAssistant?.resumeCreatorMode) {
            window.OpheliaAssistant.resumeCreatorMode(msg.session);
          } else {
            setTimeout(tryResume, 150);
          }
        };
        tryResume();
        sendResponse({ ok: true });
        break;
      }

      case 'startGuide':
        window.OpheliaAssistant?.startGuide(msg.guideId || msg.guide, msg.stepIndex || 0);
        sendResponse({ success: true });
        break;

      case 'stopGuide':
        if (window.OpheliaPlayer?.stop) window.OpheliaPlayer.stop();
        sendResponse({ success: true });
        break;

      case 'getGuideState':
        sendResponse(window.OpheliaPlayer?.getState?.() || { playing: false });
        break;

      case 'resumeGuide': {
        const tryResumeGuide = () => {
          if (window.OpheliaPlayer?.startGuide) {
            window.OpheliaPlayer.startGuide(msg.guide, msg.stepIndex || 0);
          } else {
            setTimeout(tryResumeGuide, 200);
          }
        };
        tryResumeGuide();
        sendResponse({ ok: true });
        break;
      }

      case 'advanceGuide':
        window.OpheliaAssistant?.advanceGuide();
        sendResponse({ success: true });
        break;

    }
    return true;
  });

  // -- Direct keyboard shortcut (reliable fallback for chrome.commands) -----
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space' && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (window.opheliaTutorialActive) return; // guide auto-advances; don't interfere
      window.OpheliaAssistant?.activate();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.code === 'KeyU' && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      window.OpheliaAssistant?.activate(true);
    }
  }, true);

  // -- Init ------------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (document.getElementById('cross-tab-sphere')) return;
    createSphere();
    _checkGuideParam();
    _checkCreatorSession();
    _checkGuidePending();
  }

  function _checkGuidePending() {
    chrome.storage.local.get(['opheliaGuidePending'], (result) => {
      const pending = result.opheliaGuidePending;
      if (!pending?.guide) return;
      chrome.storage.local.remove('opheliaGuidePending');
      const tryResume = () => {
        if (window.OpheliaAssistant?.startGuide) {
          window.OpheliaAssistant.startGuide(pending.guide, pending.stepIndex || 0);
        } else {
          setTimeout(tryResume, 200);
        }
      };
      setTimeout(tryResume, 600);
    });
  }

  function _checkCreatorSession() {
    chrome.storage.local.get(['opheliaCreatorSession'], (result) => {
      const session = result.opheliaCreatorSession;
      if (!session?.active) return;
      const tryResume = () => {
        if (window.OpheliaAssistant?.resumeCreatorMode) {
          window.OpheliaAssistant.resumeCreatorMode(session);
        } else {
          setTimeout(tryResume, 200);
        }
      };
      tryResume(); // start immediately; retry every 200ms until assistant is ready
    });
  }

  function _checkGuideParam() {
    const params  = new URLSearchParams(window.location.search);
    const guideId = params.get('opheliaGuide');
    if (!guideId) return;
    // Wait for OpheliaAssistant to be ready then auto-start
    const tryStart = () => {
      if (window.OpheliaAssistant?.startGuide) {
        window.OpheliaAssistant.startGuide(guideId);
      } else {
        setTimeout(tryStart, 200);
      }
    };
    setTimeout(tryStart, 500);
  }

  // -- Sphere ----------------------------------------------------------------
  function createSphere() {
    const sphere = document.createElement('div');
    sphere.id = 'cross-tab-sphere';
    Object.assign(sphere.style, {
      position:     'fixed',
      width:        '18px',
      height:       '18px',
      background:   '#ff7a1a',
      borderRadius: '50%',
      bottom:       '20px',
      right:        '20px',
      cursor:       'pointer',
      zIndex:       '2147483645',
      opacity:      '0.85',
      boxShadow:    '0 0 16px #ff7a1a',
      transition:   'transform 0.1s ease-out, box-shadow 0.3s ease',
      pointerEvents:'auto'
    });
    sphere.title = 'Ophelia — click to talk (Ctrl+Space)';  
    sphere.addEventListener('click', handleSphereClick);
    document.body.appendChild(sphere);
    setupMouseFollowing(sphere);
  }

  function handleSphereClick() {
    if (window.OpheliaAssistant?.onSphereClick?.()) return;
    window.OpheliaAssistant?.activate();
  }

  function setupMouseFollowing(sphere) {
    let mx = window.innerWidth - 40, my = window.innerHeight - 40;
    let sx = mx, sy = my;
    let following   = false;
    let followTimer = null;
    let animFrame   = null;

    function animate() {
      if (!following || window.opheliaTutorialActive || window.OpheliaAssistant?.isActive()) {
        animFrame = null;
        return;
      }
      sx += (mx + 30 - sx) * 0.1;
      sy += (my + 30 - sy) * 0.1;
      sphere.style.left = `${sx}px`;
      sphere.style.top  = `${sy}px`;
      animFrame = requestAnimationFrame(animate);
    }

    document.addEventListener('mousemove', (e) => {
      // Disable following if assistant is active (e.g. Learning Mode)
      if (window.OpheliaAssistant?.isActive() || window.opheliaTutorialActive) return;

      mx = e.clientX;
      my = e.clientY;

      if (!following) {
        following = true;
        // Sync sx/sy to current sphere rect to avoid jumping from old position
        const r = sphere.getBoundingClientRect();
        if (r.width > 0) {
          sx = r.left;
          sy = r.top;
        }
        sphere.style.bottom = 'auto';
        sphere.style.right  = 'auto';
        if (!animFrame) animFrame = requestAnimationFrame(animate);
      }

      clearTimeout(followTimer);
      followTimer = setTimeout(() => {
        following = false;
        Object.assign(sphere.style, {
          bottom: '20px', right: '20px', left: 'auto', top: 'auto'
        });
      }, 2000);
    });
  }

})();

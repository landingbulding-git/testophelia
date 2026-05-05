// Ophelia Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  const btnStart    = document.getElementById('btnStart');
  const btnStop     = document.getElementById('btnStop');
  const recDot      = document.getElementById('recDot');
  const recText     = document.getElementById('recText');
  const stepCount   = document.getElementById('stepCount');
  const linkSection = document.getElementById('linkSection');
  const linkUrl     = document.getElementById('linkUrl');
  const btnCopy     = document.getElementById('btnCopy');
  const ttsSlider   = document.getElementById('ttsRate');

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function sendToTab(action, extra = {}) {
    const tab = await getActiveTab();
    if (!tab) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, { action, ...extra });
    } catch (e) {
      console.warn('Message failed:', e.message);
      return null;
    }
  }

  // ── Refresh UI from content script state ─────────────────────────────────

  async function refresh() {
    const state = await sendToTab('getRecordingState');

    if (state?.active) {
      recDot.classList.add('active');
      recText.innerHTML = `<strong>Recording…</strong>`;
      stepCount.textContent = `${state.stepCount} step${state.stepCount !== 1 ? 's' : ''}`;
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');
    } else {
      recDot.classList.remove('active');
      recText.textContent = 'Not recording';
      stepCount.textContent = '';
      btnStart.classList.remove('hidden');
      btnStop.classList.add('hidden');
    }

    // Show last tutorial URL if available
    const stored = await chrome.storage.local.get(['opheliaLastTutorialUrl']);
    if (stored.opheliaLastTutorialUrl) {
      linkUrl.textContent = stored.opheliaLastTutorialUrl;
      linkSection.classList.remove('hidden');
    }
  }

  // ── Button handlers ───────────────────────────────────────────────────────

  btnStart.addEventListener('click', async () => {
    await sendToTab('toggleRecording');
    // Brief delay to let content script update state, then re-poll
    setTimeout(refresh, 400);
  });

  btnStop.addEventListener('click', async () => {
    await sendToTab('toggleRecording');
    setTimeout(refresh, 600);
  });

  btnCopy.addEventListener('click', async () => {
    const url = linkUrl.textContent.trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      btnCopy.textContent = 'Copied!';
      setTimeout(() => { btnCopy.textContent = 'Copy link'; }, 2000);
    } catch (_) {
      btnCopy.textContent = 'Failed';
    }
  });

  // ── Poll while popup is open (recording step count updates) ──────────────

  // ── TTS rate slider ───────────────────────────────────────────────────────
  const { ttsRate } = await chrome.storage.sync.get('ttsRate');
  if (typeof ttsRate === 'number') ttsSlider.value = ttsRate;

  ttsSlider.addEventListener('input', () => {
    chrome.storage.sync.set({ ttsRate: parseFloat(ttsSlider.value) });
  });

  await refresh();
  const poll = setInterval(refresh, 1500);
  window.addEventListener('unload', () => clearInterval(poll));
});


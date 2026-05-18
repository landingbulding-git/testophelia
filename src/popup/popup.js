// Ophelia Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  const btnCreateGuide = document.getElementById('btnCreateGuide');
  const btnStopGuide   = document.getElementById('btnStopGuide');
  const guideList      = document.getElementById('guideList');
  const guideLinkInput = document.getElementById('guideLinkInput');
  const guideLinkGo    = document.getElementById('guideLinkGo');

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

  // ── Active Guide Check ──────────────────────────────────────────────────

  async function checkActiveGuide() {
    const state = await sendToTab('getGuideState');
    if (state?.playing) {
      btnStopGuide.classList.remove('hidden');
    } else {
      btnStopGuide.classList.add('hidden');
    }
  }

  btnStopGuide.addEventListener('click', async () => {
    await sendToTab('stopGuide');
    btnStopGuide.classList.add('hidden');
    window.close();
  });

  // ── Create Guide ──────────────────────────────────────────────────────────

  btnCreateGuide.addEventListener('click', async () => {
    await sendToTab('startCreatorMode');
    window.close();
  });

  // ── My Guides ─────────────────────────────────────────────────────────────

  async function loadGuides() {
    const tab = await getActiveTab();
    if (!tab?.url) return;
    const domain = new URL(tab.url).hostname;
    const stored = await chrome.storage.local.get(['opheliaGuides']);
    const guides = (stored.opheliaGuides || {})[domain] || [];

    guideList.innerHTML = '';
    if (guides.length === 0) {
      guideList.innerHTML = '<div style="color:#555;font-size:11px;">No guides saved for this site yet.</div>';
      return;
    }

    guides.slice().reverse().forEach(g => {
      const item = document.createElement('div');
      item.className = 'guide-item';

      const name = document.createElement('div');
      name.className = 'guide-item-name';
      name.title = g.name;
      name.textContent = g.name;

      const steps = document.createElement('div');
      steps.className = 'guide-item-steps';
      steps.textContent = `${g.stepCount} steps`;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'guide-item-copy';
      copyBtn.textContent = 'Link';
      copyBtn.title = g.shareUrl;
      copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(g.shareUrl);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = 'Link'; }, 1500);
      };

      const playBtn = document.createElement('button');
      playBtn.className = 'guide-item-play';
      playBtn.textContent = '▶';
      playBtn.onclick = async () => {
        await sendToTab('startGuide', { guideId: g.id });
        window.close();
      };

      item.appendChild(name);
      item.appendChild(steps);
      item.appendChild(copyBtn);
      item.appendChild(playBtn);
      guideList.appendChild(item);
    });
  }

  // ── Paste a link ──────────────────────────────────────────────────────────

  function extractGuideId(value) {
    const trimmed = value.trim();
    
    // 1. Try to extract from a query parameter (e.g. ?opheliaGuide=123-abc...)
    try {
      const url = new URL(trimmed);
      const idParam = url.searchParams.get('opheliaGuide');
      if (idParam && /^[0-9a-f-]{36}$/i.test(idParam)) return idParam;
    } catch (_) {} // Ignore URL parsing errors for bare strings

    // 2. Look for any valid 36-character UUID anywhere in the string
    const match = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (match) return match[1];

    return null;
  }

  guideLinkGo.addEventListener('click', async () => {
    const id = extractGuideId(guideLinkInput.value);
    if (!id) { guideLinkInput.style.borderColor = '#ff4444'; setTimeout(() => { guideLinkInput.style.borderColor = ''; }, 1500); return; }
    await sendToTab('startGuide', { guideId: id });
    window.close();
  });

  guideLinkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') guideLinkGo.click();
  });

  await loadGuides();
  await checkActiveGuide();
});


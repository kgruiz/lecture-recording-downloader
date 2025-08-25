(async () => {
  function formatBytes(n) {
    if (n == null) return 'unknown';
    const units = ['B','KB','MB','GB','TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function rangeToText(rr) {
    if (!rr) return 'n/a';
    const s = rr.start == null ? '' : rr.start;
    const e = rr.end == null ? '' : rr.end;
    return `${s}-${e}`;
  }

  function contentRangeText(cr) {
    if (!cr) return 'n/a';
    const size = cr.size == null ? '*' : cr.size;
    return `${cr.start}-${cr.end}/${size}`;
  }

  async function getActiveTabId() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0].id : undefined);
      });
    });
  }

  async function getActiveTabUrl() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0].url : undefined);
      });
    });
  }

  async function getStatusForTab(tabId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getStatusForTab', tabId }, (resp) => {
        resolve(resp);
      });
    });
  }

  async function download(url, referer, forceRange) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'downloadMp4', url, referer, forceRange }, (resp) => resolve(resp));
    });
  }

  const app = document.getElementById('app');
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('list');

  const tabId = await getActiveTabId();
  const tabUrl = await getActiveTabUrl();
  const resp = await getStatusForTab(tabId);

  if (!resp || !resp.ok) {
    statusEl.textContent = 'No MP4s detected on this page.';
    return;
  }

  const items = resp.data || [];

  if (items.length === 0) {
    statusEl.textContent = 'No MP4s detected on this page.';
    return;
  }

  const anyFull = items.some((x) => x.status === 'full');
  statusEl.textContent = anyFull ? 'Full file available for at least one MP4.' : 'Full file not detected yet. Some servers only serve partial ranges.';

  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'list-item';

    const urlEl = document.createElement('div');
    urlEl.className = 'url';
    urlEl.textContent = it.url;

    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.textContent = `status=${it.status}; size=${formatBytes(it.size)}; content-range=${contentRangeText(it.lastContentRange)}; request-range=${rangeToText(it.lastRequestRange)}; accept-ranges=${it.acceptRanges || 'n/a'}`;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'actions';

    const btn = document.createElement('button');
    btn.textContent = it.status === 'full' ? 'Download full' : 'Attempt download';
    if (it.status === 'full') btn.classList.add('primary');
    btn.addEventListener('click', async () => {
      const res = await download(it.url, tabUrl, true);
      if (!res || !res.ok) {
        alert(`Download failed: ${res && res.error ? res.error : 'Unknown error'}`);
      }
    });

    actionsEl.appendChild(btn);
    div.appendChild(urlEl);
    div.appendChild(metaEl);
    div.appendChild(actionsEl);
    listEl.appendChild(div);
  }
})();

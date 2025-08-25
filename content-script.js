(() => {
  function absoluteUrl(u) {
    try {
      return new URL(u, document.baseURI).toString();
    } catch {
      return null;
    }
  }

  function isHttpUrl(u) {
    try {
      const { protocol } = new URL(u);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  function looksLikeMp4(u) {
    return typeof u === 'string' && u.toLowerCase().includes('.mp4');
  }

  function collectMp4Urls() {
    const urls = new Set();

    // video[src]
    document.querySelectorAll('video[src]')
      .forEach((el) => {
        const u = absoluteUrl(el.getAttribute('src'));
        if (u && isHttpUrl(u) && looksLikeMp4(u)) urls.add(u);
      });

    // video source[src]
    document.querySelectorAll('video source[src]')
      .forEach((el) => {
        const u = absoluteUrl(el.getAttribute('src'));
        if (u && isHttpUrl(u) && looksLikeMp4(u)) urls.add(u);
      });

    // a[href$=".mp4"]
    document.querySelectorAll('a[href$=".mp4" i]')
      .forEach((el) => {
        const u = absoluteUrl(el.getAttribute('href'));
        if (u && isHttpUrl(u) && looksLikeMp4(u)) urls.add(u);
      });

    return Array.from(urls);
  }

  function sendList() {
    const urls = collectMp4Urls();
    if (urls.length === 0) return;
    try {
      chrome.runtime.sendMessage({ type: 'collectMp4s', urls });
    } catch (_) {}
  }

  // Initial send on idle
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(sendList, 0);
  } else {
    window.addEventListener('DOMContentLoaded', sendList, { once: true });
  }

  // Observe DOM mutations for new candidates
  const mo = new MutationObserver(() => {
    // Debounce
    if (sendList._t) clearTimeout(sendList._t);
    sendList._t = setTimeout(sendList, 500);
  });
  try {
    mo.observe(document.documentElement || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
  } catch (_) {}
})();

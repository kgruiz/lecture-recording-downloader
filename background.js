// In-memory state per tab: Map<tabId, Map<url, Mp4Record>>
const TAB_STATE = new Map();

// Pending download header injection support
const PENDING_DOWNLOAD_URLS = new Set();
const PENDING_HEADERS_BY_URL = new Map(); // url -> Array<{name, value}>

/**
 * @typedef {{ start: number|null, end: number|null } | null} RangeReq
 * @typedef {{ start: number, end: number, size: number|null } | null} ContentRange
 * @typedef {{
 *   url: string,
 *   size: number|null,
 *   contentType: string|null,
 *   acceptRanges: string|null,
 *   lastSeen: number,
 *   lastRequestRange: RangeReq,
 *   lastContentRange: ContentRange,
 *   status: 'unknown'|'full'
 * }} Mp4Record
 */

function nowMs() {
  return Date.now();
}

function getOrCreateTabMap(tabId) {
  if (!TAB_STATE.has(tabId)) {
    TAB_STATE.set(tabId, new Map());
  }
  return TAB_STATE.get(tabId);
}

function looksLikeMp4Url(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return url.toLowerCase().includes('.mp4');
}

function ensureRecord(tabId, url) {
  const map = getOrCreateTabMap(tabId);
  if (!map.has(url)) {
    /** @type {Mp4Record} */
    const rec = {
      url,
      size: null,
      contentType: null,
      acceptRanges: null,
      lastSeen: nowMs(),
      lastRequestRange: null,
      lastContentRange: null,
      status: 'unknown'
    };
    map.set(url, rec);
  } else {
    map.get(url).lastSeen = nowMs();
  }
  return map.get(url);
}

function getHeader(headers, name) {
  if (!headers) return null;
  const lname = name.toLowerCase();
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === lname) return h.value || '';
  }
  return null;
}

function setOrAddHeader(headers, name, value) {
  const lname = name.toLowerCase();
  let found = false;
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === lname) {
      h.value = value;
      found = true;
      break;
    }
  }
  if (!found) headers.push({ name, value });
}

// Header parsing utilities
// ParseContentRange: "bytes <start>-<end>/<size|*>"
function ParseContentRange(value) {
  if (!value) return null;
  const v = value.trim();
  const m = /^bytes\s+(\d+)-(\d+)/(\d+|\*)$/i.exec(v);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const size = m[3] === '*' ? null : Number(m[3]);
  if (Number.isNaN(start) || Number.isNaN(end) || (size !== null && Number.isNaN(size))) return null;
  return { start, end, size };
}

// ParseRangeRequest: "bytes=<start?>-<end?>"
function ParseRangeRequest(value) {
  if (!value) return null;
  const v = value.trim();
  const m = /^bytes\s*=\s*(\d+)?-(\d+)?$/i.exec(v);
  if (!m) return null;
  const start = m[1] !== undefined ? Number(m[1]) : null;
  const end = m[2] !== undefined ? Number(m[2]) : null;
  if ((start !== null && Number.isNaN(start)) || (end !== null && Number.isNaN(end))) return null;
  return { start, end };
}

function decideFull(rec) {
  const cr = rec.lastContentRange;
  if (cr && cr.size != null && cr.start === 0 && cr.end === cr.size - 1) {
    rec.status = 'full';
    return;
  }
  // If content-type is mp4 and accept-ranges is none, and we have size from 200, treat as full
  if (rec.contentType === 'video/mp4') {
    if (rec.acceptRanges === 'none' || rec.acceptRanges == null) {
      if (rec.size != null) {
        rec.status = 'full';
        return;
      }
    }
  }
}

function normalizeContentType(value) {
  if (!value) return null;
  const low = value.toLowerCase();
  const semi = low.indexOf(';');
  const typeOnly = semi >= 0 ? low.slice(0, semi).trim() : low.trim();
  return typeOnly;
}

function upsertByResponse(details) {
  const url = details.url;
  const tabId = details.tabId;
  const headers = details.responseHeaders || [];
  const contentType = normalizeContentType(getHeader(headers, 'Content-Type'));
  const acceptRanges = (getHeader(headers, 'Accept-Ranges') || '').toLowerCase() || null;
  const contentRangeRaw = getHeader(headers, 'Content-Range');
  const cr = ParseContentRange(contentRangeRaw || '');
  const statusCode = details.statusCode;

  // Determine if this is an MP4 response
  const isMp4 = (contentType === 'video/mp4') || looksLikeMp4Url(url);
  if (!isMp4) return; // Ignore non-mp4

  // Guard tab id
  if (typeof tabId !== 'number' || tabId < 0) return;

  const rec = ensureRecord(tabId, url);
  rec.contentType = contentType || rec.contentType;
  rec.acceptRanges = acceptRanges;
  rec.lastContentRange = cr;
  rec.lastSeen = nowMs();

  if (statusCode === 200) {
    const cl = getHeader(headers, 'Content-Length');
    if (cl && /^\d+$/.test(cl)) {
      rec.size = Number(cl);
    }
  }
  if (cr && cr.size != null) {
    rec.size = cr.size;
  }

  decideFull(rec);
}

function recordOutboundRange(details) {
  const { url, tabId, requestHeaders } = details;
  if (typeof tabId !== 'number' || tabId < 0) return;
  if (!looksLikeMp4Url(url)) return;
  const rangeVal = getHeader(requestHeaders || [], 'Range');
  const rr = ParseRangeRequest(rangeVal || '');
  if (!rr) return;
  const rec = ensureRecord(tabId, url);
  rec.lastRequestRange = rr;
  rec.lastSeen = nowMs();
}

// Download logic
async function StartDownload(url, referer, forceRange) {
  const headerStrings = [];
  const headerObjs = [];
  if (forceRange) {
    headerStrings.push('Range: bytes=0-');
    headerObjs.push({ name: 'Range', value: 'bytes=0-' });
  }
  if (referer) {
    headerStrings.push(`Referer: ${referer}`);
    headerObjs.push({ name: 'Referer', value: referer });
  }

  // Prepare fallback injection
  PENDING_DOWNLOAD_URLS.add(url);
  PENDING_HEADERS_BY_URL.set(url, headerObjs.slice());

  return new Promise((resolve) => {
    try {
      // Note: headers may not be honored; fallback injection handles it.
      chrome.downloads.download({ url, saveAs: true, headers: headerStrings }, (id) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || 'unknown error';
          resolve({ ok: false, error: msg });
          return;
        }
        resolve({ ok: true, downloadId: id });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

// webRequest listeners
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Inject headers for pending downloads initiated by the extension
    try {
      if (PENDING_DOWNLOAD_URLS.has(details.url)) {
        const initiator = details.initiator || details.originUrl || '';
        if (initiator && initiator.startsWith(`chrome-extension://${chrome.runtime.id}`)) {
          const inject = PENDING_HEADERS_BY_URL.get(details.url) || [];
          const headers = details.requestHeaders || [];
          for (const h of inject) {
            setOrAddHeader(headers, h.name, h.value);
          }
          // Clean up; only need to inject once
          PENDING_DOWNLOAD_URLS.delete(details.url);
          PENDING_HEADERS_BY_URL.delete(details.url);
          return { requestHeaders: headers };
        }
      }
    } catch (_) {
      // ignore
    }

    // Record outbound Range for mp4-like URLs
    try {
      recordOutboundRange(details);
    } catch (_) {
      // ignore
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "blocking", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    try {
      upsertByResponse(details);
    } catch (_) {
      // ignore
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

// Messaging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'collectMp4s') {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId === 'number' && tabId >= 0) {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      const map = getOrCreateTabMap(tabId);
      for (const u of urls) {
        if (!u) continue;
        ensureRecord(tabId, u);
      }
      // Trim old records not seen recently? Keep simple for now.
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'getStatusForTab') {
    const tabId = msg.tabId;
    const map = (typeof tabId === 'number') ? (TAB_STATE.get(tabId) || new Map()) : new Map();
    const arr = Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen);
    sendResponse({ ok: true, data: arr });
    return true;
  }
  if (msg.type === 'downloadMp4') {
    const url = msg.url;
    const referer = msg.referer || undefined;
    const forceRange = !!msg.forceRange;
    StartDownload(url, referer, forceRange).then((result) => {
      sendResponse(result);
    });
    return true; // async
  }
});

// Cleanup when tabs close
chrome.tabs && chrome.tabs.onRemoved && chrome.tabs.onRemoved.addListener((tabId) => {
  if (TAB_STATE.has(tabId)) {
    TAB_STATE.delete(tabId);
  }
});

// Expose parsers for testing (optional)
// eslint-disable-next-line no-unused-vars
const __test = { ParseContentRange, ParseRangeRequest };

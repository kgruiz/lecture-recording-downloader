# MP4 Full Download Detector (Chrome Extension)

Detects MP4 files on the current page, determines if a full-file download is available, shows status/size, and offers a download button. All processing is local; no analytics and no data leaves your machine.

## Features

- Detects MP4 URLs from the DOM (`<video>`, `<source>`, and direct `.mp4` links) and from network activity.
- Determines if a full download is available via response/request headers.
- Shows each MP4 with status and size (when known).
- Provides “Download full” when full is available, else shows an info message and “Attempt download.”
- Works across typical sites; handles redirects and query-stringed URLs.

## How it works (high level)

- Content script scans the DOM for likely MP4 URLs and reports them.
- Background service worker observes request and response headers using the `webRequest` API and tracks per-tab MP4 records.
- A popup lists detected MP4s and their status, and triggers downloads via `chrome.downloads.download`.
- Downloads attempt to include `Range: bytes=0-` and `Referer: <active-tab-url>`. If Chrome ignores headers on downloads, a guarded header-injection fallback is used in the `onBeforeSendHeaders` hook.

## “Full” detection rules

An MP4 is marked as full if any of the following are observed for that URL:

1. `206` with `Content-Range: bytes 0-(size-1)/size`.
2. `200` with `Content-Length == size` and `Accept-Ranges: none`.
3. `200` with `Content-Length` and no `Accept-Ranges` header at all.

If only partial ranges appear, status remains not full. If the server uses `Content-Range: bytes 0-N/*` (unknown total), the item is not marked full.

## Install (Load Unpacked)

1. Go to `chrome://extensions`.
2. Enable “Developer mode”.
3. Click “Load unpacked” and select this project folder.
4. Pin the extension for quick access.

No build step or dependencies are required.

## Usage

1. Open a page with MP4s (embedded or linked).
2. Click the extension icon to open the popup.
3. Review the status line:
   - “Full file available for at least one MP4.”
   - or “Full file not detected yet. Some servers only serve partial ranges.”
4. For each MP4 entry:
   - See URL, size (when known), last `Content-Range`, last request `Range`, and status.
   - Click “Download full” if available; otherwise “Attempt download.”
5. If a download fails, the popup will show an alert with the error message.

## Permissions and rationale

- `activeTab`: Retrieve active tab info (e.g., `Referer` URL for downloads).
- `scripting`: Standard capability for content scripts (used by MV3 environment).
- `downloads`: Trigger file downloads and set headers.
- `storage`: Reserved for potential future preferences; not currently used for remote storage.
- `webRequest`, `webRequestBlocking`: Observe and, for fallback, inject headers into outgoing requests.
- `host_permissions: <all_urls>`: Observe MP4 traffic and DOM on any site the user visits.

## Privacy & security

- No analytics or remote calls.
- No PII exfiltration; all processing is local in the browser.
- Only observes headers necessary to determine MP4 availability.
- Honors site authentication; if a user lacks access, downloads will fail accordingly.

## File structure

- `manifest.json`: MV3 manifest with permissions, background, and popup.
- `background.js`: Service worker; tracks MP4s, parses headers, decides “full”, handles downloads.
- `content-script.js`: Scans DOM for MP4 URLs and notifies background; re-scans on DOM mutations.
- `popup.html` / `popup.css` / `popup.js`: Popup UI listing MP4s, statuses, and actions.

## Development

- Dependencies: none. The extension uses only built-in Chrome APIs.
- Optional enhancements for local dev (not required): TypeScript, ESLint/Prettier, bundler.
- Packaging: zip the folder and load via “Load unpacked”, or submit to the Chrome Web Store after following their guidelines.

## Test plan

Create three endpoints and embed them on a test page via `<video src>`, `<source>`, and `<a>`:

1. Full file: returns `200` with `Content-Length` and `Accept-Ranges: none`, or serves `206` with `Content-Range: bytes 0-(size-1)/size` when asked.
2. Partial-only: always returns `206` with nonzero start regardless of request.
3. Unknown size: returns `206` with `Content-Range: bytes 0-N/*`.

Verify:

- Detection/listing within ~2 seconds of load.
- “Download full” exists for case 1 and works.
- Info message and “Attempt download” for cases 2 and 3; expect failure or partial depending on server.
- Redirects, query strings, and authenticated resources behave as expected.

## Troubleshooting

- Server always returns partial (`206`) with nonzero start: this is a partial-only server; full may not be available.
- `Content-Range: bytes 0-N/*`: total unknown; will not be marked full.
- Headers on download not honored: the fallback injector attempts to set `Range`/`Referer`; if blocked by the browser or server, the request may still fail.
- Auth-required URLs: downloads rely on your browser session; if not authorized, the server will deny the request.

## Limitations

- No DRM bypass.
- No M3U8 or DASH assembly.
- No merging of partial byte ranges.
- Blob URLs or MSE streams are ignored (cannot download via HTTP).

## License

See `LICENSE`.

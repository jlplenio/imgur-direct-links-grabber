# Imgur Direct Link Grabber backlog

The current priority is maintaining working URL extraction, previews, formatting, and downloads. The ideas below were saved from the October 4, 2026 review at the user's request. They are deferred and are not commitments to implement them in the maintenance pass.

## Feature ideas

- Select individual media items, select all, and copy or download only the selection.
- Filter images and videos and remove duplicate links.
- Restore original album order and undo a shuffle.
- Accept multiple album URLs, show per-album errors, and organize ZIP contents into album folders.
- Show download progress, allow cancellation, and retry individual failed items.
- Add per-item copy URL, open original, and download actions.
- Export TXT, JSON, and CSV, optionally including source album, media type, dimensions, and a URL manifest in ZIP downloads.
- Remember the preferred output format locally.
- Offer optional local recent-album history with a clear-history control.
- Improve touch viewing with swipe and zoom and show available keyboard shortcuts.
- Make the funding prompt dismissible for a session or a longer period.

## Operational followups

- Add deployment-aware quota protection and short-lived caching with request coalescing. Choose a shared store or hosting controls before implementing limits across serverless instances; count individual tRPC operations, including batched calls.
- Preserve more upstream metadata, including MIME type, dimensions, available video variants, and thumbnails, in a structured API response.
- Use lightweight image thumbnails and consider virtualization for very large galleries.
- Add browser regression coverage for keyboard navigation, mobile layouts, clipboard permissions, and large downloads.
- Track error rates and upstream latency from structured logs. The October 4 export contained only ten requests and does not establish long-term service reliability.
- Replace Next 15's pinned PostCSS 8.4.31 when a compatible upstream release is available. Direct PostCSS is updated, but Next's nested copy still has [CSS serialization](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) and [source-map file disclosure](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) advisories. Exploitation requires attacker-controlled CSS or source-map input; this app currently processes repository CSS during builds.
- Follow the [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) through Tailwind 3 and the lint tooling. The installed braces 3.0.3 has no compatible patched release in the current dependency tree; this is a build/watch concern involving malicious glob patterns, which the app does not accept from users.
- Resolve the remaining minimatch 9 copies in glob and TypeScript ESLint 6, then validate linting and builds. A [regular-expression denial-of-service advisory](https://github.com/advisories/GHSA-23c5-xmqv-rm74) affects versions below 9.0.7; a scoped update to 9.0.9 is available, but the parser pins 9.0.3 and needs a tested override or toolchain update. These glob patterns are used by repository tooling, not the public URL endpoint.

## Suggested order

Finish and validate maintenance fixes first. Then prioritize selection, media filters, and download progress based on actual usage, followed by batch processing and additional exports.

# imgur.plen.io

Hosted here: https://imgur.plen.io/

Extract direct image, GIF, and video links from public Imgur posts in your browser. This application replaces the [previous version](https://github.com/jlplenio/imgur-direct-links).

The application exports to static HTML, CSS, and JavaScript. Your browser reads Imgur's public embed metadata and media directly; no application backend, Imgur API key, or environment file is required.

## Features

- Extract media links from public albums, galleries, single-image posts, and direct media URLs.
- Preview images, GIFs, and videos, then copy all links as plain text, BBCode, HTML, or Markdown.
- Shuffle results and download all media together as a ZIP archive.
- Cancel lookups or ZIP downloads while they run; changing albums also cancels any pending download.
- Keep verified GIFs as GIFs, with the available MP4 alternative retained.

## Dependencies

- React
- Tailwind CSS
- Radix UI for icons
- Browser utilities for reading public Imgur embeds and downloading media

## Development

Use Node.js 22, as specified in `.nvmrc`:

```sh
npm ci
npm run dev
```

Next.js provides the local development server. The production application uses only static files and browser requests. Existing local `.env` files are not needed for Imgur extraction.

## Static build and local preview

```sh
npm run build
npm start
```

The build generates `out/`. `npm start` serves that directory at `http://127.0.0.1:3000` using the included Node static server. It does not run Next.js or expose API routes. Build again after changing the application.

Use `npm start -- --port 4000` to change the port. To allow other devices on your network, use `npm start -- --host 0.0.0.0 --port 4000`. `HOST` and `PORT` environment variables are also supported; command-line flags take precedence. The server supports GET, HEAD, media byte ranges, and exported 404 pages.

For deployment, publish the contents of `out/` to a static host. Use `npm ci && npm run build` as the build command and `out` as the publish directory. Configure clean URLs to resolve `/design-preview` to `/design-preview.html`, and use `404.html` for missing routes. No Node process, functions, API proxy, or Imgur credentials are needed at runtime. Serve the site over HTTPS so browser clipboard features work.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Regression tests use mocked Imgur responses and downloads, plus a temporary local static server. They require no credentials or live Imgur requests. CI runs these checks and verifies the static export.

## Supported behavior

- Album, gallery, and single-image page links are accepted. Pasted whitespace, tracking parameters, fragments, and a trailing slash are normalized before extracting the resource ID. Direct media links can be used immediately; `.gifv` links are wrappers and require reading their public embed.
- When an embed exposes an MP4 but indicates a possible GIF, the browser probes the GIF header and dimensions. A verified GIF can be offered alongside its MP4 alternative; an unavailable or unverified candidate keeps the working MP4. This does not establish that a recovered GIF is byte-for-byte identical to the original upload.
- Plain URLs, BBCode, HTML, and Markdown exports preserve media order. Video exports use video elements or ordinary links where appropriate.
- ZIP downloads use up to four simultaneous requests, a 30-second deadline per file, and a 200 MiB total source-media limit. ZIP packaging needs additional browser memory. Filenames include their original position to avoid collisions and preserve order.
- Extraction depends on Imgur's public embed format, availability, and browser CORS permissions. Private or removed media cannot be recovered. If an embed is unavailable, the app reports the failure; there is no server fallback or API credential to configure.

Deferred feature ideas and operational followups are recorded in [the backlog](docs/BACKLOG.md).

**Disclaimer:** This tool is not affiliated with or endorsed by Imgur and is intended for personal use. Please use responsibly and adhere to Imgur's Terms of Service.

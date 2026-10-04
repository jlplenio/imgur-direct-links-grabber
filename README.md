# Imgur Direct Link Grabber v2

Hosted here: https://imgur.plen.io/

The Imgur Direct Link Grabber is a web application designed to extract direct image links from any given Imgur gallery URL. It's built using modern web technologies and provides a simple and intuitive user interface that ensures ease of use. It replaces the previous web application, because heroku got too expensive: https://github.com/jlplenio/imgur-direct-links

## Features

- **Gallery URL Input**: Users can enter an Imgur gallery URL into the input field to retrieve direct links to images.
- **Image Links Display**: The direct links to the images are displayed in a read-only textarea, allowing for easy review.
- **Copy to Clipboard**: Users can copy the displayed image links to their clipboard.
- **Shuffle and Tag**: Users can shuffle image links and add tags.

## Dependencies

- React
- Tailwind CSS
- Radix UI for icons
- Custom API and utilities for handling Imgur URLs

## Development

Use Node.js 22, as specified in `.nvmrc`. Install dependencies with `npm ci`, copy `.env.example` to `.env`, and set `IMGURCLIENTID` to your Imgur API Client ID. Keep this value on the server; it must not use a `NEXT_PUBLIC_` prefix.

Run `npm run dev` for local development. For production, run `npm run build` followed by `npm start`. Configure `IMGURCLIENTID` in the deployment environment before building and serving the app.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Regression tests use mocked upstream responses and downloads; they do not require a real Imgur credential or make live Imgur requests. CI uses a placeholder Client ID to validate the build without exposing credentials.

## Supported behavior

- Album, gallery, and single-image page links are accepted. Pasted whitespace, tracking parameters, fragments, and a trailing slash are normalized before extracting the resource ID.
- Plain URLs, BBCode, HTML, and Markdown exports preserve media order. Video exports use video elements or ordinary links where appropriate.
- ZIP downloads use up to four simultaneous requests, a 30-second deadline per file, and a 200 MiB total source-media limit. ZIP packaging needs additional browser memory. Filenames include their original position to avoid collisions and preserve order.
- A missing upstream resource is reported as not found. This does not establish why Imgur made it unavailable.

Deferred feature ideas and operational followups are recorded in [the backlog](docs/BACKLOG.md).

**Disclaimer:** This tool is not affiliated with or endorsed by Imgur and is intended for personal use. Please use responsibly and adhere to Imgur's Terms of Service.

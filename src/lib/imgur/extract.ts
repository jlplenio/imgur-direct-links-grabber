import type { GifCandidate, ImgurCollection, ImgurMediaItem } from "./types";

/**
 * Read public Imgur embed documents as data. No remote JavaScript is executed.
 * Observed templates: https://imgur.com/a/lDRB2/embed and ?pub=true (2026-10-04).
 */
const MAX_HTML_LENGTH = 8 * 1024 * 1024;
const RESOURCE_ID = /^[a-zA-Z0-9]{3,64}$/;
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

export class EmbedParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EmbedParseError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new EmbedParseError(code, message);
}

function validateInput(html: string, expectedId: string): void {
  if (typeof expectedId !== "string" || !RESOURCE_ID.test(expectedId)) {
    fail("INVALID_RESOURCE_ID", "The requested Imgur ID is invalid.");
  }
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    html.length > MAX_HTML_LENGTH
  ) {
    fail(
      "INVALID_INPUT",
      "The embed document is empty or exceeds the parser limit.",
    );
  }
}

function scriptsIn(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(
    (match) => match[1]!,
  );
}

/** Extract one JSON object without evaluating its enclosing JavaScript. */
function objectAt(source: string, offset: number): unknown {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = offset; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(source.slice(offset, index + 1));
      } catch {
        fail("MALFORMED_DATA", "The embed contains invalid JSON data.");
      }
    }
  }
  fail("MALFORMED_DATA", "The embed JSON data is truncated.");
}

function readObject(source: string, pattern: RegExp): unknown {
  const match = pattern.exec(source);
  return match
    ? objectAt(source, match.index + match[0].lastIndexOf("{"))
    : undefined;
}

function checkResourceId(value: unknown, expectedId: string): void {
  if (value !== undefined && value !== expectedId) {
    fail(
      "RESOURCE_MISMATCH",
      "The embed belongs to a different Imgur resource.",
    );
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dimension(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_MEDIA", "The embed contains invalid media dimensions.");
  }
  return value;
}

function mediaItem(image: unknown): ImgurMediaItem {
  if (
    !object(image) ||
    typeof image.hash !== "string" ||
    !RESOURCE_ID.test(image.hash)
  ) {
    fail("INVALID_MEDIA", "The embed contains an invalid media ID.");
  }
  if (
    typeof image.ext !== "string" ||
    (!IMAGE_EXTENSIONS.has(image.ext) && !VIDEO_EXTENSIONS.has(image.ext))
  ) {
    fail("INVALID_MEDIA", "The embed contains an unsupported media extension.");
  }
  for (const field of ["animated", "prefer_video"]) {
    if (image[field] !== undefined && typeof image[field] !== "boolean") {
      fail("INVALID_MEDIA", "The embed contains invalid animation metadata.");
    }
  }
  const item: ImgurMediaItem = {
    id: image.hash,
    url: `https://i.imgur.com/${image.hash}${image.ext}`,
    type: VIDEO_EXTENSIONS.has(image.ext) ? "video" : "image",
    animated:
      typeof image.animated === "boolean"
        ? image.animated
        : VIDEO_EXTENSIONS.has(image.ext),
    width: dimension(image.width),
    height: dimension(image.height),
  };
  // Preserve original GIFs. An alternate playback URL is explicitly separate.
  if (
    image.ext === ".gif" &&
    image.animated === true &&
    image.prefer_video === true
  ) {
    item.videoUrl = `https://i.imgur.com/${image.hash}.mp4`;
  }
  return item;
}

function mediaList(value: unknown): ImgurMediaItem[] {
  if (
    !object(value) ||
    typeof value.count !== "number" ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    !Array.isArray(value.images)
  ) {
    fail("MALFORMED_DATA", "The embed has no valid media list and count.");
  }
  if (value.count !== value.images.length) {
    fail("INCOMPLETE_ALBUM", "The embed does not contain the complete album.");
  }
  return value.images.map(mediaItem);
}

export function parseAlbumEmbed(
  html: string,
  expectedId: string,
): ImgurCollection {
  validateInput(html, expectedId);
  const candidates = scriptsIn(html).filter(
    (source) =>
      /\bImgur\.Album\.getInstance\s*\(/.test(source) ||
      /^\s*var\s+images\s*=\s*\{/m.test(source),
  );
  if (candidates.length === 0) {
    fail("NOT_ALBUM_EMBED", "The document is not a supported album embed.");
  }
  if (candidates.length !== 1) {
    fail("MALFORMED_DATA", "The document contains ambiguous album data.");
  }
  const source = candidates[0]!;
  const rawAlbum = readObject(source, /^\s*album\s*:\s*\{/m);
  const album = object(rawAlbum) ? rawAlbum : undefined;
  if (rawAlbum !== undefined && !object(rawAlbum)) {
    fail("MALFORMED_DATA", "The embed album metadata is invalid.");
  }
  const legacyId =
    /\bImgur\.Album\.getInstance\s*\(\s*\{\s*id\s*:\s*(['"])(.*?)\1/.exec(
      source,
    );
  const resourceIds = [album?.id, legacyId?.[2]].filter(
    (value) => value !== undefined,
  );
  for (const match of source.matchAll(
    /^\s*(?:var\s+)?albumHash\s*=\s*(['"])(.*?)\1/gm,
  )) {
    resourceIds.push(match[2]!);
  }
  if (resourceIds.length === 0) {
    fail("MISSING_RESOURCE_ID", "The embed does not identify its Imgur album.");
  }
  for (const id of resourceIds) checkResourceId(id, expectedId);
  const list =
    readObject(source, /^\s*images\s*:\s*\{/m) ??
    readObject(source, /^\s*var\s+images\s*=\s*\{/m) ??
    album?.album_images;
  const items = mediaList(list);
  if (album?.album_images !== undefined) {
    const duplicateList = mediaList(album.album_images);
    if (
      duplicateList.length !== items.length ||
      duplicateList.some((item, index) => item.url !== items[index]!.url)
    ) {
      fail("MALFORMED_DATA", "The embed contains conflicting album lists.");
    }
  }
  if (
    album?.num_images !== undefined &&
    (!/^\d+$/.test(String(album.num_images)) ||
      Number(album.num_images) !== items.length)
  ) {
    fail("INCOMPLETE_ALBUM", "The embed does not contain the complete album.");
  }
  if (
    album?.title !== undefined &&
    album.title !== null &&
    typeof album.title !== "string"
  ) {
    fail("MALFORMED_DATA", "The embed album title is invalid.");
  }
  return {
    id: expectedId,
    title: album?.title ?? null,
    count: items.length,
    items,
  };
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const match of tag.matchAll(
    /\s([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    const name = match[1]!.toLowerCase();
    if (Object.hasOwn(result, name)) {
      fail("MALFORMED_DATA", "The embed contains ambiguous HTML attributes.");
    }
    result[name] = (match[2] ?? match[3] ?? match[4])!;
  }
  return result;
}

function originalFromSource(
  value: unknown,
  expectedId: string,
  allowedExtensions: ReadonlySet<string>,
  allowThumbnailOriginal = false,
) {
  if (typeof value !== "string" || /[\s\\<>]/.test(value)) return undefined;
  let url;
  try {
    url = new URL(value, "https://imgur.com");
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "i.imgur.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    return undefined;
  const match = /^\/([a-zA-Z0-9]+)(\.[a-z0-9]+)$/.exec(url.pathname);
  if (!match || !allowedExtensions.has(match[2]!)) return undefined;
  if (match[1] !== expectedId) {
    // This opt-in yields a candidate: the caller must verify its response MIME.
    if (
      match[1]!.startsWith(expectedId) &&
      /^[sbtmlh]$/.test(match[1]!.slice(expectedId.length))
    ) {
      if (allowThumbnailOriginal === true) {
        url.pathname = `/${expectedId}${match[2]}`;
        return {
          url: url.href,
          extension: match[2]!,
          originalFromThumbnail: true,
        };
      }
      return undefined;
    }
    fail(
      "RESOURCE_MISMATCH",
      "The embed belongs to a different Imgur resource.",
    );
  }
  return { url: url.href, extension: match[2]! };
}

/** Parse the embed's flat literal object; reject expressions and computed keys. */
function literalObjectAt(
  source: string,
  start: number,
): Record<string, unknown> {
  let index = start;
  function invalid(): never {
    fail("MALFORMED_DATA", "The embed contains invalid video metadata.");
  }
  const whitespace = () => {
    while (index < source.length && /\s/.test(source[index]!)) index++;
  };
  const string = (): string => {
    const quote = source[index++];
    let value = "";
    while (index < source.length) {
      let character = source[index++]!;
      if (character === quote) return value;
      if (character.charCodeAt(0) < 32) invalid();
      if (character === "\\") {
        const escape = source[index++]!;
        const escapes: Record<string, string> = {
          "\\": "\\",
          "/": "/",
          "'": "'",
          '"': '"',
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (Object.hasOwn(escapes, escape)) character = escapes[escape]!;
        else if (
          escape === "u" &&
          /^[0-9a-fA-F]{4}$/.test(source.slice(index, index + 4))
        ) {
          character = String.fromCharCode(
            Number.parseInt(source.slice(index, index + 4), 16),
          );
          index += 4;
        } else invalid();
      }
      value += character;
    }
    invalid();
  };
  const literal = (): unknown => {
    if (source[index] === '"' || source[index] === "'") return string();
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(index),
      );
    if (!match) invalid();
    index += match[0].length;
    const value: unknown = JSON.parse(match[0]);
    if (typeof value === "number" && !Number.isFinite(value)) invalid();
    return value;
  };
  const fields: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  if (source[index++] !== "{") invalid();
  while (index < source.length) {
    whitespace();
    if (source[index] === "}") return fields;
    let key;
    if (source[index] === '"' || source[index] === "'") key = string();
    else {
      const match = /^[a-zA-Z_$][\w$]*/.exec(source.slice(index));
      if (!match) invalid();
      key = match[0];
      index += key.length;
    }
    if (
      Object.hasOwn(fields, key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      invalid();
    whitespace();
    if (source[index++] !== ":") invalid();
    whitespace();
    fields[key] = literal();
    whitespace();
    if (source[index] === "}") return fields;
    if (source[index++] !== ",") invalid();
  }
  invalid();
}

function gifCandidateFromEmbed(
  html: string,
  expectedId: string,
): GifCandidate | undefined {
  const candidates = scriptsIn(html).flatMap((source) =>
    [...source.matchAll(/\bvar\s+videoItem\s*=\s*\{/g)].map((match) =>
      literalObjectAt(source, match.index + match[0].lastIndexOf("{")),
    ),
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) {
    fail("MALFORMED_DATA", "The embed contains ambiguous video metadata.");
  }
  const metadata = candidates[0]!;
  if (metadata.hash !== expectedId) {
    fail(
      "RESOURCE_MISMATCH",
      "The embed belongs to a different Imgur resource.",
    );
  }
  const source = originalFromSource(
    metadata.gifUrl,
    expectedId,
    new Set([".gif"]),
  );
  if (
    !source ||
    typeof metadata.size !== "number" ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size <= 0 ||
    typeof metadata.width !== "number" ||
    !Number.isSafeInteger(metadata.width) ||
    metadata.width <= 0 ||
    typeof metadata.height !== "number" ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height <= 0
  ) {
    fail("INVALID_MEDIA", "The embed contains invalid GIF candidate metadata.");
  }
  // This is only a candidate. Uploaded MP4s expose the same gifUrl metadata.
  return {
    url: source.url,
    size: metadata.size,
    width: metadata.width,
    height: metadata.height,
  };
}

export function parseSingleEmbed(
  html: string,
  expectedId: string,
  { allowThumbnailOriginal = false }: { allowThumbnailOriginal?: boolean } = {},
): ImgurCollection {
  validateInput(html, expectedId);
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  let original;
  for (const match of markup.matchAll(/<source\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const candidate = originalFromSource(
      attrs.src,
      expectedId,
      VIDEO_EXTENSIONS,
    );
    if (candidate && (!original || candidate.extension === ".mp4"))
      original = candidate;
  }
  if (!original) {
    for (const match of markup.matchAll(/<img\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.id !== "image-element") continue;
      const candidate = originalFromSource(
        attrs.src,
        expectedId,
        IMAGE_EXTENSIONS,
        allowThumbnailOriginal,
      );
      if (candidate) original = candidate;
    }
  }
  if (!original) {
    fail(
      "UNRESOLVED_ORIGINAL",
      "The embed does not establish an original media URL.",
    );
  }
  const type = VIDEO_EXTENSIONS.has(original.extension) ? "video" : "image";
  const gifCandidate =
    type === "video" ? gifCandidateFromEmbed(html, expectedId) : undefined;
  return {
    id: expectedId,
    title: null,
    count: 1,
    items: [
      {
        id: expectedId,
        url: original.url,
        type,
        animated: type === "video" || original.extension === ".gif",
        width: null,
        height: null,
        ...(original.originalFromThumbnail
          ? { originalFromThumbnail: true }
          : {}),
        ...(gifCandidate ? { gifCandidate } : {}),
      },
    ],
  };
}

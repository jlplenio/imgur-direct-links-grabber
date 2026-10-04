import extractLinkInfo from "../../utils/link-cleaner";
import type { ImgurResult, ResolveOptions } from "./types";

import { parseAlbumEmbed, parseSingleEmbed } from "./extract";
import { verifyGifCandidate } from "./verify-gif";

export class LookupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LookupError";
    this.code = code;
  }
}

export type ImgurInput =
  | { id: string; kind: "album" | "gallery" | "image" }
  | { id: string; kind: "direct"; url: string };
export function parseInput(value: string): ImgurInput {
  const resource = typeof value === "string" ? extractLinkInfo(value) : null;
  if (!resource)
    throw new LookupError(
      "INPUT",
      "Enter a valid Imgur album, gallery, image, or direct media URL.",
    );
  const url = new URL(value.trim());
  if (url.hostname === "i.imgur.com" && !/\.gifv\/?$/i.test(url.pathname)) {
    url.protocol = "https:";
    url.pathname = url.pathname.replace(/\/$/, "");
    url.hash = "";
    return { id: resource.albumId, kind: "direct", url: url.href };
  }
  return { id: resource.albumId, kind: resource.linkType };
}

const mediaType = (url: string): "image" | "video" =>
  /\.(mp4|webm)$/i.test(new URL(url).pathname) ? "video" : "image";

async function readText(response: Response): Promise<string> {
  const maxBytes = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new LookupError(
      "SIZE",
      "Imgur returned an unexpectedly large listing.",
    );
  if (!response.body)
    throw new LookupError("SCHEMA", "Imgur returned an empty response.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new LookupError(
          "SIZE",
          "Imgur returned an unexpectedly large listing.",
        );
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function resolveImgur(
  input: string,
  { signal, timeoutMs = 12000, fetchImpl = fetch }: ResolveOptions = {},
): Promise<ImgurResult> {
  const resource = parseInput(input);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new LookupError("INPUT", "The request timeout must be positive.");
  if (signal?.aborted) throw new LookupError("ABORTED", "Lookup canceled.");
  if (resource.kind === "direct")
    return {
      id: resource.id,
      title: "Direct media link",
      source: "direct",
      count: 1,
      requests: 0,
      items: [
        {
          id: resource.id,
          url: resource.url,
          type: mediaType(resource.url),
          animated: /\.(gif|mp4|webm)(\?|$)/i.test(resource.url),
          width: null,
          height: null,
        },
      ],
    };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("The listing request timed out.", "TimeoutError"),
      ),
    timeoutMs,
  );
  let rejectAbort: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () =>
      reject(
        controller.signal.reason ?? new DOMException("Canceled", "AbortError"),
      );
    if (controller.signal.aborted) rejectAbort();
    else
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  let requests = 0;
  const get = async (url: string): Promise<string> => {
    requests++;
    const response = await Promise.race([
      fetchImpl(url, {
        credentials: "omit",
        mode: "cors",
        redirect: "error",
        signal: controller.signal,
        referrerPolicy: "no-referrer",
      }),
      aborted,
    ]);
    if (!response.ok)
      throw new LookupError(
        `HTTP_${response.status}`,
        response.status === 404
          ? "This Imgur item was not found."
          : response.status === 429
            ? "Imgur is rate limiting requests. Please try again later."
            : `Imgur returned HTTP ${response.status}.`,
      );
    return Promise.race([readText(response), aborted]);
  };
  try {
    if (resource.kind !== "image") {
      try {
        const result = parseAlbumEmbed(
          await get(`https://imgur.com/a/${resource.id}/embed`),
          resource.id,
        );
        controller.signal.throwIfAborted();
        return { ...result, source: "embed", requests };
      } catch (error) {
        // Gallery URLs can identify either an album or a single image. Only retry
        // a different public resource shape for transport/not-found failures.
        if (
          resource.kind !== "gallery" ||
          controller.signal.aborted ||
          !(
            error instanceof TypeError ||
            (error instanceof LookupError && error.code === "HTTP_404")
          )
        )
          throw error;
      }
    }
    const result = parseSingleEmbed(
      await get(`https://imgur.com/${resource.id}/embed`),
      resource.id,
      { allowThumbnailOriginal: true },
    );
    for (const item of result.items) {
      if (item.gifCandidate) {
        const verification = await verifyGifCandidate(item.gifCandidate, {
          signal: controller.signal,
          fetchImpl,
          onRequest: () => {
            requests++;
          },
        });
        controller.signal.throwIfAborted();
        delete item.gifCandidate;
        item.gifVerification = verification;
        if (verification.status === "verified") {
          item.videoUrl = item.url;
          item.url = verification.url;
          item.type = "image";
          item.animated = true;
          item.width = verification.width;
          item.height = verification.height;
          item.gifVerified = true;
        } else if (verification.status === "unverified") {
          item.note =
            "GIF availability could not be confirmed. The playable MP4 is provided.";
        }
      }
      if (!item.originalFromThumbnail) continue;
      requests++;
      const response = await Promise.race([
        fetchImpl(item.url, {
          method: "HEAD",
          credentials: "omit",
          mode: "cors",
          redirect: "error",
          signal: controller.signal,
          referrerPolicy: "no-referrer",
        }),
        aborted,
      ]);
      const extensions: Record<string, string> = {
        "image/jpeg": ".jpeg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/avif": ".avif",
      };
      const extension =
        extensions[
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() ?? ""
        ];
      if (!response.ok || !extension)
        throw new LookupError(
          "UNRESOLVED_ORIGINAL",
          "Imgur could not confirm the original image. Please try again later.",
        );
      item.url = `https://i.imgur.com/${item.id}${extension}`;
      item.animated = extension === ".gif";
      item.originalVerified = true;
    }
    controller.signal.throwIfAborted();
    return { ...result, source: "embed", requests };
  } catch (error) {
    if (controller.signal.aborted)
      throw new LookupError(
        signal?.aborted ? "ABORTED" : "TIMEOUT",
        signal?.aborted
          ? "Lookup canceled."
          : "Imgur took too long to respond.",
      );
    if (error instanceof TypeError)
      throw new LookupError(
        "NETWORK",
        "Imgur did not provide a readable response. The item may be unavailable, redirected, or blocked by the browser or network.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort!);
    controller.abort();
  }
}

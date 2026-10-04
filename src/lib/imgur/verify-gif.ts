import type { GifCandidate, GifVerification } from "./types";

export type VerifyGifOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: () => void;
};

// A .gif suffix and even HTTP 200 are insufficient: Imgur can return JPEGs.
// Inspect the GIF header without downloading the whole animation.
export async function verifyGifCandidate(
  candidate: GifCandidate,
  {
    signal,
    timeoutMs = 3000,
    fetchImpl = fetch,
    onRequest = () => undefined,
  }: VerifyGifOptions = {},
): Promise<GifVerification> {
  const unverified = (reason: string): GifVerification => ({
    status: "unverified",
    reason,
  });
  if (
    !candidate ||
    typeof candidate.url !== "string" ||
    !/^https:\/\/i\.imgur\.com\/[a-zA-Z0-9]{3,64}\.gif$/.test(candidate.url) ||
    ![candidate.width, candidate.height].every(
      (dimension) =>
        Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 65535,
    ) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    return unverified("invalid-candidate");
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Canceled", "AbortError");

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("GIF verification timed out", "TimeoutError"),
      ),
    timeoutMs,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortListener: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () =>
      reject(
        controller.signal.reason ?? new DOMException("Canceled", "AbortError"),
      );
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    onRequest();
    const response = await Promise.race([
      fetchImpl(candidate.url, {
        headers: { Range: "bytes=0-12" },
        credentials: "omit",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      }),
      aborted,
    ]);
    if (![200, 206].includes(response.status))
      return unverified(`http-${response.status}`);
    if (response.redirected || (response.url && response.url !== candidate.url))
      return unverified("unexpected-url");
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mime !== "image/gif")
      return { status: "not-gif", reason: "content-type" };
    let totalBytes = null;
    // Content-Range is often not exposed through CORS. Never mistake the
    // range's Content-Length for the full file size.
    const contentRange = response.headers.get("content-range");
    if (response.status === 206 && contentRange !== null) {
      const range = /^bytes 0-(\d+)\/(\d+|\*)$/.exec(contentRange);
      if (
        !range ||
        !Number.isSafeInteger(Number(range[1])) ||
        Number(range[1]) < 12 ||
        (range[2] !== "*" &&
          (!Number.isSafeInteger(Number(range[2])) ||
            Number(range[2]) <= Number(range[1])))
      )
        return unverified("invalid-range");
      if (range[2] !== "*") totalBytes = Number(range[2]);
    } else if (response.status === 200) {
      const length = response.headers.get("content-length");
      if (
        length !== null &&
        /^\d+$/.test(length) &&
        Number.isSafeInteger(Number(length))
      )
        totalBytes = Number(length);
    }
    if (!response.body) return unverified("empty-body");
    reader = response.body.getReader();
    const prefix = new Uint8Array(13);
    let received = 0;
    while (received < prefix.length) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) return unverified("truncated-header");
      const take = Math.min(value.byteLength, prefix.length - received);
      prefix.set(value.subarray(0, take), received);
      received += take;
    }
    const signature = String.fromCharCode(...prefix.subarray(0, 6));
    if (signature !== "GIF87a" && signature !== "GIF89a")
      return { status: "not-gif", reason: "signature" };
    const width = prefix[6]! | (prefix[7]! << 8);
    const height = prefix[8]! | (prefix[9]! << 8);
    if (
      !width ||
      !height ||
      width !== candidate.width ||
      height !== candidate.height
    )
      return unverified("dimensions");
    return {
      status: "verified",
      url: candidate.url,
      width,
      height,
      bytesRead: received,
      totalBytes,
      // Historical page size can differ from the current CDN file. A mismatch
      // does not make a correctly identified GIF invalid, nor prove provenance.
      sizeMatchesMetadata:
        totalBytes === null || !Number.isSafeInteger(candidate.size)
          ? null
          : totalBytes === candidate.size,
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return unverified(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    controller.signal.removeEventListener("abort", abortListener!);
    // Do not wait on an uncooperative cancellation callback. Abort the native
    // fetch as well, so ignored Range responses cannot keep downloading.
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    controller.abort();
  }
}

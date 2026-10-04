type DownloadItem = {
  url: string;
  type: "image" | "video";
};

type DownloadOptions = {
  fetcher?: typeof fetch;
  concurrency?: number;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function filenameFor(item: DownloadItem, index: number, count: number) {
  const basename = new URL(item.url).pathname.split("/").pop() ?? "";
  const safeName = basename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const extension = item.type === "video" ? "mp4" : "jpg";
  const filename = /\.[a-zA-Z0-9]+$/.test(safeName)
    ? safeName
    : `${safeName || "media"}.${extension}`;
  const position = String(index + 1).padStart(
    Math.max(3, String(count).length),
    "0",
  );
  return `${position}_${filename}`;
}

/** Download a bounded amount of media and preserve its order in the archive. */
export async function createMediaZip(
  items: readonly DownloadItem[],
  {
    fetcher = fetch,
    concurrency = 4,
    timeoutMs = 30_000,
    maxBytes = MAX_DOWNLOAD_BYTES,
    signal,
  }: DownloadOptions = {},
): Promise<{ blob: Blob; successCount: number; failedUrls: string[] }> {
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error("Download cancelled.");
  };
  throwIfCancelled();
  if (items.length === 0)
    throw new Error("There are no media items to download.");
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error("Invalid download limits.");
  }

  const { default: JSZip } = await import("jszip");
  const results = new Array<Uint8Array | undefined>(items.length);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  let nextIndex = 0;
  let retainedBytes = 0;
  let sizeError: Error | undefined;

  const enforceSizeLimit = (incomingBytes: number) => {
    if (retainedBytes + incomingBytes > maxBytes) {
      sizeError ??= new Error(
        "This download is too large to package safely in this browser. Open the original links to download the files individually.",
      );
      controller.abort();
      throw sizeError;
    }
  };

  const worker = async () => {
    while (nextIndex < items.length && !controller.signal.aborted) {
      const index = nextIndex++;
      const item = items[index]!;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      const timer = setTimeout(abortRequest, timeoutMs);
      let itemBytes = 0;

      try {
        const response = await fetcher(item.url, {
          signal: requestController.signal,
          mode: "cors",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Media download failed.");
        const contentType = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        if (
          contentType &&
          !/^(image\/|video\/|application\/octet-stream$)/.test(contentType)
        ) {
          throw new Error("The media URL did not return an image or video.");
        }
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 0) {
          enforceSizeLimit(contentLength);
        }
        if (!response.body) throw new Error("The media response was empty.");

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            enforceSizeLimit(value.byteLength);
            retainedBytes += value.byteLength;
            itemBytes += value.byteLength;
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        } finally {
          reader.releaseLock();
        }
        if (itemBytes === 0) throw new Error("The media response was empty.");
        const content = new Uint8Array(itemBytes);
        let offset = 0;
        for (const chunk of chunks) {
          content.set(chunk, offset);
          offset += chunk.byteLength;
        }
        results[index] = content;
      } catch {
        retainedBytes -= itemBytes;
      } finally {
        requestController.abort();
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abortRequest);
      }
    }
  };

  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    // Cancellation may have happened while the ZIP module was loading.
    throwIfCancelled();
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, worker),
    );
    throwIfCancelled();
    if (sizeError) throw sizeError;

    const zip = new JSZip();
    const failedUrls: string[] = [];
    let successCount = 0;
    items.forEach((item, index) => {
      const content = results[index];
      if (content) {
        zip.file(filenameFor(item, index, items.length), content);
        successCount++;
      } else {
        failedUrls.push(item.url);
      }
    });
    if (successCount === 0) {
      throw new Error(
        "Could not download any media. Try again or open the original links.",
      );
    }
    const blob = await zip.generateAsync({ type: "blob" });
    throwIfCancelled();
    return { blob, successCount, failedUrls };
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    controller.abort();
  }
}

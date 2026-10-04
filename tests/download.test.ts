import assert from "node:assert/strict";
import { test } from "node:test";
import { getEventListeners } from "node:events";
import JSZip from "jszip";
import { createMediaZip } from "../src/utils/download";

const image = (url: string) => ({ url, type: "image" as const });

await test("ZIP preserves order and duplicate basenames without overwriting", async () => {
  let calls = 0;
  const result = await createMediaZip(
    [
      image("https://i.imgur.com/same.jpg?first"),
      image("https://i.imgur.com/same.jpg?second"),
    ],
    {
      fetcher: async () =>
        new Response(`image ${++calls}`, {
          headers: { "content-type": "image/jpeg" },
        }),
    },
  );
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(result.successCount, 2);
  assert.deepEqual(result.failedUrls, []);
  assert.deepEqual(Object.keys(zip.files), ["001_same.jpg", "002_same.jpg"]);
  assert.equal(await zip.file("001_same.jpg")?.async("string"), "image 1");
  assert.equal(await zip.file("002_same.jpg")?.async("string"), "image 2");
});

await test("ZIP reports failed items and skips HTML error pages returned with status 200", async () => {
  const urls = [
    "https://i.imgur.com/good.jpg",
    "https://i.imgur.com/gone.jpg",
    "https://i.imgur.com/error.jpg",
  ];
  const result = await createMediaZip(urls.map(image), {
    fetcher: async (input) => {
      if (input === urls[1]) return new Response(null, { status: 404 });
      if (input === urls[2])
        return new Response("<html>Error</html>", {
          headers: { "content-type": "text/html" },
        });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    },
  });
  assert.equal(result.successCount, 1);
  assert.deepEqual(result.failedUrls, urls.slice(1));
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files), ["001_good.jpg"]);
});

await test("ZIP bounds simultaneous downloads", async () => {
  let active = 0;
  let maximum = 0;
  const result = await createMediaZip(
    Array.from({ length: 9 }, (_, index) =>
      image(`https://i.imgur.com/${index}.jpg`),
    ),
    {
      concurrency: 2,
      fetcher: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return new Response(new Uint8Array([1]));
      },
    },
  );
  assert.equal(maximum, 2);
  assert.equal(result.successCount, 9);
});

await test("ZIP aborts stalled requests and does not report an empty archive as success", async () => {
  let aborted = false;
  await assert.rejects(
    createMediaZip([image("https://i.imgur.com/stalled.jpg")], {
      timeoutMs: 10,
      fetcher: async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    }),
    /Could not download any media/,
  );
  assert.equal(aborted, true);
});

await test("ZIP enforces its byte budget even without Content-Length", async () => {
  await assert.rejects(
    createMediaZip([image("https://i.imgur.com/large.jpg")], {
      maxBytes: 4,
      fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4, 5])),
    }),
    /too large/,
  );
});

await test("ZIP byte budget applies across files and failed downloads release their budget", async () => {
  await assert.rejects(
    createMediaZip(
      [
        image("https://i.imgur.com/first.jpg"),
        image("https://i.imgur.com/second.jpg"),
      ],
      {
        maxBytes: 4,
        fetcher: async () => new Response(new Uint8Array([1, 2, 3])),
      },
    ),
    /too large/,
  );

  let first = true;
  const result = await createMediaZip(
    [
      image("https://i.imgur.com/failed.jpg"),
      image("https://i.imgur.com/good.jpg"),
    ],
    {
      maxBytes: 4,
      concurrency: 1,
      fetcher: async () => {
        if (!first) return new Response(new Uint8Array([1, 2, 3]));
        first = false;
        let read = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (read) controller.error(new Error("Connection lost"));
              else {
                read = true;
                controller.enqueue(new Uint8Array([1, 2, 3]));
              }
            },
          }),
        );
      },
    },
  );
  assert.equal(result.successCount, 1);
  assert.deepEqual(result.failedUrls, ["https://i.imgur.com/failed.jpg"]);
});

await test("ZIP rejects pre-cancelled work without making any requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  await assert.rejects(
    createMediaZip([image("https://i.imgur.com/first.jpg")], {
      signal: controller.signal,
      fetcher: async () => {
        fetched = true;
        return new Response(new Uint8Array([1]));
      },
    }),
    /Download cancelled\./,
  );
  assert.equal(fetched, false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

await test("ZIP cancellation aborts every active worker and never starts queued downloads", async () => {
  const controller = new AbortController();
  let fetched = 0;
  let aborted = 0;
  await assert.rejects(
    createMediaZip(
      Array.from({ length: 6 }, (_, index) =>
        image(`https://i.imgur.com/${index}.jpg`),
      ),
      {
        signal: controller.signal,
        concurrency: 3,
        fetcher: (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            fetched++;
            options?.signal?.addEventListener(
              "abort",
              () => {
                aborted++;
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
            if (fetched === 3) controller.abort();
          }),
      },
    ),
    /Download cancelled\./,
  );
  assert.equal(fetched, 3);
  assert.equal(aborted, 3);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

await test("ZIP cancellation rejects instead of delivering already completed files as a partial archive", async () => {
  const controller = new AbortController();
  let fetched = 0;
  await assert.rejects(
    createMediaZip(
      [
        image("https://i.imgur.com/completed.jpg"),
        image("https://i.imgur.com/pending.jpg"),
      ],
      {
        signal: controller.signal,
        concurrency: 1,
        fetcher: async () => {
          if (++fetched === 1) return new Response(new Uint8Array([1, 2, 3]));
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
      },
    ),
    /Download cancelled\./,
  );
  assert.equal(fetched, 2);
});

await test("ZIP checks cancellation after archive generation", async (context) => {
  const controller = new AbortController();
  context.mock.method(JSZip.prototype, "generateAsync", async () => {
    controller.abort();
    return new Blob(["finished archive"]);
  });
  await assert.rejects(
    createMediaZip([image("https://i.imgur.com/first.jpg")], {
      signal: controller.signal,
      fetcher: async () => new Response(new Uint8Array([1])),
    }),
    /Download cancelled\./,
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

await test("ZIP removes its caller cancellation listener when archive generation throws", async (context) => {
  const controller = new AbortController();
  context.mock.method(JSZip.prototype, "generateAsync", async () => {
    throw new Error("Archive generation failed");
  });
  await assert.rejects(
    createMediaZip([image("https://i.imgur.com/first.jpg")], {
      signal: controller.signal,
      fetcher: async () => new Response(new Uint8Array([1])),
    }),
    /Archive generation failed/,
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

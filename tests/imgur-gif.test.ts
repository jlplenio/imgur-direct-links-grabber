import assert from "node:assert/strict";
import test from "node:test";
import { verifyGifCandidate } from "../src/lib/imgur/verify-gif";

const candidate = {
  url: "https://i.imgur.com/ABCDE.gif",
  size: 4096,
  width: 320,
  height: 240,
};

function gifHeader({ signature = "GIF89a", width = 320, height = 240 } = {}) {
  const bytes = new Uint8Array(13);
  bytes.set(new TextEncoder().encode(signature).subarray(0, 6));
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function response(
  body: BodyInit | null = gifHeader(),
  {
    status = 206,
    headers = {},
  }: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "image/gif",
      ...(status === 206
        ? { "content-range": "bytes 0-12/4096", "content-length": "13" }
        : {}),
      ...headers,
    },
  });
}

void test("verifies both GIF signatures and uses a single credential-free bounded range request", async () => {
  for (const signature of ["GIF87a", "GIF89a"]) {
    let calls = 0,
      requests = 0,
      init: RequestInit | undefined;
    const result = await verifyGifCandidate(candidate, {
      onRequest: () => {
        requests++;
      },
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, candidate.url);
        init = options;
        return response(gifHeader({ signature }), {
          headers: { "content-type": "Image/GIF; charset=binary" },
        });
      },
    });
    assert.ok(result.status === "verified");
    assert.equal(result.url, candidate.url);
    assert.equal(result.width, 320);
    assert.equal(result.height, 240);
    assert.equal(result.bytesRead, 13);
    assert.equal(result.totalBytes, 4096);
    assert.equal(result.sizeMatchesMetadata, true);
    assert.equal("originalVerified" in result, false);
    assert.equal(calls, 1);
    assert.equal(requests, 1);
    assert.ok(init);
    assert.equal(new Headers(init.headers).get("Range"), "bytes=0-12");
    assert.equal(init.credentials, "omit");
    assert.equal(init.mode, "cors");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(
      init.signal?.aborted,
      true,
      "transport should be stopped once the prefix is checked",
    );
  }
});

void test("reconstructs a header split across every byte boundary and cancels the remainder", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      for (const byte of gifHeader()) controller.enqueue(Uint8Array.of(byte));
    },
    cancel() {
      canceled = true;
    },
  });
  const result = await verifyGifCandidate(candidate, {
    fetchImpl: async () => response(body),
  });
  assert.ok(result.status === "verified");
  assert.equal(result.bytesRead, 13);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

void test("an ignored Range and oversized chunk retain only 13 bytes and stop downloading", async () => {
  let pulls = 0,
    canceled = false;
  const chunk = new Uint8Array(1024 * 1024);
  chunk.set(gifHeader());
  const body = new ReadableStream(
    {
      pull(controller) {
        pulls++;
        if (pulls > 1)
          throw new Error(
            "The verifier tried to download the entire animation",
          );
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const result = await verifyGifCandidate(candidate, {
    fetchImpl: async () =>
      response(body, {
        status: 200,
        headers: { "content-length": String(50 * 1024 * 1024) },
      }),
  });
  assert.ok(result.status === "verified");
  assert.equal(result.bytesRead, 13);
  assert.equal(result.totalBytes, 50 * 1024 * 1024);
  assert.equal(result.sizeMatchesMetadata, false);
  assert.equal(pulls, 1);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

void test("historical metadata size differences are diagnostic, not GIF rejection", async () => {
  const result = await verifyGifCandidate(candidate, {
    fetchImpl: async () =>
      response(gifHeader(), {
        headers: { "content-range": "bytes 0-12/4125" },
      }),
  });
  assert.ok(result.status === "verified");
  assert.equal(result.totalBytes, 4125);
  assert.equal(result.sizeMatchesMetadata, false);
  assert.equal("originalVerified" in result, false);
});

void test("hidden range totals never mistake the 13-byte response length for the file size", async () => {
  for (const range of [null, "bytes 0-12/*"]) {
    const headers = new Headers({
      "content-type": "image/gif",
      "content-length": "13",
    });
    if (range) headers.set("content-range", range);
    const result = await verifyGifCandidate(candidate, {
      fetchImpl: async () =>
        new Response(gifHeader(), { status: 206, headers }),
    });
    assert.ok(result.status === "verified");
    assert.equal(result.totalBytes, null);
    assert.equal(result.sizeMatchesMetadata, null);
  }
});

void test("rejects malformed, wrong-start, short, impossible and unsafe visible ranges", async () => {
  for (const range of [
    "nonsense",
    "bytes 1-13/4096",
    "bytes 0-5/4096",
    "bytes 0-12/12",
    "bytes 0-12/0",
    "bytes 0-12/9007199254740993",
    "bytes 0-9007199254740993/*",
  ]) {
    const result = await verifyGifCandidate(candidate, {
      fetchImpl: async () =>
        response(gifHeader(), { headers: { "content-range": range } }),
    });
    assert.equal(result.status, "unverified", range);
  }
});

void test("requires both GIF MIME and GIF bytes, rejecting removed-image and HTML placeholders", async () => {
  const cases = [
    response(gifHeader(), { headers: { "content-type": "image/jpeg" } }),
    response(gifHeader(), { headers: { "content-type": "video/mp4" } }),
    response(gifHeader(), { headers: { "content-type": "text/html" } }),
    response(gifHeader(), {
      headers: { "content-type": "application/octet-stream" },
    }),
    response(new TextEncoder().encode("<html>Removed</html>")),
    response(
      Uint8Array.from([0xff, 0xd8, 0xff, ...new Array<number>(10).fill(0)]),
    ),
    response(
      Uint8Array.from([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        ...new Array<number>(5).fill(0),
      ]),
    ),
    response(gifHeader({ signature: "GIF00a" })),
  ];
  for (const item of cases) {
    const result = await verifyGifCandidate(candidate, {
      fetchImpl: async () => item,
    });
    assert.equal(result.status, "not-gif");
    assert.equal("url" in result, false);
  }
});

void test("empty or truncated GIF prefixes and incorrect dimensions remain unverified", async () => {
  for (const body of [
    null,
    new Uint8Array(),
    gifHeader().subarray(0, 5),
    gifHeader().subarray(0, 12),
    gifHeader({ width: 0 }),
    gifHeader({ height: 0 }),
    gifHeader({ width: 1, height: 1 }),
    gifHeader({ width: 240, height: 320 }),
  ]) {
    const result = await verifyGifCandidate(candidate, {
      fetchImpl: async () => response(body),
    });
    assert.ok(result.status === "unverified");
  }
});

void test("foreign, credential-bearing and malformed candidate URLs never reach fetch", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("Unexpected request");
  };
  for (const url of [
    "http://i.imgur.com/ABCDE.gif",
    "https://evil.example/ABCDE.gif",
    "https://i.imgur.com.evil.example/ABCDE.gif",
    "https://user@i.imgur.com/ABCDE.gif",
    "https://i.imgur.com:443/ABCDE.gif",
    "https://i.imgur.com/ABCDE.gif?x=1",
    "https://i.imgur.com/ABCDE.gif#x",
    "https://i.imgur.com/ABCDE.mp4",
    "https://i.imgur.com/../ABCDE.gif",
  ]) {
    assert.equal(
      (await verifyGifCandidate({ ...candidate, url }, { fetchImpl })).status,
      "unverified",
      url,
    );
  }
  for (const dimensions of [
    { width: 0 },
    { height: -1 },
    { width: 65536 },
    { height: 1.5 },
    { width: NaN },
  ]) {
    assert.equal(
      (await verifyGifCandidate({ ...candidate, ...dimensions }, { fetchImpl }))
        .status,
      "unverified",
    );
  }
  for (const timeoutMs of [0, -1, Infinity, NaN]) {
    assert.equal(
      (await verifyGifCandidate(candidate, { fetchImpl, timeoutMs })).status,
      "unverified",
    );
  }
  assert.equal(called, false);
});

void test("non-success status, redirect and CORS failures leave the candidate unverified", async () => {
  for (const status of [304, 404, 410, 429, 500]) {
    const result = await verifyGifCandidate(candidate, {
      fetchImpl: async () => new Response(null, { status }),
    });
    assert.ok(result.status === "unverified");
  }
  const redirected = response();
  Object.defineProperty(redirected, "redirected", { value: true });
  assert.equal(
    (await verifyGifCandidate(candidate, { fetchImpl: async () => redirected }))
      .status,
    "unverified",
  );
  const foreign = response();
  Object.defineProperty(foreign, "url", {
    value: "https://i.imgur.com/removed.gif",
  });
  assert.equal(
    (await verifyGifCandidate(candidate, { fetchImpl: async () => foreign }))
      .status,
    "unverified",
  );
  const cors = await verifyGifCandidate(candidate, {
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(cors.status, "unverified");
});

void test("local expiry bounds an unresponsive fetch even when the mock ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  const result = await verifyGifCandidate(candidate, {
    timeoutMs: 15,
    fetchImpl: (_url, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    },
  });
  assert.ok(result.status === "unverified");
  assert.equal(result.reason, "timeout");
  assert.equal(signal?.aborted, true);
});

void test("local expiry also bounds a stalled body and releases its reader", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(gifHeader().subarray(0, 5));
    },
    cancel() {
      canceled = true;
    },
  });
  const result = await verifyGifCandidate(candidate, {
    timeoutMs: 15,
    fetchImpl: async () => response(body),
  });
  assert.ok(result.status === "unverified");
  assert.equal(result.reason, "timeout");
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

void test("cancellation cleanup cannot hold a verified result hostage", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(gifHeader());
    },
    cancel() {
      return new Promise(() => undefined);
    },
  });
  const result = await verifyGifCandidate(candidate, {
    timeoutMs: 15,
    fetchImpl: async () => response(body),
  });
  assert.ok(result.status === "verified");
  assert.equal(body.locked, false);
});

void test("caller cancellation propagates during fetch, body reading and before any request", async () => {
  const before = new AbortController();
  before.abort(new DOMException("Canceled before request", "AbortError"));
  await assert.rejects(
    verifyGifCandidate(candidate, {
      signal: before.signal,
      fetchImpl: () => {
        throw new Error("Should not fetch");
      },
    }),
    (error) => error === before.signal.reason,
  );

  const during = new AbortController();
  const waiting = verifyGifCandidate(candidate, {
    signal: during.signal,
    fetchImpl: () => new Promise(() => undefined),
  });
  during.abort(new DOMException("Canceled during request", "AbortError"));
  await assert.rejects(waiting, (error) => error === during.signal.reason);

  const bodyAbort = new AbortController();
  let started: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const body = new ReadableStream(
    {
      pull() {
        started();
      },
    },
    { highWaterMark: 0 },
  );
  const request = verifyGifCandidate(candidate, {
    signal: bodyAbort.signal,
    fetchImpl: async () => response(body),
  });
  await reading;
  bodyAbort.abort(new DOMException("Overall deadline", "TimeoutError"));
  await assert.rejects(request, (error) => error === bodyAbort.signal.reason);
  assert.equal(body.locked, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LookupError, parseInput, resolveImgur } from "../src/lib/imgur";
import { EmbedParseError } from "../src/lib/imgur/extract";

const albumUrl = "https://imgur.com/a/abcde";
const album = `<script>
var album = Imgur.Album.getInstance({
id: 'abcde',
images: {"count":2,"images":[{"hash":"ABCDE","ext":".gif","animated":true,"prefer_video":true,"width":420,"height":221},{"hash":"FGHIJ","ext":".mp4","width":200,"height":100}]}
});</script>`;
const single = '<img id="image-element" src="//i.imgur.com/abcde.gif">';
const animated = `<script>
var videoItem = {hash:'abcde',gifUrl:'//i.imgur.com/abcde.gif',size:4505699,width:420,height:221};
</script><source src="//i.imgur.com/abcde.mp4" type="video/mp4">`;
const code = (expected: string) => (error: unknown) =>
  (error instanceof LookupError || error instanceof EmbedParseError) &&
  error.code === expected;

function sequence(...responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected extra network request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

function gifResponse() {
  const bytes = new Uint8Array(13);
  bytes.set(new TextEncoder().encode("GIF89a"));
  const view = new DataView(bytes.buffer);
  view.setUint16(6, 420, true);
  view.setUint16(8, 221, true);
  return new Response(bytes, {
    status: 206,
    headers: { "content-type": "image/gif" },
  });
}

void test("normalizes supported collection hosts and slugs without losing resource kind", () => {
  for (const host of ["imgur.com", "www.imgur.com", "m.imgur.com"]) {
    assert.deepEqual(
      parseInput(` https://${host}/gallery/a-title-abcde/?share=1#x `),
      { id: "abcde", kind: "gallery" },
    );
  }
  assert.deepEqual(parseInput(albumUrl), { id: "abcde", kind: "album" });
  assert.deepEqual(parseInput("https://imgur.com/t/cats/cute-abcde"), {
    id: "abcde",
    kind: "gallery",
  });
});

void test("invalid hosts, credentials, control characters and malformed IDs never fetch", async () => {
  const network = sequence();
  for (const input of [
    "",
    "abcde",
    "https://imgur.com.evil.test/a/abcde",
    "https://name@imgur.com/a/abcde",
    "https://imgur.com:8080/a/abcde",
    "https://imgur.com/a/---",
    "https://imgur.com/a/abc\nde",
    "x".repeat(2049),
  ]) {
    await assert.rejects(resolveImgur(input, network), code("INPUT"));
  }
  assert.equal(network.calls.length, 0);
});

void test("direct media bypasses all network traffic and preserves URL queries", async () => {
  const network = sequence();
  const result = await resolveImgur(
    "http://i.imgur.com/ABCDE.mp4?download=1#t=2",
    network,
  );
  assert.equal(result.source, "direct");
  assert.equal(
    result.items[0]!.url,
    "https://i.imgur.com/ABCDE.mp4?download=1",
  );
  assert.equal(result.items[0]!.type, "video");
  assert.equal(result.requests, 0);
  assert.equal(network.calls.length, 0);
});

void test("GIFV wrappers inspect single embeds instead of assuming an MP4 original", () => {
  for (const value of [
    "https://i.imgur.com/ABCDE.gifv",
    "https://i.imgur.com/ABCDE.GIFV/?x=1",
    "https://imgur.com/ABCDE.gifv",
  ])
    assert.deepEqual(parseInput(value), { id: "ABCDE", kind: "image" });
});

void test("album extraction preserves order and GIF originals with no credentials", async () => {
  const network = sequence(new Response(album));
  const result = await resolveImgur(albumUrl, network);
  assert.equal(result.count, 2);
  assert.equal(result.requests, 1);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["ABCDE", "FGHIJ"],
  );
  assert.equal(result.items[0]!.url, "https://i.imgur.com/ABCDE.gif");
  assert.equal(result.items[0]!.videoUrl, "https://i.imgur.com/ABCDE.mp4");
  const { url, init } = network.calls[0]!;
  assert.equal(url, "https://imgur.com/a/abcde/embed");
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.mode, "cors");
  assert.equal(init?.redirect, "error");
  assert.equal(init?.referrerPolicy, "no-referrer");
  assert.equal(new Headers(init?.headers).has("Authorization"), false);
});

void test("partial album and mismatched resource metadata fail visibly", async () => {
  await assert.rejects(
    resolveImgur(
      albumUrl,
      sequence(new Response(album.replace('"count":2', '"count":3'))),
    ),
    code("INCOMPLETE_ALBUM"),
  );
  await assert.rejects(
    resolveImgur(
      albumUrl,
      sequence(new Response(album.replace("id: 'abcde'", "id: 'wrongID'"))),
    ),
    code("RESOURCE_MISMATCH"),
  );
});

void test("gallery lookup retries exactly one single-image shape on not-found or CORS failure", async () => {
  for (const failure of [
    new Response(null, { status: 404 }),
    new TypeError("CORS"),
  ]) {
    const network = sequence(failure, new Response(single));
    const result = await resolveImgur(
      "https://imgur.com/gallery/abcde",
      network,
    );
    assert.equal(result.count, 1);
    assert.equal(result.requests, 2);
    assert.equal(network.calls[1]!.url, "https://imgur.com/abcde/embed");
  }
});

void test("gallery does not retry rate limits, access denial, or malformed listings", async () => {
  for (const [response, expected] of [
    [new Response(null, { status: 429 }), "HTTP_429"],
    [new Response(null, { status: 403 }), "HTTP_403"],
    [new Response("<html>Changed template</html>"), "NOT_ALBUM_EMBED"],
  ] as const) {
    const network = sequence(response);
    await assert.rejects(
      resolveImgur("https://imgur.com/gallery/abcde", network),
      code(expected),
    );
    assert.equal(network.calls.length, 1);
  }
});

void test("HTTP failures are classified without requiring a JSON body", async () => {
  for (const status of [404, 429, 403, 500]) {
    await assert.rejects(
      resolveImgur(albumUrl, sequence(new Response("not JSON", { status }))),
      code(`HTTP_${status}`),
    );
  }
});

void test("listing byte limit covers both announced size and chunked bodies", async () => {
  await assert.rejects(
    resolveImgur(
      albumUrl,
      sequence(
        new Response("small", {
          headers: { "content-length": String(5 * 1024 * 1024) },
        }),
      ),
    ),
    code("SIZE"),
  );
  const body = new Uint8Array(4 * 1024 * 1024 + 1);
  await assert.rejects(
    resolveImgur(albumUrl, sequence(new Response(body))),
    code("SIZE"),
  );
  await assert.rejects(
    resolveImgur(albumUrl, sequence(new Response(null))),
    code("SCHEMA"),
  );
});

void test("overall timeout bounds an unresponsive fetch even when abort is ignored", async () => {
  let called = 0;
  await assert.rejects(
    resolveImgur("https://imgur.com/gallery/abcde", {
      timeoutMs: 15,
      fetchImpl: () => {
        called++;
        return new Promise<Response>(() => undefined);
      },
    }),
    code("TIMEOUT"),
  );
  assert.equal(called, 1);
});

void test("overall timeout remains active while a response body stalls", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<script>"));
    },
  });
  await assert.rejects(
    resolveImgur(albumUrl, { ...sequence(new Response(body)), timeoutMs: 15 }),
    code("TIMEOUT"),
  );
});

void test("caller cancellation, including direct links and before dispatch, is distinct", async () => {
  const before = new AbortController();
  before.abort();
  const network = sequence();
  for (const input of [albumUrl, "https://i.imgur.com/ABCDE.jpg"])
    await assert.rejects(
      resolveImgur(input, { ...network, signal: before.signal }),
      code("ABORTED"),
    );
  assert.equal(network.calls.length, 0);
  const during = new AbortController();
  const pending = resolveImgur(albumUrl, {
    signal: during.signal,
    fetchImpl: () => new Promise<Response>(() => undefined),
  });
  during.abort();
  await assert.rejects(pending, code("ABORTED"));
});

void test("timeout validation and browser network failures have stable errors", async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity])
    await assert.rejects(resolveImgur(albumUrl, { timeoutMs }), code("INPUT"));
  await assert.rejects(
    resolveImgur(albumUrl, sequence(new TypeError("Failed to fetch"))),
    code("NETWORK"),
  );
});

void test("static single images verify MIME before canonicalizing an original URL", async () => {
  const network = sequence(
    new Response('<img id="image-element" src="//i.imgur.com/abcdel.jpg">'),
    new Response(null, { headers: { "content-type": "image/png" } }),
  );
  const result = await resolveImgur("https://imgur.com/abcde", network);
  assert.equal(result.items[0]!.url, "https://i.imgur.com/abcde.png");
  assert.equal(network.calls[1]!.init?.method, "HEAD");
  assert.equal(result.requests, 2);
});

void test("unconfirmed thumbnails do not become apparently successful media links", async () => {
  const network = sequence(
    new Response('<img id="image-element" src="//i.imgur.com/abcdel.jpg">'),
    new Response("error", { headers: { "content-type": "text/html" } }),
  );
  await assert.rejects(
    resolveImgur("https://imgur.com/abcde", network),
    code("UNRESOLVED_ORIGINAL"),
  );
});

void test("a verified single GIF becomes the output while MP4 remains available for playback", async () => {
  const network = sequence(new Response(animated), gifResponse());
  const result = await resolveImgur("https://i.imgur.com/abcde.gifv", network);
  assert.equal(result.items[0]!.url, "https://i.imgur.com/abcde.gif");
  assert.equal(result.items[0]!.videoUrl, "https://i.imgur.com/abcde.mp4");
  assert.equal(result.items[0]!.gifVerified, true);
  assert.equal(result.items[0]!.gifCandidate, undefined);
  assert.equal(result.requests, 2);
});

void test("JPEG placeholders never replace an uploaded MP4 with a false GIF", async () => {
  const network = sequence(
    new Response(animated),
    new Response(new Uint8Array([255, 216, 255]), {
      headers: { "content-type": "image/jpeg" },
    }),
  );
  const result = await resolveImgur("https://imgur.com/abcde", network);
  assert.equal(result.items[0]!.url, "https://i.imgur.com/abcde.mp4");
  assert.equal(result.items[0]!.gifVerified, undefined);
  assert.equal(result.items[0]!.gifVerification?.status, "not-gif");
});

void test("an inconclusive optional GIF probe keeps the MP4 with a clear note", async () => {
  const result = await resolveImgur(
    "https://imgur.com/abcde",
    sequence(new Response(animated), new TypeError("CORS")),
  );
  assert.equal(result.items[0]!.url, "https://i.imgur.com/abcde.mp4");
  assert.match(result.items[0]!.note!, /could not be confirmed/);
});

void test("overall deadline also cancels an optional GIF verification", async () => {
  let calls = 0;
  await assert.rejects(
    resolveImgur("https://imgur.com/abcde", {
      timeoutMs: 15,
      fetchImpl: () =>
        ++calls === 1
          ? Promise.resolve(new Response(animated))
          : new Promise<Response>(() => undefined),
    }),
    code("TIMEOUT"),
  );
  assert.equal(calls, 2);
});

void test("caller cancellation during GIF verification rejects instead of returning MP4 success", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    resolveImgur("https://imgur.com/abcde", {
      signal: controller.signal,
      fetchImpl: () => {
        if (++calls === 1) return Promise.resolve(new Response(animated));
        controller.abort();
        return new Promise<Response>(() => undefined);
      },
    }),
    code("ABORTED"),
  );
  assert.equal(calls, 2);
});

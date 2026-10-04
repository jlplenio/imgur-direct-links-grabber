import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { getImgurLinks } from "../src/server/imgur-client";
import extractLinkInfo, { type ImgurLinkInfo } from "../src/utils/link-cleaner";

const clientId = "test-client-id";
const album: ImgurLinkInfo = { albumId: "KFZRCIv", linkType: "album" };
const image: ImgurLinkInfo = { albumId: "abc1234", linkType: "image" };
const gallery: ImgurLinkInfo = { albumId: "abc1234", linkType: "gallery" };
const mediaLink = "https://i.imgur.com/abc1234.jpg";

function fetchJson(body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
}

void test("returns album links, single images, and valid empty albums", async () => {
  assert.equal(
    await getImgurLinks(album, {
      clientId,
      fetchImpl: fetchJson({
        data: {
          images: [
            { link: mediaLink },
            { link: "https://i.imgur.com/def5678.mp4" },
          ],
        },
      }),
    }),
    `${mediaLink}\nhttps://i.imgur.com/def5678.mp4`,
  );
  assert.equal(
    await getImgurLinks(image, {
      clientId,
      fetchImpl: fetchJson({ data: { link: mediaLink } }),
    }),
    mediaLink,
  );
  assert.equal(
    await getImgurLinks(album, {
      clientId,
      fetchImpl: fetchJson({
        data: { images: [] },
        success: true,
        status: 200,
      }),
    }),
    "",
  );
});

void test("routes galleries to the gallery endpoint and discriminates image versus album", async () => {
  for (const data of [
    { is_album: false, link: mediaLink },
    {
      is_album: true,
      images: [{ link: mediaLink }],
      link: "https://imgur.com/a/abc1234",
    },
  ]) {
    const fetchImpl: typeof fetch = async (url, options) => {
      assert.equal(url, "https://api.imgur.com/3/gallery/abc1234");
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        `Client-ID ${clientId}`,
      );
      assert.equal(options?.redirect, "error");
      return new Response(JSON.stringify({ data }));
    };
    assert.equal(
      await getImgurLinks(gallery, { clientId, fetchImpl }),
      mediaLink,
    );
  }
});

void test("upgrades validated legacy HTTP media links to HTTPS", async () => {
  const httpLink = "http://i.imgur.com/abc1234.jpg?download=1";
  const httpsLink = "https://i.imgur.com/abc1234.jpg?download=1";
  for (const [resource, data] of [
    [image, { link: httpLink }],
    [album, { images: [{ link: httpLink }] }],
    [gallery, { is_album: false, link: httpLink }],
  ] as const) {
    assert.equal(
      await getImgurLinks(resource, {
        clientId,
        fetchImpl: fetchJson({ data }),
      }),
      httpsLink,
    );
  }
});

void test("the exact logged IDs keep their case and map HTML 404 responses to NOT_FOUND", async () => {
  for (const id of ["KFZRCIv", "vw0PiiE"]) {
    const resource = extractLinkInfo(`https://imgur.com/a/${id}`);
    assert.ok(resource);
    const fetchImpl: typeof fetch = async (url) => {
      assert.equal(url, `https://api.imgur.com/3/album/${id}`);
      return new Response("<html>Not Found</html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    };
    await assert.rejects(
      getImgurLinks(resource, { clientId, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.equal(error.code, "NOT_FOUND");
        assert.equal(getHTTPStatusCodeFromError(error), 404);
        assert.match(error.message, /not found/i);
        assert.match(
          error.cause?.message ?? "",
          /HTTP 404; content-type: text\/html/,
        );
        return true;
      },
    );
  }
});

void test("classifies failures by HTTP status regardless of error-body content", async () => {
  const cases = [
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [429, "TOO_MANY_REQUESTS"],
    [408, "TIMEOUT"],
    [504, "TIMEOUT"],
    [401, "INTERNAL_SERVER_ERROR"],
    [500, "INTERNAL_SERVER_ERROR"],
    [502, "INTERNAL_SERVER_ERROR"],
    [503, "INTERNAL_SERVER_ERROR"],
  ] as const;
  for (const [status, code] of cases) {
    for (const body of [
      "",
      "<html>upstream error</html>",
      JSON.stringify({ data: { error: "untrusted upstream details" } }),
    ]) {
      await assert.rejects(
        getImgurLinks(album, {
          clientId,
          fetchImpl: async () => new Response(body, { status }),
        }),
        (error: unknown) => {
          assert.ok(error instanceof TRPCError);
          assert.equal(error.code, code);
          assert.doesNotMatch(error.message, /untrusted upstream details/);
          return true;
        },
      );
    }
  }
});

void test("rejects malformed success responses and unsafe media links", async () => {
  const cases: Array<[ImgurLinkInfo, unknown]> = [
    [album, null],
    [album, {}],
    [album, { data: null }],
    [album, { data: { images: [{}] } }],
    [album, { data: { images: [null] } }],
    [album, { data: { images: "not-an-array" } }],
    [image, { data: { link: { unexpected: true } } }],
    [image, { data: { link: "not a URL" } }],
    [image, { data: { link: "" } }],
    [image, { data: { link: "https://i.imgur.com/abc\u00001234.jpg" } }],
    [image, { data: { link: "https://i.imgur.com/abc\u001f1234.jpg" } }],
    [image, { data: { link: "https://i.imgur.com/abc\u007f1234.jpg" } }],
    [image, { data: { link: "javascript:alert(1)" } }],
    [image, { data: { link: "https://evil.test/photo.jpg" } }],
    [image, { data: { link: "https://user:secret@i.imgur.com/photo.jpg" } }],
    [image, { data: { link: mediaLink }, success: false }],
    [
      gallery,
      { data: { is_album: true, link: "https://imgur.com/a/abc1234" } },
    ],
    [gallery, { data: { link: mediaLink } }],
  ];
  for (const [resource, body] of cases) {
    await assert.rejects(
      getImgurLinks(resource, { clientId, fetchImpl: fetchJson(body) }),
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Imgur returned an invalid response. Please try again later.",
      },
    );
  }
  await assert.rejects(
    getImgurLinks(album, {
      clientId,
      fetchImpl: async () => new Response("<html>OK</html>"),
    }),
    {
      code: "INTERNAL_SERVER_ERROR",
      message: "Imgur returned an invalid response. Please try again later.",
    },
  );
});

void test("maps network failures to a stable message without exposing transport details", async () => {
  await assert.rejects(
    getImgurLinks(album, {
      clientId,
      fetchImpl: async () => {
        throw new TypeError("private transport details");
      },
    }),
    {
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not connect to Imgur. Please try again later.",
    },
  );
});

void test("deadline aborts a stalled request", async () => {
  let signal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>(() => undefined);
  };
  await assert.rejects(
    getImgurLinks(album, { clientId, fetchImpl, timeoutMs: 10 }),
    { code: "TIMEOUT" },
  );
  assert.equal(signal?.aborted, true);
});

void test("deadline remains active while reading the response body", async () => {
  let signal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = async (_url, options) => {
    signal = options?.signal;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          signal?.addEventListener(
            "abort",
            () => controller.error(new Error("aborted")),
            { once: true },
          );
        },
      }),
    );
  };
  await assert.rejects(
    getImgurLinks(album, { clientId, fetchImpl, timeoutMs: 10 }),
    { code: "TIMEOUT" },
  );
  assert.equal(signal?.aborted, true);
});

void test("rejects missing configuration before making an upstream request", async () => {
  let called = false;
  for (const missing of [undefined, "", "   "]) {
    await assert.rejects(
      getImgurLinks(album, {
        clientId: missing,
        fetchImpl: async () => {
          called = true;
          return new Response();
        },
      }),
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "The Imgur connection is not configured correctly.",
      },
    );
  }
  assert.equal(called, false);
});

void test("environment validation rejects a missing Client ID", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./src/env.js')"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        IMGURCLIENTID: "",
        SKIP_ENV_VALIDATION: "",
      },
    },
  );
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IMGURCLIENTID/);
});

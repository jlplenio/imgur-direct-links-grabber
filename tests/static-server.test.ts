import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStaticServer } from "../scripts/serve-static.mjs";

await test("static export server", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "imgur-static-test-"));
  const exported = join(directory, "out");
  await mkdir(join(exported, "_next", "static"), { recursive: true });
  await mkdir(join(exported, "design-preview"), { recursive: true });
  await mkdir(join(exported, "nested"), { recursive: true });
  await mkdir(join(directory, "private"));
  await Promise.all([
    writeFile(join(exported, "index.html"), "<h1>Home</h1>"),
    writeFile(join(exported, "design-preview.html"), "<h1>Preview</h1>"),
    writeFile(join(exported, "404.html"), "<h1>Missing</h1>"),
    writeFile(join(exported, "nested", "index.html"), "Nested page"),
    writeFile(join(exported, "design-preview", "07.mp4"), "0123456789"),
    writeFile(join(exported, "design-preview", "cover.svg"), "<svg/>"),
    writeFile(join(exported, "_next", "static", "app.js"), "const app = true;"),
    writeFile(join(exported, "style.css"), "body{}"),
    writeFile(join(exported, "empty.txt"), ""),
    writeFile(join(exported, "arbitrary.dat"), "data"),
    writeFile(join(directory, "private", "secret.txt"), "outside export"),
  ]);
  const server = await createStaticServer(exported);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  // node:http preserves raw paths, unlike fetch's URL normalization. This is
  // essential for exercising the server's traversal checks themselves.
  const get = (
    path: string,
    method = "GET",
    headers: Record<string, string | undefined> = {},
  ) =>
    new Promise<{
      status: number | undefined;
      headers: IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.once("error", reject);
          res.once("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.once("error", reject);
      req.end();
    });

  await t.test(
    "serves exported routes while preserving sibling asset directories",
    async () => {
      for (const path of ["/", "/?cache=1", "/index.html"]) {
        const result = await get(path);
        assert.equal(result.status, 200);
        assert.equal(result.body, "<h1>Home</h1>");
        assert.equal(
          result.headers["content-type"],
          "text/html; charset=utf-8",
        );
      }
      for (const path of [
        "/design-preview",
        "/design-preview/",
        "/design-preview.html",
      ]) {
        const result = await get(path);
        assert.equal(result.status, 200);
        assert.equal(result.body, "<h1>Preview</h1>");
      }
      assert.equal((await get("/nested/")).body, "Nested page");
      const video = await get("/design-preview/07.mp4");
      assert.equal(video.body, "0123456789");
      assert.equal(video.headers["content-type"], "video/mp4");
    },
  );

  await t.test("sets MIME, asset caching and nosniff headers", async () => {
    const script = await get("/_next/static/app.js");
    assert.equal(
      script.headers["content-type"],
      "text/javascript; charset=utf-8",
    );
    assert.equal(
      script.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal(script.headers["x-content-type-options"], "nosniff");
    assert.equal((await get("/")).headers["cache-control"], "no-cache");
    assert.equal(
      (await get("/style.css")).headers["content-type"],
      "text/css; charset=utf-8",
    );
    assert.equal(
      (await get("/design-preview/cover.svg")).headers["content-type"],
      "image/svg+xml",
    );
    assert.equal(
      (await get("/arbitrary.dat")).headers["content-type"],
      "application/octet-stream",
    );
  });

  await t.test(
    "HEAD returns the full GET metadata with no body and ignores Range",
    async () => {
      const result = await get("/design-preview/07.mp4", "HEAD", {
        Range: "bytes=2-4",
      });
      assert.equal(result.status, 200);
      assert.equal(result.body, "");
      assert.equal(result.headers["content-length"], "10");
      assert.equal(result.headers["accept-ranges"], "bytes");
      assert.equal(result.headers["content-range"], undefined);
    },
  );

  await t.test(
    "serves bounded, open-ended and suffix byte ranges for seeking",
    async () => {
      for (const [range, body, contentRange] of [
        ["bytes=2-4", "234", "bytes 2-4/10"],
        ["bytes=7-", "789", "bytes 7-9/10"],
        ["bytes=-3", "789", "bytes 7-9/10"],
        ["bytes=8-99", "89", "bytes 8-9/10"],
        ["bytes=-99", "0123456789", "bytes 0-9/10"],
      ]) {
        assert.ok(range && body && contentRange);
        const result = await get("/design-preview/07.mp4", "GET", {
          Range: range,
        });
        assert.equal(result.status, 206, range);
        assert.equal(result.body, body);
        assert.equal(result.headers["content-range"], contentRange);
        assert.equal(result.headers["content-length"], String(body.length));
        assert.equal(result.headers["content-type"], "video/mp4");
      }
    },
  );

  await t.test("rejects unsatisfiable or malformed byte ranges", async () => {
    for (const range of [
      "bytes=10-",
      "bytes=4-2",
      "bytes=-0",
      "bytes=-",
      "bytes=wat",
      "bytes=99999999999999999999-",
    ]) {
      const result = await get("/design-preview/07.mp4", "GET", {
        Range: range,
      });
      assert.equal(result.status, 416, range);
      assert.equal(result.headers["content-range"], "bytes */10");
    }
    const empty = await get("/empty.txt", "GET", { Range: "bytes=0-0" });
    assert.equal(empty.status, 416);
    assert.equal(empty.headers["content-range"], "bytes */0");
    assert.equal((await get("/empty.txt")).status, 200);
  });

  await t.test(
    "falls back to full GET for unsupported ranges or If-Range without a validator",
    async () => {
      for (const headers of [
        { Range: "items=0-1" },
        { Range: "bytes=0-1,4-5" },
        { Range: "bytes=0-1", "If-Range": '"unknown-etag"' },
      ]) {
        const result = await get("/design-preview/07.mp4", "GET", headers);
        assert.equal(result.status, 200);
        assert.equal(result.body, "0123456789");
      }
    },
  );

  await t.test(
    "uses custom 404 pages and rejects mutating methods",
    async () => {
      for (const path of ["/unknown", "/api/trpc/imgur", "/.env"]) {
        const result = await get(path);
        assert.equal(result.status, 404);
        assert.equal(result.body, "<h1>Missing</h1>");
      }
      const missingHead = await get("/unknown", "HEAD");
      assert.equal(missingHead.status, 404);
      assert.equal(missingHead.body, "");
      const post = await get("/", "POST");
      assert.equal(post.status, 405);
      assert.equal(post.headers.allow, "GET, HEAD");
    },
  );

  await t.test(
    "rejects traversal, Windows paths and malformed encodings before filesystem resolution",
    async () => {
      for (const path of [
        "/../private/secret.txt",
        "/%2e%2e/private/secret.txt",
        "/nested/../../private/secret.txt",
        "/nested/%2e%2e/index.html",
        "/nested%2f..%2findex.html",
        "/.//index.html",
        "/%5c..%5cprivate%5csecret.txt",
        "/C:%5cWindows%5cwin.ini",
        "/index.html:stream",
        "/index.html%00",
        "/%0d%0aInjected:value",
        "/%FF",
        "/%",
        "//private/secret.txt",
      ]) {
        const result = await get(path);
        assert.equal(result.status, 400, path);
        assert.ok(!result.body.includes("outside export"));
      }
      assert.equal((await get("/%252e%252e/private/secret.txt")).status, 404);
    },
  );

  await t.test(
    "does not expose files through a link outside the export",
    async () => {
      // Directory junctions do not require Windows developer-mode privileges.
      await symlink(
        join(directory, "private"),
        join(exported, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const result = await get("/escape/secret.txt");
      assert.equal(result.status, 404);
      assert.ok(!result.body.includes("outside export"));
    },
  );
});

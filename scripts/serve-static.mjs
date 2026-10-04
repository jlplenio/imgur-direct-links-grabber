import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../out");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".wasm", "application/wasm"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".pdf", "application/pdf"],
]);

/** @param {string} root @param {string} path */
function withinRoot(root, path) {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

/** @param {string | undefined} target */
function requestPath(target) {
  // Inspect the original path before a URL parser can erase dot segments.
  const rawPath = (target ?? "/").split(/[?#]/, 1)[0] ?? "/";
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return null;
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (/[\\:\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.split("/").some((segment) => segment === "." || segment === ".."))
    return null;
  return path;
}

/** @param {unknown} error @param {string[]} codes */
function hasErrorCode(error, codes) {
  return (
    error instanceof Error &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

/** @param {string} root @param {string[]} candidates */
async function findFile(root, candidates) {
  for (const candidate of candidates) {
    if (!withinRoot(root, candidate)) continue;
    try {
      // Resolve links as well as lexical paths: exports cannot expose files
      // outside the build directory through an accidental filesystem symlink.
      const actual = await realpath(candidate);
      if (!withinRoot(root, actual)) continue;
      const info = await stat(actual);
      if (info.isFile()) return { path: actual, size: info.size };
    } catch (error) {
      if (!hasErrorCode(error, ["ENOENT", "ENOTDIR", "EACCES", "EPERM"]))
        throw error;
    }
  }
  return null;
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} message
 * @param {import("node:http").OutgoingHttpHeaders} extraHeaders
 */
function sendText(request, response, status, message, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(request.method === "HEAD" ? undefined : message);
}

/** @param {string | undefined} header @param {number} size */
function byteRange(header, size) {
  // Unsupported units or multipart ranges are safely served as the full file.
  if (!header?.startsWith("bytes=") || header.includes(",")) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  )
    return null;
  if (first === null) {
    if (last === null || last === 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

/**
 * Serve an already-built export. This server has no API or Imgur proxy.
 * @param {string} rootDirectory
 */
export async function createStaticServer(rootDirectory = defaultRoot) {
  const root = await realpath(rootDirectory);
  if (!(await stat(root)).isDirectory())
    throw new Error("The static export path is not a directory.");

  /** @param {import("node:http").IncomingMessage} request @param {import("node:http").ServerResponse} response */
  const serve = async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(request, response, 405, "Method not allowed.\n", {
        Allow: "GET, HEAD",
      });
      return;
    }
    const path = requestPath(request.url);
    if (path === null) {
      sendText(request, response, 400, "Invalid request path.\n");
      return;
    }
    const normalized = path.replace(/\/+$/, "") || "/";
    const base = resolve(root, `.${normalized}`);
    const candidates =
      normalized === "/"
        ? [join(root, "index.html")]
        : [base, `${base}.html`, join(base, "index.html")];
    let file = await findFile(root, candidates);
    const status = file ? 200 : 404;
    if (!file) file = await findFile(root, [join(root, "404.html")]);
    if (!file) {
      sendText(request, response, 404, "Not found.\n");
      return;
    }
    const isHashedAsset =
      status === 200 && normalized.startsWith("/_next/static/");
    // Range applies to GET only. Without validators an If-Range request gets
    // the complete current file, never a potentially stale partial response.
    const range =
      status === 200 && request.method === "GET" && !request.headers["if-range"]
        ? byteRange(request.headers.range, file.size)
        : undefined;
    if (range === null) {
      sendText(
        request,
        response,
        416,
        "Requested range is not satisfiable.\n",
        {
          "Content-Range": `bytes */${file.size}`,
          "Accept-Ranges": "bytes",
        },
      );
      return;
    }
    response.writeHead(range ? 206 : status, {
      "Content-Type":
        mimeTypes.get(extname(file.path).toLowerCase()) ??
        "application/octet-stream",
      "Content-Length": range ? range.end - range.start + 1 : file.size,
      "Accept-Ranges": "bytes",
      ...(range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` }
        : {}),
      "Cache-Control": isHashedAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    pipeline(createReadStream(file.path, range), response, (error) => {
      if (error && !response.destroyed) response.destroy(error);
    });
  };

  return createServer((request, response) => {
    void serve(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else sendText(request, response, 500, "Could not serve this file.\n");
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm start -- [--host 127.0.0.1] [--port 3000]\nServes out/ only. HOST and PORT also configure the listener.",
    );
    return;
  }
  const host = values.host ?? process.env.HOST ?? "127.0.0.1";
  const rawPort = values.port ?? process.env.PORT ?? "3000";
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  let server;
  try {
    server = await createStaticServer();
  } catch (error) {
    if (hasErrorCode(error, ["ENOENT"]))
      throw new Error("No static export found. Run npm run build first.");
    throw error;
  }
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveListening(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine the listening address.");
  const displayHost = host.includes(":") ? `[${host}]` : host;
  console.log(
    `Static export available at http://${displayHost}:${address.port}`,
  );
  for (const event of ["SIGINT", "SIGTERM"])
    process.once(event, () => server.close());
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

const executionState = globalThis as typeof globalThis & {
  __imgurParserExecuted?: boolean;
};
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EmbedParseError,
  parseAlbumEmbed,
  parseSingleEmbed,
} from "../src/lib/imgur/extract";

// Small data extracts from public /a/lDRB2/embed and /a/ypaFujs/embed, 2026-10-04.
const photo = {
  hash: "Ziz25",
  ext: ".jpg",
  animated: false,
  prefer_video: false,
  width: 2592,
  height: 1944,
};
const gif = {
  hash: "4XBi2TE",
  ext: ".gif",
  animated: true,
  prefer_video: true,
  width: 420,
  height: 221,
};
const movie = {
  hash: "ENIoXlC",
  ext: ".mp4",
  animated: true,
  prefer_video: true,
  width: 400,
  height: 222,
};

function albumEmbed(
  images: Record<string, unknown>[] = [photo],
  options: {
    count?: number;
    id?: string;
    title?: string;
    markerId?: string;
    album?: Record<string, unknown>;
    list?: unknown;
  } = {},
) {
  const list = { count: options.count ?? images.length, images };
  const album = {
    id: options.id ?? "lDRB2",
    title: options.title ?? "Imgur Office",
    num_images: String(list.count),
    album_images: list,
    ...options.album,
  };
  return `<script>
    var album = Imgur.Album.getInstance({
      id: '${options.markerId ?? album.id}',
      album: ${JSON.stringify(album)},
      images: ${JSON.stringify(options.list ?? list)},
      operation: 'embed',
    });
  </script>`;
}

function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof EmbedParseError && error.code === code;
}

void test("non-pub album preserves order, metadata, and original GIF links", () => {
  const result = parseAlbumEmbed(albumEmbed([photo, gif, movie]), "lDRB2");
  assert.equal(result.title, "Imgur Office");
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.items.map(({ id }) => id),
    ["Ziz25", "4XBi2TE", "ENIoXlC"],
  );
  assert.equal(result.items[0]!.width, 2592);
  assert.equal(result.items[1]!.url, "https://i.imgur.com/4XBi2TE.gif");
  assert.equal(result.items[1]!.videoUrl, "https://i.imgur.com/4XBi2TE.mp4");
  assert.equal(result.items[1]!.type, "image");
  assert.equal(result.items[2]!.type, "video");
});

void test("pub=true assignment template supplies the full list", () => {
  const html = `<script>
    var images = ${JSON.stringify({ count: 2, images: [gif, movie] })},
      albumHash = 'ypaFujs',
      cdnUrl = '//i.imgur.com';
    const unrelatedWidget = {
      id: 'share-button'
    };
  </script>`;
  const result = parseAlbumEmbed(html, "ypaFujs");
  assert.equal(result.count, 2);
  assert.equal(result.title, null);
  assert.equal(result.items[0]!.id, gif.hash);
});

void test("escaped quotes, backslashes, braces and fake field text remain ordinary data", () => {
  const title =
    'A \\"quoted\\" title { } with \\ paths\nimages: {"count": 999}';
  const html = albumEmbed([{ ...photo, description: title }], { title });
  assert.equal(parseAlbumEmbed(html, "lDRB2").title, title);
});

void test("remote scripts and function-call payloads are never executed", () => {
  executionState.__imgurParserExecuted = false;
  const html = albumEmbed().replace(
    '"hash":"Ziz25"',
    '"hash":(executionState.__imgurParserExecuted = true)',
  );
  assert.throws(
    () => parseAlbumEmbed(html, "lDRB2"),
    hasCode("MALFORMED_DATA"),
  );
  assert.equal(executionState.__imgurParserExecuted, false);
  delete executionState.__imgurParserExecuted;
});

void test("truncated and malformed JSON fail instead of reporting a partial album", () => {
  const html = albumEmbed();
  const start = html.indexOf('"album_images"');
  assert.throws(
    () => parseAlbumEmbed(html.slice(0, start) + "</script>", "lDRB2"),
    hasCode("MALFORMED_DATA"),
  );
  assert.throws(
    () =>
      parseAlbumEmbed(
        html.replace('"hash":"Ziz25"', '"hash":undefined'),
        "lDRB2",
      ),
    hasCode("MALFORMED_DATA"),
  );
});

void test("list count and album count must match all extracted entries", () => {
  assert.throws(
    () => parseAlbumEmbed(albumEmbed([photo], { count: 2 }), "lDRB2"),
    hasCode("INCOMPLETE_ALBUM"),
  );
  assert.throws(
    () =>
      parseAlbumEmbed(
        albumEmbed([photo], { album: { num_images: "2" } }),
        "lDRB2",
      ),
    hasCode("INCOMPLETE_ALBUM"),
  );
  assert.throws(
    () =>
      parseAlbumEmbed(
        albumEmbed([photo], { list: { count: 1, images: [gif] } }),
        "lDRB2",
      ),
    hasCode("MALFORMED_DATA"),
  );
});

void test("all exposed resource identity markers must match the requested ID", () => {
  assert.throws(
    () => parseAlbumEmbed(albumEmbed([photo], { id: "OtherID" }), "lDRB2"),
    hasCode("RESOURCE_MISMATCH"),
  );
  assert.throws(
    () =>
      parseAlbumEmbed(albumEmbed([photo], { markerId: "OtherID" }), "lDRB2"),
    hasCode("RESOURCE_MISMATCH"),
  );
  const pub = `<script>\nvar images = {"count":0,"images":[]},\nalbumHash = 'OtherID';\n</script>`;
  assert.throws(
    () => parseAlbumEmbed(pub, "lDRB2"),
    hasCode("RESOURCE_MISMATCH"),
  );
});

void test("album data requires an explicit resource identity marker", () => {
  const pub = '<script>\nvar images = {"count":0,"images":[]};\n</script>';
  const legacy =
    '<script>\nvar album = Imgur.Album.getInstance({\nimages: {"count":0,"images":[]}\n});\n</script>';
  for (const html of [pub, legacy]) {
    assert.throws(
      () => parseAlbumEmbed(html, "lDRB2"),
      hasCode("MISSING_RESOURCE_ID"),
    );
  }
  const emptyMarker =
    '<script>\nvar images = {"count":0,"images":[]},\nalbumHash = "";\n</script>';
  assert.throws(
    () => parseAlbumEmbed(emptyMarker, "lDRB2"),
    hasCode("RESOURCE_MISMATCH"),
  );
});

void test("media IDs, extensions, dimensions, and boolean metadata are validated", () => {
  for (const fields of [
    { hash: "../path" },
    { ext: '.jpg?x="<script>' },
    { ext: ".svg" },
    { width: -1 },
    { height: "10" },
    { animated: "false" },
    { prefer_video: 1 },
  ]) {
    assert.throws(
      () => parseAlbumEmbed(albumEmbed([{ ...photo, ...fields }]), "lDRB2"),
      hasCode("INVALID_MEDIA"),
    );
  }
});

void test("an empty album is distinct from an unsupported or oversized document", () => {
  assert.equal(parseAlbumEmbed(albumEmbed([]), "lDRB2").count, 0);
  assert.throws(
    () => parseAlbumEmbed("<html>Not found</html>", "lDRB2"),
    hasCode("NOT_ALBUM_EMBED"),
  );
  assert.throws(
    () => parseAlbumEmbed("x".repeat(8 * 1024 * 1024 + 1), "lDRB2"),
    hasCode("INVALID_INPUT"),
  );
  assert.throws(
    () => parseAlbumEmbed(albumEmbed(), "../bad"),
    hasCode("INVALID_RESOURCE_ID"),
  );
});

void test("a thousand-item complete album is retained in source order", () => {
  const images = Array.from({ length: 1000 }, (_, index) => ({
    ...photo,
    hash: `img${String(index).padStart(4, "0")}`,
  }));
  const result = parseAlbumEmbed(albumEmbed(images), "lDRB2");
  assert.equal(result.count, 1000);
  assert.equal(result.items.at(-1)!.id, "img0999");
});

void test("video alternate requires explicit animated and prefer_video metadata", () => {
  const result = parseAlbumEmbed(
    albumEmbed([
      { ...gif, prefer_video: false },
      { ...gif, animated: false },
    ]),
    "lDRB2",
  );
  assert.ok(result.items.every((item) => item.videoUrl === undefined));
});

// Exact public single-embed tags from ENIoXlC, qOFnGs4, QAfnFZe, and Ziz25.
void test("single MP4 and unsuffixed GIF sources are original media", () => {
  const video = parseSingleEmbed(
    '<source src="//i.imgur.com/ENIoXlC.mp4" type="video/mp4">',
    "ENIoXlC",
  );
  assert.equal(video.items[0]!.url, "https://i.imgur.com/ENIoXlC.mp4");
  assert.equal(video.items[0]!.type, "video");
  const image = parseSingleEmbed(
    '<img id="image-element" class="post" src="//i.imgur.com/qOFnGs4.gif" />',
    "qOFnGs4",
  );
  assert.equal(image.items[0]!.url, "https://i.imgur.com/qOFnGs4.gif");
  assert.equal(image.items[0]!.animated, true);
});

void test("static thumbnails cannot establish the exact original file format", () => {
  for (const id of ["QAfnFZe", "Ziz25"]) {
    assert.throws(
      () =>
        parseSingleEmbed(
          `<img id="image-element" src="//i.imgur.com/${id}l.jpg">`,
          id,
        ),
      hasCode("UNRESOLVED_ORIGINAL"),
    );
  }
});

void test("explicit thumbnail inference marks a candidate requiring MIME verification", () => {
  for (const suffix of ["s", "b", "t", "m", "l", "h"]) {
    const result = parseSingleEmbed(
      `<img id="image-element" src="//i.imgur.com/QAfnFZe${suffix}.jpg">`,
      "QAfnFZe",
      { allowThumbnailOriginal: true },
    );
    assert.equal(result.items[0]!.url, "https://i.imgur.com/QAfnFZe.jpg");
    assert.equal(result.items[0]!.originalFromThumbnail, true);
  }
  assert.throws(
    () =>
      parseSingleEmbed(
        '<img id="image-element" src="//i.imgur.com/QAfnFZell.jpg">',
        "QAfnFZe",
        { allowThumbnailOriginal: true },
      ),
    hasCode("RESOURCE_MISMATCH"),
  );
});

void test("single parser does not interpret media tags embedded in scripts or comments", () => {
  const html =
    '<script>const example = \'<source src="//i.imgur.com/ENIoXlC.mp4">\';</script><!-- <source src="//i.imgur.com/ENIoXlC.mp4"> -->';
  assert.throws(
    () => parseSingleEmbed(html, "ENIoXlC"),
    hasCode("UNRESOLVED_ORIGINAL"),
  );
});

void test("single media rejects wrong IDs, unsafe URLs, duplicate attributes and page links", () => {
  assert.throws(
    () =>
      parseSingleEmbed(
        '<source src="https://i.imgur.com/OtherID.mp4">',
        "ENIoXlC",
      ),
    hasCode("RESOURCE_MISMATCH"),
  );
  for (const src of [
    "javascript:alert(1)",
    "https://i.imgur.com.attacker.test/ENIoXlC.mp4",
    "https://user@i.imgur.com/ENIoXlC.mp4",
    "https://imgur.com/ENIoXlC",
  ]) {
    assert.throws(
      () => parseSingleEmbed(`<source src="${src}">`, "ENIoXlC"),
      hasCode("UNRESOLVED_ORIGINAL"),
    );
  }
  assert.throws(
    () =>
      parseSingleEmbed(
        '<source src="//i.imgur.com/ENIoXlC.mp4" src="//attacker.test/a.mp4">',
        "ENIoXlC",
      ),
    hasCode("MALFORMED_DATA"),
  );
});

function animatedSingle(id: string, properties?: string) {
  return `<script>
    var videoItem = {
      hash: '${id}',
      gifUrl: '//i.imgur.com/${id}.gif',
      size: 4505699,
      width: 420,
      height: 221,
      looping: true,
      isEmbed: true,
      hasSound: true,
      ${properties ?? ""}
    };
  </script><source src="//i.imgur.com/${id}.mp4" type="video/mp4">`;
}

void test("videoItem exposes a GIF candidate without changing the MP4 representation", () => {
  // Real GIF and uploaded MP4 embeds have indistinguishable pointer/flag shapes.
  for (const [id, size, width, height] of [
    ["4XBi2TE", 4505699, 420, 221],
    ["ENIoXlC", 175798, 400, 222],
  ] as const) {
    const html = animatedSingle(id)
      .replace("size: 4505699", `size: ${size}`)
      .replace("width: 420", `width: ${width}`)
      .replace("height: 221", `height: ${height}`);
    const item = parseSingleEmbed(html, id).items[0]!;
    assert.equal(item.url, `https://i.imgur.com/${id}.mp4`);
    assert.equal(item.type, "video");
    assert.deepEqual(item.gifCandidate, {
      url: `https://i.imgur.com/${id}.gif`,
      size,
      width,
      height,
    });
    assert.equal(item.originalVerified, undefined);
  }
});

void test("safe string escapes in literal videoItem fields are decoded without evaluation", () => {
  const html = animatedSingle("ENIoXlC")
    .replace("hash: 'ENIoXlC'", 'hash: "\\u0045NIoXlC"')
    .replace(
      "gifUrl: '//i.imgur.com/ENIoXlC.gif'",
      'gifUrl: "https:\\/\\/i.imgur.com\\/ENIoXlC.gif"',
    );
  assert.equal(
    parseSingleEmbed(html, "ENIoXlC").items[0]!.gifCandidate!.url,
    "https://i.imgur.com/ENIoXlC.gif",
  );
});

void test("GIF candidate metadata rejects duplicate and executable object fields", () => {
  executionState.__imgurParserExecuted = false;
  for (const property of [
    "size: 1,",
    "['computed']: true,",
    "get size() { return 1; },",
    "execute: (executionState.__imgurParserExecuted = true),",
    "execute: function () {},",
    "nested: {},",
    "__proto__: null,",
    "constructor: 'value',",
  ]) {
    assert.throws(
      () => parseSingleEmbed(animatedSingle("ENIoXlC", property), "ENIoXlC"),
      hasCode("MALFORMED_DATA"),
    );
  }
  assert.equal(executionState.__imgurParserExecuted, false);
  delete executionState.__imgurParserExecuted;
});

void test("GIF candidate identity, URL, byte size and dimensions must be valid", () => {
  const html = animatedSingle("ENIoXlC");
  assert.throws(
    () =>
      parseSingleEmbed(
        html.replace("hash: 'ENIoXlC'", "hash: 'OtherID'"),
        "ENIoXlC",
      ),
    hasCode("RESOURCE_MISMATCH"),
  );
  for (const [before, after] of [
    ["//i.imgur.com/ENIoXlC.gif", "//i.imgur.com.attacker.test/ENIoXlC.gif"],
    ["//i.imgur.com/ENIoXlC.gif", "javascript:alert(1)"],
    ["//i.imgur.com/ENIoXlC.gif", "//i.imgur.com/ENIoXlCl.gif"],
    ["size: 4505699", "size: 0"],
    ["size: 4505699", "size: 9007199254740992"],
    ["width: 420", "width: -1"],
    ["height: 221", "height: 1.5"],
    ["height: 221", "height: '221'"],
  ] as const) {
    assert.throws(
      () => parseSingleEmbed(html.replace(before, after), "ENIoXlC"),
      hasCode("INVALID_MEDIA"),
    );
  }
});

void test("missing videoItem stays supported; ambiguous or truncated metadata rejects", () => {
  const source = '<source src="//i.imgur.com/ENIoXlC.mp4" type="video/mp4">';
  assert.equal(
    parseSingleEmbed(source, "ENIoXlC").items[0]!.gifCandidate,
    undefined,
  );
  const html = animatedSingle("ENIoXlC");
  assert.throws(
    () => parseSingleEmbed(html + html, "ENIoXlC"),
    hasCode("MALFORMED_DATA"),
  );
  assert.throws(
    () =>
      parseSingleEmbed(
        html.replace("hasSound: true,", "hasSound: 'truncated"),
        "ENIoXlC",
      ),
    hasCode("MALFORMED_DATA"),
  );
});

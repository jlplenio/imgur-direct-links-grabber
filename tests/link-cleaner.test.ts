import assert from "node:assert/strict";
import test from "node:test";
import extractLinkInfo from "../src/utils/link-cleaner";

void test("normalizes pasted album URLs while preserving case-sensitive IDs", () => {
  for (const url of [
    "https://imgur.com/a/KFZRCIv",
    "https://imgur.com/a/KFZRCIv?utm_source=share",
    "https://imgur.com/a/KFZRCIv#abc1234",
    "https://imgur.com/a/KFZRCIv/",
    "  HTTPS://IMGUR.COM/a/KFZRCIv  ",
    "https://www.imgur.com/a/KFZRCIv",
    "https://m.imgur.com/a/KFZRCIv",
    "http://imgur.com/a/title-KFZRCIv",
  ]) {
    assert.deepEqual(
      extractLinkInfo(url),
      { albumId: "KFZRCIv", linkType: "album" },
      url,
    );
  }
  assert.deepEqual(extractLinkInfo("https://imgur.com/a/vw0PiiE"), {
    albumId: "vw0PiiE",
    linkType: "album",
  });
});

void test("keeps gallery posts distinct from albums and accepts tagged posts", () => {
  for (const url of [
    "https://imgur.com/gallery/abc1234",
    "https://imgur.com/gallery/a-cat-abc1234",
    "https://imgur.com/t/gallery/abc1234",
    "https://imgur.com/t/cats/a-cat-abc1234",
  ]) {
    assert.deepEqual(extractLinkInfo(url), {
      albumId: "abc1234",
      linkType: "gallery",
    });
  }
});

void test("supports legacy images, direct media, and the existing d- prefix", () => {
  for (const [url, albumId] of [
    ["https://imgur.com/Abc12", "Abc12"],
    ["https://imgur.com/abc1234", "abc1234"],
    ["https://imgur.com/d-abc1234", "abc1234"],
    ["https://imgur.com/abc1234.jpg", "abc1234"],
    ["https://i.imgur.com/abc1234.mp4?download=1", "abc1234"],
    ["https://i.imgur.com/Abc12.PNG", "Abc12"],
  ]) {
    assert.deepEqual(extractLinkInfo(url!), { albumId, linkType: "image" });
  }
});

void test("uses only the final slug segment and rejects malformed IDs", () => {
  assert.deepEqual(
    extractLinkInfo("https://imgur.com/a/drawing-strangers-AGCGQ"),
    { albumId: "AGCGQ", linkType: "album" },
  );
  assert.deepEqual(extractLinkInfo("https://imgur.com/a/longerAlbumID123"), {
    albumId: "longerAlbumID123",
    linkType: "album",
  });
  for (const path of [
    "---",
    "title-aa",
    "title-",
    "title--abc1234",
    "a",
    "a".repeat(65),
    "abc/def",
    "abc%2Fdef",
  ]) {
    assert.equal(extractLinkInfo(`https://imgur.com/a/${path}`), null, path);
  }
});

void test("rejects unsupported protocols, deceptive hosts, credentials and unsafe input", () => {
  for (const url of [
    "https://imgur.com.evil.test/a/abc1234",
    "https://evil.test/?url=https://imgur.com/a/abc1234",
    "https://imgur.com@evil.test/a/abc1234",
    "https://evil.test@imgur.com/a/abc1234",
    "https://user:password@imgur.com/a/abc1234",
    "https://imgur.com:444/a/abc1234",
    "ftp://imgur.com/a/abc1234",
    "javascript:alert(1)",
    "//imgur.com/a/abc1234",
    "https://imgur.com\\a\\abc1234",
    "https://imgur.com/a/abc\n1234",
    "https://imgur.com/a/abc 1234",
    "https://i.imgur.com/a/abc1234",
    "https://i.imgur.com/abc1234.html",
    "https://imgur.com/a/abc1234//",
    `https://imgur.com/a/abc1234?${"x".repeat(2048)}`,
    "",
  ]) {
    assert.equal(extractLinkInfo(url), null, url);
  }
});

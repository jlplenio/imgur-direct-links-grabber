import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAsBBCode,
  formatAsHTML,
  formatAsMarkdown,
  formatAsPlainUrls,
  formatMediaItems,
  parseMediaUrls,
  shuffleItems,
  type OutputFormat,
} from "../src/utils/formatter";

const image = "https://i.imgur.com/Abc1234.jpg";
const video = "https://i.imgur.com/Def5678.mp4";

void test("classifies video pathnames independently of query and fragment", () => {
  const urls = [
    video + "?download=1#t=2",
    "https://i.imgur.com/Def5678.WEBM#t=10",
    image + "?filename=movie.mp4",
  ];
  assert.deepEqual(parseMediaUrls(urls.join("\n")), [
    { url: urls[0], type: "video" },
    { url: urls[1], type: "video" },
    { url: urls[2], type: "image" },
  ]);
});

void test("normalizes Imgur GIFV wrappers to playable MP4 URLs", () => {
  assert.deepEqual(parseMediaUrls("https://i.imgur.com/Abc1234.gifv?x=1#t=2"), [
    { url: "https://i.imgur.com/Abc1234.mp4?x=1#t=2", type: "video" },
  ]);
});

void test("rejects malformed, credentialed, and non-HTTP URLs", () => {
  const invalid = [
    "httpnot-a-url",
    "javascript:alert(1)",
    "data:image/png;base64,aGVsbG8=",
    "ftp://i.imgur.com/Abc1234.jpg",
    "https:///i.imgur.com/Abc1234.jpg",
    "//i.imgur.com/Abc1234.jpg",
    "https://user:password@i.imgur.com/Abc1234.jpg",
    "https://i.imgur.com/Abc 1234.jpg",
    "https://i.imgur.com/Abc1234.jpg\u0000",
    "https://i.imgur.com\\Abc1234.jpg",
  ];
  for (const value of invalid) {
    assert.deepEqual(parseMediaUrls(value), [], value);
  }
});

void test("accepts legitimate media IDs containing status-like words", () => {
  const url = "https://i.imgur.com/errorAB.jpg";
  assert.deepEqual(parseMediaUrls(url), [{ url, type: "image" }]);
});

void test("exports images as images and videos as playable HTML or ordinary links", () => {
  const text = image + "\n" + video;
  assert.equal(
    formatAsHTML(text),
    `<img src="${image}" alt="" />\n<video src="${video}" controls></video>`,
  );
  assert.equal(
    formatAsMarkdown(text),
    `![image](<${image}>)\n[video](<${video}>)`,
  );
  assert.equal(
    formatAsBBCode(text),
    `[IMG]${image}[/IMG]\n[URL]${video}[/URL]`,
  );
});

void test("round-trips mixed media across all output formats", () => {
  const text = image + "?one=1&two=2\n" + video + "#t=2";
  const items = parseMediaUrls(text);
  const formats: OutputFormat[] = ["plain", "bbcode", "html", "markdown"];
  for (const format of formats) {
    const output = formatMediaItems(items, format);
    assert.deepEqual(parseMediaUrls(output), items, format);
    assert.equal(formatAsPlainUrls(output), text, format);
  }
});

void test("escapes HTML attributes rather than allowing injected markup", () => {
  const url = `https://i.imgur.com/a.jpg?x="&y='<tag>`;
  assert.equal(
    formatMediaItems([{ url, type: "image" }], "html"),
    '<img src="https://i.imgur.com/a.jpg?x=&quot;&amp;y=&#39;&lt;tag&gt;" alt="" />',
  );
});

void test("protects Markdown parentheses and BBCode tag delimiters", () => {
  const parenthesized = "https://i.imgur.com/image(1).jpg";
  assert.equal(
    formatAsPlainUrls(formatAsMarkdown(parenthesized)),
    parenthesized,
  );
  assert.equal(
    formatAsBBCode("https://i.imgur.com/image[1].jpg"),
    "[IMG]https://i.imgur.com/image%5B1%5D.jpg[/IMG]",
  );
});

void test("reads legacy image formatting and ignores non-URL text", () => {
  assert.equal(formatAsPlainUrls(`![image](${image})`), image);
  assert.equal(formatAsPlainUrls(`[img]${image}[/img]`), image);
  assert.equal(
    formatAsPlainUrls("loading...\nInvalid URL format\n" + image),
    image,
  );
});

void test("shuffling leaves canonical media unchanged and preserves all entries", () => {
  const items = Object.freeze(parseMediaUrls(image + "\n" + video));
  const shuffled = shuffleItems(items);
  assert.notEqual(shuffled, items);
  assert.deepEqual(
    [...shuffled].sort((a, b) => a.url.localeCompare(b.url)),
    [...items],
  );
  assert.deepEqual(items, parseMediaUrls(image + "\n" + video));
});

import { toast } from "~/components/ui/use-toast";

export type MediaItem = {
  url: string;
  type: "image" | "video";
};

export type OutputFormat = "plain" | "bbcode" | "html" | "markdown";

const decodeHtmlAttribute = (value: string): string =>
  value.replace(/&(amp|quot|apos|lt|gt|#39);/g, (entity) => {
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&#39;": "'",
      "&lt;": "<",
      "&gt;": ">",
    };
    return entities[entity] ?? entity;
  });

export const removeAllFormatting = (text: string): string =>
  text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const bbcode = trimmed.match(/^\[(IMG|URL)\](.*?)\[\/\1\]$/i);
      if (bbcode) return bbcode[2] ?? "";

      const html = trimmed.match(
        /^<(?:img|video)\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>(?:<\/video>)?$/i,
      );
      if (html) return decodeHtmlAttribute(html[2] ?? "");

      const markdown = trimmed.match(/^!?\[[^\]]*\]\(<([^>]*)>\)$/);
      if (markdown) return markdown[1] ?? "";
      const legacyMarkdown = trimmed.match(/^!?\[[^\]]*\]\((.*)\)$/);
      return legacyMarkdown?.[1] ?? trimmed;
    })
    .filter(Boolean)
    .join("\n");

export function parseMediaUrls(text: string): MediaItem[] {
  return removeAllFormatting(text)
    .split("\n")
    .flatMap((line): MediaItem[] => {
      const value = line.trim();
      if (
        !/^https?:\/\/[^/\\]/i.test(value) ||
        /\s|\\/.test(value) ||
        Array.from(value).some((character) => character.charCodeAt(0) < 32)
      ) {
        return [];
      }

      try {
        const url = new URL(value);
        if (!url.hostname || url.username || url.password) return [];

        // Imgur's GIFV URL is a wrapper; its MP4 counterpart is playable media.
        if (url.hostname === "i.imgur.com" && /\.gifv$/i.test(url.pathname)) {
          url.pathname = url.pathname.replace(/\.gifv$/i, ".mp4");
        }

        return [
          {
            url: url.href,
            type: /\.(mp4|gifv|webm|mov)$/i.test(url.pathname)
              ? "video"
              : "image",
          },
        ];
      } catch {
        return [];
      }
    });
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function formatMediaItems(
  items: readonly MediaItem[],
  format: OutputFormat,
): string {
  return items
    .map((item) => {
      const { url, type } = item;
      switch (format) {
        case "bbcode": {
          const tag = type === "video" ? "URL" : "IMG";
          const destination = url.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
          return "[" + tag + "]" + destination + "[/" + tag + "]";
        }
        case "html":
          return type === "video"
            ? '<video src="' + escapeHtml(url) + '" controls></video>'
            : '<img src="' + escapeHtml(url) + '" alt="" />';
        case "markdown": {
          const destination = url.replace(/</g, "%3C").replace(/>/g, "%3E");
          return type === "video"
            ? "[video](<" + destination + ">)"
            : "![image](<" + destination + ">)";
        }
        default:
          return url;
      }
    })
    .join("\n");
}

export const formatAsBBCode = (text: string): string =>
  formatMediaItems(parseMediaUrls(text), "bbcode");

export const formatAsHTML = (text: string): string =>
  formatMediaItems(parseMediaUrls(text), "html");

export const formatAsMarkdown = (text: string): string =>
  formatMediaItems(parseMediaUrls(text), "markdown");

export const formatAsPlainUrls = (text: string): string =>
  formatMediaItems(parseMediaUrls(text), "plain");

export const toggleImgTagsOnLinks = (text: string): string =>
  /^\[(?:IMG|URL)\]/i.test(text.trim())
    ? formatAsPlainUrls(text)
    : formatAsBBCode(text);

export function shuffleItems<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

export const shuffleLinks = (text: string): string =>
  shuffleItems(text.split("\n")).join("\n");

export async function copyToClipboard(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content);
    toast({
      description: "URLs copied to clipboard 📋",
      duration: 2000,
      title: "Copied!",
    });
  } catch {
    toast({
      title: "Could not copy URLs",
      description: "Select the output and copy it manually using your browser.",
      variant: "destructive",
    });
  }
}

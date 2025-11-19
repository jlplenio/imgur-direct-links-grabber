import { toast } from "~/components/ui/use-toast";

export const toggleImgTagsOnLinks = (text: string): string => {
  const links = text.split("\n");
  const wrappedOrUnwrappedLinks = links.map((link) => {
    // Regular expression to detect existing [IMG][/IMG] tags
    const regex = /^\[IMG\](.*?)\[\/IMG\]$/;
    const match = link.match(regex);

    // If link is already wrapped, remove the tags
    if (match) {
      return match[1]; // Return the link without [IMG][/IMG] tags
    } else {
      // If not wrapped, wrap the link
      return `[IMG]${link}[/IMG]`;
    }
  });

  return wrappedOrUnwrappedLinks.join("\n");
};

export const removeAllFormatting = (text: string): string => {
  return text
    .split("\n")
    .map((line) => {
      // Remove BBCode [IMG] tags
      line = line.replace(/^\[IMG\](.*?)\[\/IMG\]$/g, "$1");
      // Remove HTML img tags
      line = line.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "$1");
      // Remove Markdown image syntax
      line = line.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "$1");
      return line.trim();
    })
    .filter((line) => line.length > 0)
    .join("\n");
};

export const formatAsBBCode = (text: string): string => {
  // First extract URLs from any format
  const cleaned = removeAllFormatting(text);
  const links = cleaned.split("\n").filter((line) => line.trim().length > 0 && line.startsWith("http"));
  return links.map((link) => `[IMG]${link.trim()}[/IMG]`).join("\n");
};

export const formatAsHTML = (text: string): string => {
  // First extract URLs from any format
  const cleaned = removeAllFormatting(text);
  const links = cleaned.split("\n").filter((line) => line.trim().length > 0 && line.startsWith("http"));
  return links.map((link) => `<img src="${link.trim()}" alt="" />`).join("\n");
};

export const formatAsMarkdown = (text: string): string => {
  // First extract URLs from any format
  const cleaned = removeAllFormatting(text);
  const links = cleaned.split("\n").filter((line) => line.trim().length > 0 && line.startsWith("http"));
  return links.map((link) => `![image](${link.trim()})`).join("\n");
};

export const formatAsPlainUrls = (text: string): string => {
  // First extract URLs from any format
  const cleaned = removeAllFormatting(text);
  const links = cleaned.split("\n").filter((line) => line.trim().length > 0 && line.startsWith("http"));
  return links.map((link) => link.trim()).join("\n");
};

export const shuffleLinks = (text: string): string => {
  const links = text.split("\n");

  for (let i = links.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [links[i], links[j]] = [links[j]!, links[i]!];
  }

  return links.join("\n");
};

export async function copyToClipboard(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    toast({
      description: "URLs copied to clipboard 📋",
      duration: 2000,
      title: "Copied!",
    });
  } catch (err) {
    console.error("Failed to copy:", err);
  }
}

export type MediaItem = {
  url: string;
  type: "image" | "video";
};

export function parseMediaUrls(text: string): MediaItem[] {
  // First extract URLs from any format (BBCode, HTML, Markdown, or plain)
  const cleaned = removeAllFormatting(text);
  const urls: string[] = cleaned
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0 && line.startsWith("http"));

  return urls.map((url: string): MediaItem => {
    const lowerUrl = url.toLowerCase();
    const isVideo =
      lowerUrl.endsWith(".mp4") ||
      lowerUrl.endsWith(".gifv") ||
      lowerUrl.endsWith(".webm") ||
      lowerUrl.endsWith(".mov");
    return {
      url,
      type: isVideo ? ("video" as const) : ("image" as const),
    };
  });
}

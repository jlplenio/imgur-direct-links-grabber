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
  const urls: string[] = text
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

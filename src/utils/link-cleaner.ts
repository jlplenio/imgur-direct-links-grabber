export type ImgurLinkInfo = {
  albumId: string;
  linkType: "album" | "gallery" | "image";
};

const pageHosts = new Set(["imgur.com", "www.imgur.com", "m.imgur.com"]);
const validId = /^[a-zA-Z0-9]{3,64}$/;

function extractLinkInfo(value: string): ImgurLinkInfo | null {
  if (value.length > 2048) return null;

  const input = value.trim();
  // URL normalizes backslashes and embedded controls; reject those inputs first.
  if (/[\\\u0000-\u0020\u007f]/.test(input)) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  const path = url.pathname.replace(/\/$/, "");
  if (url.hostname === "i.imgur.com") {
    const match =
      /^\/([a-zA-Z0-9]{5}|[a-zA-Z0-9]{7})\.(?:jpe?g|png|gif|gifv|webp|avif|mp4|webm)$/i.exec(
        path,
      );
    return match?.[1] ? { albumId: match[1], linkType: "image" } : null;
  }
  if (!pageHosts.has(url.hostname)) return null;

  const albumOrGallery =
    /^\/(a|gallery|t\/[a-zA-Z0-9_-]+)\/([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)$/.exec(
      path,
    );
  if (albumOrGallery) {
    const albumId = albumOrGallery[2]?.split("-").at(-1);
    if (!albumId || !validId.test(albumId)) return null;
    return {
      albumId,
      linkType: albumOrGallery[1] === "a" ? "album" : "gallery",
    };
  }

  // Older image hashes have five characters; current hashes have seven.
  const image =
    /^\/(?:d-)?([a-zA-Z0-9]{5}|[a-zA-Z0-9]{7})(?:\.(?:jpe?g|png|gif|gifv|webp|avif|mp4|webm))?$/i.exec(
      path,
    );
  return image?.[1] ? { albumId: image[1], linkType: "image" } : null;
}

export const shouldShowFundingPrompt = (processedCount: number): boolean => {
  return processedCount > 0 && processedCount % 5 === 0;
};

export default extractLinkInfo;

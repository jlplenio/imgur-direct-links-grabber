function extractLinkInfo(
  url: string,
): { albumId: string; linkType: string } | null {
  // First clean the URL by removing any 'd-' prefix
  const cleanedUrl = url.replace("/d-", "/");

  // Combined regex for album URLs - capture the last segment after final dash if present
  const albumRegex =
    /https?:\/\/imgur\.com\/(t\/gallery|gallery|a)\/(?:[a-zA-Z0-9-]+?)(?:-([a-zA-Z0-9]{7}))?$/;
  // Regex for single image URLs
  const singleImageRegex = /https?:\/\/imgur\.com\/([a-zA-Z0-9]{7})$/;

  let match = cleanedUrl.match(albumRegex);
  if (match) {
    // If we found a 7-character ID at the end, use that, otherwise use the full match
    const albumId = match[2] ?? match[0].split("/").pop()!;
    if (albumId) {
      return { albumId, linkType: "album" };
    }
  }

  match = cleanedUrl.match(singleImageRegex);
  if (match) {
    const albumId = match[1];
    if (albumId) {
      return { albumId, linkType: "image" };
    }
  }

  return null;
}

export const shouldShowFundingPrompt = (processedCount: number): boolean => {
  return processedCount > 0 && processedCount % 5 === 0;
};

export default extractLinkInfo;

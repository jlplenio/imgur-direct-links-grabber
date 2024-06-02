function extractLinkInfo(
  url: string,
): { albumId: string; linkType: string } | null {
  // Combined regex for album URLs
  const albumRegex =
    /https?:\/\/imgur\.com\/(t\/gallery|gallery|a)\/([a-zA-Z0-9]+)/;
  // Regex for single image URLs
  const singleImageRegex = /https?:\/\/imgur\.com\/([a-zA-Z0-9]+)$/;

  let match = url.match(albumRegex);
  if (match) {
    const albumId = match[2];
    if (albumId) {
      return { albumId, linkType: "album" };
    }
  }

  match = url.match(singleImageRegex);
  if (match) {
    const albumId = match[1];
    if (albumId) {
      return { albumId, linkType: "image" };
    }
  }

  return null;
}

export default extractLinkInfo;

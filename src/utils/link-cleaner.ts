function extractLinkInfo(
  url: string,
): { albumId: string; linkType: string } | null {
  // Validate URL length to prevent DoS attacks
  if (url.length > 2048) {
    return null;
  }
  
  // First clean the URL by removing any 'd-' prefix
  const cleanedUrl = url.replace("/d-", "/");

  // Regex for album URLs - matches /a/ or /gallery/ or /t/gallery/ followed by slug-ID or just ID
  // Handles formats like: /a/ABC123, /a/slug-ABC123, /a/drawing-strangers-AGCGQ
  // Only allows alphanumeric and dashes to prevent injection
  const albumRegex =
    /^https?:\/\/imgur\.com\/(t\/gallery|gallery|a)\/([a-zA-Z0-9-]+)$/;
  
  // Regex for single image URLs (7 character hash)
  // Strictly matches only 7 alphanumeric characters
  const singleImageRegex = /^https?:\/\/imgur\.com\/([a-zA-Z0-9]{7})$/;

  let match = cleanedUrl.match(albumRegex);
  if (match) {
    const fullPath = match[2]!; // e.g., "drawing-strangers-AGCGQ" or "ABC123" or "longerAlbumID123"
    
    // Imgur album IDs can be variable length (historically often 5 chars, but can be longer)
    // URLs can be in formats:
    // - /a/ABC123 (just the ID)
    // - /a/slug-ABC123 (slug followed by ID)
    // - /a/multi-word-slug-ID (multiple words then ID)
    
    const parts = fullPath.split("-");
    
    // If there are dashes, try to extract the ID from the end
    // The ID is typically the last segment that's alphanumeric only
    if (parts.length > 1) {
      // Check each segment from the end to find the ID part
      // IDs are typically shorter segments (3+ chars) that are purely alphanumeric
      for (let i = parts.length - 1; i >= 0; i--) {
        const segment = parts[i]!;
        // If segment is alphanumeric and reasonable length (3+ chars), it's likely the ID
        if (/^[a-zA-Z0-9]{3,}$/.test(segment)) {
          // Use this segment as the ID
          return { albumId: segment, linkType: "album" };
        }
      }
    }
    
    // If no dashes or couldn't extract ID, use the full path as the ID
    // This handles cases like /a/ABC123 where the whole thing is the ID
    if (/^[a-zA-Z0-9-]+$/.test(fullPath)) {
      return { albumId: fullPath, linkType: "album" };
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

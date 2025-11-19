import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { z } from "zod";
import extractLinkInfo from "~/utils/link-cleaner";
import { TRPCError } from "@trpc/server";

const imgur_token = process.env.IMGURCLIENTID;

interface ImgurApiResponse {
  data: {
    link?: string; // Optional: present for single images
    images?: Array<{ link: string }>; // Optional: present for albums
  };
}

export const imgurRouter = createTRPCRouter({
  getLinks: publicProcedure
    .input(
      z.object({
        url: z.string().refine((value) => extractLinkInfo(value) !== null, {
          message: "Invalid URL format",
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const linkInfo = extractLinkInfo(input.url);
      if (!linkInfo) {
        console.error(`URL: ${input.url}`);
        console.error(`[imgur.getLinks] Invalid URL format`);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid URL format",
        });
      }
      const { albumId, linkType } = linkInfo;
      
      // Sanitize albumId to prevent path traversal and injection attacks
      // Only allow alphanumeric characters, dashes, and underscores
      const sanitizedAlbumId = albumId.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!sanitizedAlbumId || sanitizedAlbumId !== albumId) {
        console.error(`URL: ${input.url}`);
        console.error(`[imgur.getLinks] Invalid album ID format - Original: ${albumId}, Sanitized: ${sanitizedAlbumId}`);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid album/image ID format",
        });
      }
      
      // Ensure linkType is only 'album' or 'image' to prevent injection
      const sanitizedLinkType = linkType === "album" ? "album" : "image";
      
      const apiUrl = `https://api.imgur.com/3/${sanitizedLinkType}/${sanitizedAlbumId}`;
      
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Client-ID ${imgur_token}` },
      });

      if (response.status === 429) {
        console.error(`URL: ${input.url}`);
        console.error(`[imgur.getLinks] Rate limit exceeded`);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Rate limit exceeded. Please try again in a few minutes.",
        });
      }

      if (!response.ok) {
        let errorMessage = "Failed to fetch image";
        let errorDetails = "";
        try {
          const errorData = (await response.json()) as { data?: { error?: string }; success?: boolean; status?: number };
          if (errorData.data?.error) {
            errorMessage = `Imgur API error: ${errorData.data.error}`;
            errorDetails = errorData.data.error;
          } else if (response.status === 403) {
            errorMessage = "Access forbidden. The album may be private or deleted.";
          } else if (response.status === 404) {
            errorMessage = "Album or image not found. Please check the URL.";
          }
        } catch {
          // If we can't parse the error, use status text
          errorMessage = `Failed to fetch: ${response.status} ${response.statusText}`;
        }
        
        // Log URL first for Vercel Messages column
        console.error(`URL: ${input.url}`);
        console.error(`[imgur.getLinks] API Error - Status: ${response.status}, API URL: ${apiUrl}, AlbumId: ${sanitizedAlbumId}, Error: ${errorDetails || errorMessage}`);
        
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }

      let jsonResponse: ImgurApiResponse;
      try {
        jsonResponse = (await response.json()) as ImgurApiResponse;
      } catch (err) {
        console.error(`URL: ${input.url}`);
        console.error(`[imgur.getLinks] JSON Parse Error - API URL: ${apiUrl}, Error:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to parse Imgur response as JSON",
        });
      }

      if (
        linkType === "album" &&
        jsonResponse.data?.images &&
        Array.isArray(jsonResponse.data.images)
      ) {
        return jsonResponse.data.images.map((image) => image.link).join("\n");
      } else if (linkType !== "album" && jsonResponse.data?.link) {
        return jsonResponse.data.link;
      }

      console.error(`URL: ${input.url}`);
      console.error(`[imgur.getLinks] Unexpected API response - API URL: ${apiUrl}, LinkType: ${linkType}, Response:`, JSON.stringify(jsonResponse));
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected API response structure",
      });
    }),
});

export type ImgurRouter = typeof imgurRouter;

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { z } from "zod";
import extractLinkInfo from "~/utils/link-cleaner";

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
        throw new Error("Invalid URL format");
      }
      const { albumId, linkType } = linkInfo;
      const apiUrl = `https://api.imgur.com/3/${linkType === "album" ? "album" : "image"}/${albumId}`;
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Client-ID ${imgur_token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch image");
      }

      const jsonResponse = (await response.json()) as ImgurApiResponse;

      if (
        linkType === "album" &&
        jsonResponse.data?.images &&
        Array.isArray(jsonResponse.data.images)
      ) {
        return jsonResponse.data.images.map((image) => image.link).join("\n");
      } else if (linkType !== "album" && jsonResponse.data?.link) {
        return jsonResponse.data.link;
      }

      throw new Error("Unexpected API response structure");
    }),
});

export type ImgurRouter = typeof imgurRouter;

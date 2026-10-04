import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { env } from "~/env";
import extractLinkInfo from "~/utils/link-cleaner";
import { getImgurLinks } from "~/server/imgur-client";

export const imgurRouter = createTRPCRouter({
  getLinks: publicProcedure
    .input(
      z.object({
        url: z
          .string()
          .max(2048)
          .transform((value, ctx) => {
            const resource = extractLinkInfo(value);
            if (!resource) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid Imgur URL format",
              });
              return z.NEVER;
            }
            return resource;
          }),
      }),
    )
    .mutation(({ input }) =>
      getImgurLinks(input.url, { clientId: env.IMGURCLIENTID }),
    ),
});

export type ImgurRouter = typeof imgurRouter;

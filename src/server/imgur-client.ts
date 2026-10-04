import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ImgurLinkInfo } from "../utils/link-cleaner";

const mediaUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    if (/[\s\u0000-\u001f\u007f<>"\\]/.test(value)) return false;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        url.hostname === "i.imgur.com" &&
        !url.username &&
        !url.password &&
        !url.port
      );
    } catch {
      return false;
    }
  })
  .transform((value) => {
    const url = new URL(value);
    url.protocol = "https:";
    return url.href;
  });
const imageSchema = z.object({ link: mediaUrl });
const albumSchema = z.object({ images: z.array(imageSchema) });
const gallerySchema = z.discriminatedUnion("is_album", [
  albumSchema.extend({ is_album: z.literal(true) }),
  imageSchema.extend({ is_album: z.literal(false) }),
]);
const envelopeSchema = z.object({
  success: z.literal(true).optional(),
  status: z.number().int().min(200).max(299).optional(),
  data: z.unknown(),
});

type ImgurClientOptions = {
  clientId: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function httpError(response: Response): TRPCError {
  // Classify the status before touching the body: Imgur may return HTML or no body.
  const cause = new Error(
    `Imgur HTTP ${response.status}; content-type: ${(response.headers.get("content-type") ?? "unknown").slice(0, 100)}`,
  );
  switch (response.status) {
    case 404:
      return new TRPCError({
        code: "NOT_FOUND",
        message: "Album or image not found. Please check the URL.",
        cause,
      });
    case 403:
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Imgur denied access to this album or image.",
        cause,
      });
    case 429:
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Imgur's rate limit was reached. Please try again later.",
        cause,
      });
    case 408:
    case 504:
      return new TRPCError({
        code: "TIMEOUT",
        message: "Imgur took too long to respond. Please try again.",
        cause,
      });
    case 401:
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The Imgur connection is not configured correctly.",
        cause,
      });
    default:
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Imgur could not complete the request. Please try again later.",
        cause,
      });
  }
}

export async function getImgurLinks(
  resource: ImgurLinkInfo,
  { clientId, fetchImpl = fetch, timeoutMs = 10_000 }: ImgurClientOptions,
): Promise<string> {
  if (!clientId?.trim()) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The Imgur connection is not configured correctly.",
    });
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new TRPCError({
          code: "TIMEOUT",
          message: "Imgur took too long to respond. Please try again.",
        }),
      );
      controller.abort();
    }, timeoutMs);
  });

  const request = async (): Promise<string> => {
    // The gallery item endpoint supports both image posts and album posts.
    const response = await fetchImpl(
      `https://api.imgur.com/3/${resource.linkType}/${resource.albumId}`,
      {
        headers: {
          Authorization: `Client-ID ${clientId.trim()}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        redirect: "error",
      },
    );
    if (!response.ok) {
      const error = httpError(response);
      controller.abort();
      throw error;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Imgur returned an invalid response. Please try again later.",
      });
    }

    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Imgur returned an invalid response. Please try again later.",
      });
    }
    const schema =
      resource.linkType === "album"
        ? albumSchema
        : resource.linkType === "gallery"
          ? gallerySchema
          : imageSchema;
    const result = schema.safeParse(envelope.data.data);
    if (!result.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Imgur returned an invalid response. Please try again later.",
      });
    }
    return "images" in result.data
      ? result.data.images.map((image) => image.link).join("\n")
      : result.data.link;
  };

  try {
    // Keep the deadline active until the response body is read and validated.
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: controller.signal.aborted ? "TIMEOUT" : "INTERNAL_SERVER_ERROR",
      message: controller.signal.aborted
        ? "Imgur took too long to respond. Please try again."
        : "Could not connect to Imgur. Please try again later.",
    });
  } finally {
    clearTimeout(timer);
  }
}

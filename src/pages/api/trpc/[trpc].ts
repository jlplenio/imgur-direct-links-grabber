import { createNextApiHandler } from "@trpc/server/adapters/next";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import extractLinkInfo from "~/utils/link-cleaner";

export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  // tRPC maps standard error codes to HTTP statuses, including 404 and 429.
  onError: ({ path, error, input, req }) => {
    const resource =
      input &&
      typeof input === "object" &&
      "url" in input &&
      typeof input.url === "string"
        ? extractLinkInfo(input.url)
        : null;
    const requestId = req.headers["x-vercel-id"];
    // One bounded event per failure; never log full submitted URLs or upstream bodies.
    console.error(
      JSON.stringify({
        event: "imgur.request_failed",
        requestId:
          typeof requestId === "string" ? requestId.slice(0, 120) : undefined,
        procedure: path?.slice(0, 100),
        code: error.code,
        resource,
        message: error.message.slice(0, 300),
        detail: error.cause?.message.slice(0, 300),
      }),
    );
  },
});

import { createNextApiHandler } from "@trpc/server/adapters/next";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

// export API handler
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,

  // This ensures tRPC’s JSON error object is sent with status=429 (instead of 200)
  responseMeta({ errors }) {
    // If any procedure threw a "TOO_MANY_REQUESTS" error, use 429
    if (errors.find((error) => error.code === "TOO_MANY_REQUESTS")) {
      return {
        status: 429,
      };
    }
    return {};
  },

  onError:
    env.NODE_ENV === "development"
      ? ({ path, error }) => {
          console.error(
            `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
          );
        }
      : undefined,
});

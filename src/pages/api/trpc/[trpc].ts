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

  onError: ({ path, error, input }) => {
    // Extract URL from input for Vercel Messages column
    const url = input && typeof input === "object" && "url" in input 
      ? String(input.url) 
      : input 
        ? JSON.stringify(input) 
        : "Unknown";
    
    // Log URL as primary message for Vercel Messages column
    console.error(`URL: ${url}`);
    
    // Log full error details
    console.error(`Error on ${path ?? "<no-path>"}: ${error.message}`);
    
    // Also log stack trace in development
    if (env.NODE_ENV === "development" && error.stack) {
      console.error("Stack trace:", error.stack);
    }
  },
});

import { type AppType } from "next/app";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";

import { api } from "~/utils/api";

import "~/styles/globals.css";
import Head from "next/head";
import { Toaster } from "~/components/ui/toaster";

const MyApp: AppType = ({ Component, pageProps }) => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Head>
        <title>Imgur Direct Link Grabber</title>
        <meta
          name="description"
          content="Extract direct image links from any given Imgur gallery URL."
        ></meta>
        <meta property="og:title" content="Imgur Direct Link Grabber" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://imgur.plen.io/" />
      </Head>
      <Component {...pageProps} />
      <Toaster />
      <Analytics />
    </ThemeProvider>
  );
};

export default api.withTRPC(MyApp);

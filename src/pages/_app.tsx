import { type AppType } from "next/app";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";

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
        <title>imgur.plen.io</title>
        <link rel="icon" href="/favicon.ico?v=2" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" sizes="180x180" />
        <meta
          name="description"
          content="Extract direct image, GIF, and video links from public Imgur posts in your browser."
        ></meta>
        <meta property="og:title" content="imgur.plen.io · Direct Imgur links" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://imgur.plen.io/" />
      </Head>
      <Component {...pageProps} />
      <Toaster />
      <Analytics />
    </ThemeProvider>
  );
};

export default MyApp;

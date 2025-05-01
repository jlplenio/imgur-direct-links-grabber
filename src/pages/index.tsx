import { useState, useEffect } from "react";
import { api } from "~/utils/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import extractImgurId from "~/utils/link-cleaner";
import {
  copyToClipboard,
  shuffleLinks,
  toggleImgTagsOnLinks,
} from "~/utils/formatter";
import { ButtonLoading } from "~/components/button-loading";
import { ModeToggle } from "~/components/ThemeToggle";
import KoFiButton from "~/components/KoFiButton";
import ReactPlayer from "react-player";
import { shouldShowFundingPrompt } from "~/utils/link-cleaner";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { TRPCClientError } from "@trpc/client";

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [previewUrl, setPreviewUrl] = useState<{
    url: string;
    type: "image" | "video";
  } | null>(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [showFundingDialog, setShowFundingDialog] = useState(false);

  // Setup the mutation with useMutation hook
  const { mutateAsync, isLoading, error } = api.imgur.getLinks.useMutation();

  // Add an effect to handle persistent errors
  useEffect(() => {
    if (error) {
      console.log("error", error);
      if (error instanceof TRPCClientError) {
        setTextareaValue(error.message);
        console.error("TRPC Error:", error.message);
      } else {
        setTextareaValue("An unexpected error occurred");
        console.error("Unknown Error:", error);
      }
      setPreviewUrl(null);
    }
  }, [error]);

  const handleWrapLinks = () => {
    const result = toggleImgTagsOnLinks(textareaValue);
    setTextareaValue(result);
    // Or handle the result differently as per your needs
  };

  const handleShuffleLinks = () => {
    const result = shuffleLinks(textareaValue);
    setTextareaValue(result);
    // Or handle the result differently as per your needs
  };

  async function handleSubmit() {
    if (extractImgurId(inputValue) == null) {
      setTextareaValue("Invalid URL format");
      setPreviewUrl(null);
      return;
    }

    setTextareaValue("loading...");
    setPreviewUrl(null);
    const data = await mutateAsync({ url: inputValue });
    setTextareaValue(data);
    // Set the first URL as preview and determine its type
    const firstUrl = data.split("\n")[0];
    if (firstUrl) {
      const isVideo = firstUrl.endsWith(".mp4") || firstUrl.endsWith(".gifv");
      setPreviewUrl({ url: firstUrl, type: isVideo ? "video" : "image" });
    }
    setProcessedCount((prev) => {
      const newCount = prev + 1;
      if (shouldShowFundingPrompt(newCount)) {
        setShowFundingDialog(true);
      }
      return newCount;
    });
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="w-full max-w-lg rounded-b-xl border-b border-l border-r p-5 shadow-lg">
        <div className="flex flex-col items-center space-y-8">
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              <div>Imgur Direct Link Grabber | imgur.plen.io</div>
            </h1>
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700 ring-1 ring-inset ring-teal-600/20 dark:bg-teal-900/30 dark:text-teal-400 dark:ring-teal-500/20">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                <span>Added support for all Imgur links and media types</span>
              </div>
            </div>
            <p className="text-l text-gray-500 dark:text-gray-400">
              Enter an Imgur URL to get media direct links.
            </p>
          </div>
          <div className="w-full max-w-md space-y-2">
            <Label className="text-l font-semibold" htmlFor="url">
              Gallery URL
            </Label>
            <div className="flex">
              <div className=" w-3/4 pr-6">
                <Input
                  id="url"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="https://imgur.com/..."
                />
              </div>
              {isLoading ? (
                <ButtonLoading />
              ) : (
                <Button className="w-1/4" onClick={handleSubmit}>
                  Go
                </Button>
              )}
            </div>
          </div>
          <div className="flex w-full max-w-md">
            <div className="w-3/4 space-y-4 pr-6">
              <Textarea
                value={textareaValue}
                readOnly
                className="h-64 w-full resize-none text-xs"
              />
            </div>
            <div className="flex w-1/4 flex-1 flex-col">
              <Button
                variant="secondary"
                onClick={() => copyToClipboard(textareaValue)}
                disabled={!textareaValue}
              >
                To Clipboard
              </Button>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => handleShuffleLinks()}
                disabled={!textareaValue}
              >
                Shuffle Links
              </Button>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => handleWrapLinks()}
                disabled={!textareaValue}
              >
                IMG Tags
              </Button>
              <div className="ml-auto mt-auto">
                <ModeToggle />
              </div>
            </div>
          </div>
          {previewUrl && (
            <div className="mt-4 w-full max-w-md">
              <Label className="text-l mb-2 block font-semibold">Preview</Label>
              <div className="relative h-48 w-full overflow-hidden rounded-lg">
                {previewUrl.type === "image" ? (
                  <img
                    src={previewUrl.url}
                    alt="Preview"
                    className="object-contain w-full h-full"
                  />
                ) : (
                  <ReactPlayer
                    url={previewUrl.url}
                    width="100%"
                    height="100%"
                    controls
                    playing
                    muted
                    loop
                    style={{ objectFit: "contain" }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2 text-card-foreground shadow-sm">
          <div className="text-sm text-muted-foreground">
            Help keep this tool free
          </div>
          <div className="h-4 w-px bg-border" aria-hidden="true" />
          <KoFiButton />
        </div>

        <a
          href="https://github.com/jlplenio/imgur-direct-links-grabber"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-50 transition-opacity hover:opacity-100"
        >
          <img
            className="dark:invert"
            src="/github_logo.svg"
            alt="GitHub Mark"
            width={32}
            height={22}
          />
        </a>
      </div>

      <Dialog open={showFundingDialog} onOpenChange={setShowFundingDialog}>
        <DialogContent className="sm:max-w-[380px]">
          <div className="space-y-3">
            <DialogTitle className="text-center text-lg">
              Help Keep This Tool Free
            </DialogTitle>
            <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="flex items-center gap-2.5">
                <div className="rounded-full bg-amber-100 p-1.5 dark:bg-amber-900">
                  <svg
                    className="h-4 w-4 text-amber-600 dark:text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  {processedCount} links converted - thank you!
                </div>
              </div>
            </div>
            <div className="flex justify-center">
              <KoFiButton />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  parseMediaUrls,
  type MediaItem,
} from "~/utils/formatter";
import { ButtonLoading } from "~/components/button-loading";
import { ModeToggle } from "~/components/ThemeToggle";
import KoFiButton from "~/components/KoFiButton";
import ReactPlayer from "react-player";
import { shouldShowFundingPrompt } from "~/utils/link-cleaner";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { TRPCClientError } from "@trpc/client";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [previewUrls, setPreviewUrls] = useState<MediaItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null,
  );
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
      setPreviewUrls([]);
      setSelectedImageIndex(null);
    }
  }, [error]);

  // Parse URLs when textarea value changes (for gallery)
  useEffect(() => {
    if (
      textareaValue &&
      !textareaValue.startsWith("loading") &&
      !textareaValue.startsWith("Invalid") &&
      !textareaValue.includes("error")
    ) {
      const mediaItems: MediaItem[] = parseMediaUrls(textareaValue);
      setPreviewUrls(mediaItems);
    } else if (
      !textareaValue ||
      textareaValue.startsWith("loading") ||
      textareaValue.startsWith("Invalid")
    ) {
      setPreviewUrls([]);
      setSelectedImageIndex(null);
    }
  }, [textareaValue]);

  // Keyboard navigation for full-size view
  useEffect(() => {
    if (selectedImageIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && selectedImageIndex > 0) {
        setSelectedImageIndex(selectedImageIndex - 1);
      } else if (
        e.key === "ArrowRight" &&
        selectedImageIndex < previewUrls.length - 1
      ) {
        setSelectedImageIndex(selectedImageIndex + 1);
      } else if (e.key === "Escape") {
        setSelectedImageIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedImageIndex, previewUrls.length]);

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
      setPreviewUrls([]);
      setSelectedImageIndex(null);
      return;
    }

    setTextareaValue("loading...");
    setPreviewUrls([]);
    setSelectedImageIndex(null);
    
    try {
      const data = await mutateAsync({ url: inputValue });
      setTextareaValue(data);
      setProcessedCount((prev) => {
        const newCount = prev + 1;
        if (shouldShowFundingPrompt(newCount)) {
          setShowFundingDialog(true);
        }
        return newCount;
      });
    } catch (err) {
      // Error handling is done in useEffect
      setPreviewUrls([]);
      setSelectedImageIndex(null);
    }
  }

  const handleThumbnailClick = (index: number) => {
    setSelectedImageIndex(index);
  };

  const handlePrevious = () => {
    if (selectedImageIndex !== null && selectedImageIndex > 0) {
      setSelectedImageIndex(selectedImageIndex - 1);
    }
  };

  const handleNext = () => {
    if (
      selectedImageIndex !== null &&
      selectedImageIndex < previewUrls.length - 1
    ) {
      setSelectedImageIndex(selectedImageIndex + 1);
    }
  };

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
          {previewUrls.length > 0 && (() => {
            // Calculate grid layout based on image count
            let cols: string;
            let gap: string;
            
            if (previewUrls.length > 100) {
              cols = "grid-cols-5 sm:grid-cols-8 md:grid-cols-10";
              gap = "gap-0.5";
            } else if (previewUrls.length > 50) {
              cols = "grid-cols-4 sm:grid-cols-6 md:grid-cols-8";
              gap = "gap-1";
            } else if (previewUrls.length > 20) {
              cols = "grid-cols-3 sm:grid-cols-4 md:grid-cols-6";
              gap = "gap-1.5";
            } else {
              cols = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
              gap = "gap-2";
            }
            
            return (
              <div className="mt-4 w-full max-w-md">
                <Label className="text-l mb-3 block font-semibold">
                  Preview Gallery ({previewUrls.length}{" "}
                  {previewUrls.length === 1 ? "item" : "items"})
                </Label>
                <div className="h-96 overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className={`grid ${cols} ${gap}`}>
                    {previewUrls.map((item: MediaItem, index: number) => (
                      <button
                        key={index}
                        onClick={() => handleThumbnailClick(index)}
                        className="group relative aspect-square overflow-hidden rounded-md border border-border transition-all hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                      >
                        {item.type === "image" ? (
                          <img
                            src={item.url}
                            alt={`Preview ${index + 1}`}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="relative h-full w-full bg-gray-100 dark:bg-gray-800">
                            <ReactPlayer
                              url={item.url}
                              width="100%"
                              height="100%"
                              light
                              playing={false}
                              controls={false}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
                              <Play className="h-3 w-3 text-white drop-shadow-lg sm:h-4 sm:w-4" />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
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

      {/* Full-size image/video viewer */}
      {(() => {
        const selectedItem: MediaItem | null =
          selectedImageIndex !== null &&
          selectedImageIndex >= 0 &&
          selectedImageIndex < previewUrls.length
            ? previewUrls[selectedImageIndex] ?? null
            : null;

        return (
          <Dialog
            open={selectedImageIndex !== null && selectedItem !== null}
            onOpenChange={(open) => {
              if (!open) setSelectedImageIndex(null);
            }}
          >
            <DialogContent className="max-w-4xl p-0">
              {selectedItem && (
                <div className="relative">
                  <div className="relative flex aspect-video max-h-[80vh] items-center justify-center bg-black">
                    {selectedItem.type === "image" ? (
                      <img
                        src={selectedItem.url}
                        alt={`Full size ${(selectedImageIndex ?? 0) + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <ReactPlayer
                        url={selectedItem.url}
                        width="100%"
                        height="100%"
                        controls
                        playing
                        style={{ maxHeight: "80vh" }}
                      />
                    )}
                  </div>

                  {/* Navigation buttons */}
                  {previewUrls.length > 1 && selectedImageIndex !== null && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-50"
                        onClick={handlePrevious}
                        disabled={selectedImageIndex === 0}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-50"
                        onClick={handleNext}
                        disabled={selectedImageIndex === previewUrls.length - 1}
                      >
                        <ChevronRight className="h-6 w-6" />
                      </Button>
                    </>
                  )}

                  {/* Image counter */}
                  {selectedImageIndex !== null && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-sm text-white">
                      {selectedImageIndex + 1} / {previewUrls.length}
                    </div>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}

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

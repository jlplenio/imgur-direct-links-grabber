import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { api } from "~/utils/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import extractImgurId, { shouldShowFundingPrompt } from "~/utils/link-cleaner";
import {
  copyToClipboard,
  formatMediaItems,
  parseMediaUrls,
  shuffleItems,
  type MediaItem,
  type OutputFormat,
} from "~/utils/formatter";
import { createMediaZip } from "~/utils/download";
import { ButtonLoading } from "~/components/button-loading";
import { ModeToggle } from "~/components/ThemeToggle";
import KoFiButton from "~/components/KoFiButton";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Download,
  Loader2,
  ChevronDown,
  Type,
} from "lucide-react";
import { toast } from "~/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("plain");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null,
  );
  const [processedCount, setProcessedCount] = useState(0);
  const [showFundingDialog, setShowFundingDialog] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const selectedThumbnailRef = useRef<HTMLButtonElement | null>(null);
  const { mutateAsync, isLoading } = api.imgur.getLinks.useMutation();

  const textareaValue = formatMediaItems(mediaItems, outputFormat);
  const previewUrls = mediaItems;

  useEffect(() => {
    if (shouldShowFundingPrompt(processedCount)) {
      setShowFundingDialog(true);
    }
  }, [processedCount]);

  const handleFormat = (format: OutputFormat) => {
    setOutputFormat(format);
  };

  const handleShuffleLinks = () => {
    setMediaItems((items) => shuffleItems(items));
    setSelectedImageIndex(null);
  };

  const handleDownloadZip = async () => {
    if (mediaItems.length === 0 || isDownloadingZip) return;
    setIsDownloadingZip(true);

    try {
      const { blob, successCount, failedUrls } =
        await createMediaZip(mediaItems);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "imgur_media_" + Date.now() + ".zip";
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      toast({
        title:
          failedUrls.length > 0
            ? "Download started with missing items"
            : "Download started",
        description:
          successCount +
          " item" +
          (successCount === 1 ? "" : "s") +
          " included." +
          (failedUrls.length > 0
            ? " " + failedUrls.length + " failed to download. Please try again."
            : ""),
        variant: failedUrls.length > 0 ? "destructive" : "default",
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not create the ZIP file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    if (extractImgurId(inputValue) === null) {
      setRequestError("Enter a valid Imgur album, gallery, or image URL.");
      return;
    }

    setRequestError(null);
    setHasLoaded(false);
    setMediaItems([]);
    setSelectedImageIndex(null);

    try {
      const data = await mutateAsync({ url: inputValue });
      const items = parseMediaUrls(data);
      setMediaItems(items);
      setHasLoaded(true);
      if (items.length > 0) setProcessedCount((count) => count + 1);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred. Please try again.",
      );
    }
  }

  const handleViewerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      selectedImageIndex === null ||
      mediaItems[selectedImageIndex]?.type === "video" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, video, [role=slider], [contenteditable=true]",
        ))
    )
      return;

    if (event.key === "ArrowLeft" && selectedImageIndex > 0) {
      event.preventDefault();
      setSelectedImageIndex(selectedImageIndex - 1);
    } else if (
      event.key === "ArrowRight" &&
      selectedImageIndex < mediaItems.length - 1
    ) {
      event.preventDefault();
      setSelectedImageIndex(selectedImageIndex + 1);
    }
  };

  const handleThumbnailClick = (
    index: number,
    thumbnail: HTMLButtonElement,
  ) => {
    selectedThumbnailRef.current = thumbnail;
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
                <span>
                  More album ID support, download, formatting and preview
                  gallery (Nov25)
                </span>
              </div>
            </div>
            <p className="text-l text-gray-500 dark:text-gray-400">
              Enter an Imgur URL to get media direct links.
            </p>
          </div>
          <form className="w-full max-w-md space-y-2" onSubmit={handleSubmit}>
            <Label className="text-l font-semibold" htmlFor="url">
              Gallery URL
            </Label>
            <div className="flex">
              <div className=" w-3/4 pr-6">
                <Input
                  id="url"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  aria-invalid={Boolean(
                    requestError && extractImgurId(inputValue) === null,
                  )}
                  aria-describedby={requestError ? "url-error" : undefined}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="https://imgur.com/..."
                />
              </div>
              {isLoading ? (
                <ButtonLoading />
              ) : (
                <Button className="w-1/4" type="submit">
                  Go
                </Button>
              )}
            </div>
            {requestError && (
              <p
                id="url-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {requestError}
              </p>
            )}
            <p role="status" className="text-sm text-muted-foreground">
              {isLoading
                ? "Fetching media links…"
                : mediaItems.length > 0
                  ? mediaItems.length + " media links ready."
                  : hasLoaded
                    ? "No supported media links were found in this album."
                    : ""}
            </p>
          </form>
          <div className="flex w-full max-w-md flex-col gap-4 sm:flex-row">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="media-output">Direct links</Label>
              <Textarea
                id="media-output"
                value={textareaValue}
                readOnly
                className="h-64 w-full resize-none text-xs"
              />
            </div>
            <div className="flex flex-col sm:w-36 sm:pt-8">
              <Button
                variant="secondary"
                onClick={() => copyToClipboard(textareaValue)}
                disabled={mediaItems.length === 0}
              >
                To Clipboard
              </Button>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => handleShuffleLinks()}
                disabled={mediaItems.length === 0}
              >
                Shuffle Links
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="mt-2"
                    variant="secondary"
                    disabled={mediaItems.length === 0}
                  >
                    <Type className="mr-2 h-4 w-4 shrink-0 stroke-[1.5]" />
                    Format
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 stroke-[1.5]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleFormat("plain")}>
                    Plain URLs
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFormat("bbcode")}>
                    BBCode [IMG]
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFormat("html")}>
                    HTML &lt;img&gt;
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFormat("markdown")}>
                    Markdown ![image]
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={handleDownloadZip}
                disabled={previewUrls.length === 0 || isDownloadingZip}
              >
                {isDownloadingZip ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin stroke-[1.5]" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4 shrink-0 stroke-[1.5]" />
                    Download
                  </>
                )}
              </Button>
              <div className="ml-auto mt-auto">
                <ModeToggle />
              </div>
            </div>
          </div>
          {previewUrls.length > 0 &&
            (() => {
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
                          key={item.url + ":" + index}
                          type="button"
                          aria-label={`Open ${item.type} ${index + 1}`}
                          onClick={(event) =>
                            handleThumbnailClick(index, event.currentTarget)
                          }
                          className="group relative aspect-square overflow-hidden rounded-md border border-border transition-all hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                        >
                          {item.type === "image" ? (
                            <img
                              src={item.url}
                              alt=""
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800">
                              <Play aria-hidden="true" className="h-6 w-6" />
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

      <div className="mt-6 flex w-full flex-col items-center gap-3 px-3">
        <div className="flex max-w-full flex-col items-center gap-3 rounded-lg border bg-card px-4 py-2 text-card-foreground shadow-sm sm:flex-row">
          <div className="text-sm text-muted-foreground">
            Help keep this tool free
          </div>
          <div
            className="hidden h-4 w-px bg-border sm:block"
            aria-hidden="true"
          />
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
            ? (previewUrls[selectedImageIndex] ?? null)
            : null;

        return (
          <Dialog
            open={selectedImageIndex !== null && selectedItem !== null}
            onOpenChange={(open) => {
              if (!open) setSelectedImageIndex(null);
            }}
          >
            <DialogContent
              className="max-w-4xl p-0"
              aria-describedby={undefined}
              onKeyDown={handleViewerKeyDown}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                selectedThumbnailRef.current?.focus();
              }}
            >
              <DialogTitle className="sr-only">Media viewer</DialogTitle>
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
                      <video
                        key={selectedItem.url}
                        src={selectedItem.url}
                        aria-label={`Video ${(selectedImageIndex ?? 0) + 1}`}
                        className="max-h-[80vh] max-w-full"
                        controls
                        autoPlay
                        playsInline
                        preload="metadata"
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
                        aria-label="Previous media"
                        disabled={selectedImageIndex === 0}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-50"
                        onClick={handleNext}
                        aria-label="Next media"
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
        <DialogContent
          className="sm:max-w-[380px]"
          aria-describedby={undefined}
        >
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

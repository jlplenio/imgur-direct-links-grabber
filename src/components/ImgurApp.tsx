/* eslint-disable @next/next/no-img-element -- Load original media directly without an image proxy. */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Github,
  Heart,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Moon,
  Play,
  Shuffle,
  Sun,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { resolveImgur } from "~/lib/imgur";
import { createMediaZip } from "~/utils/download";
import {
  formatMediaItems,
  shuffleItems,
  type MediaItem,
  type OutputFormat,
} from "~/utils/formatter";
import extractLinkInfo from "~/utils/link-cleaner";
import styles from "~/styles/design-preview.module.css";

type PreviewItem = MediaItem & {
  caption?: string;
  videoUrl?: string;
  note?: string;
};

function ThumbnailMedia({ item }: { item: PreviewItem }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={styles.thumbnailError}>
        <ImageIcon size={22} strokeWidth={1.5} aria-hidden="true" />
        <span>Preview unavailable</span>
      </span>
    );
  }

  return item.type === "image" ? (
    <img
      src={item.url}
      alt={item.caption ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <Play size={28} strokeWidth={1.5} aria-hidden="true" />
  );
}

function SelectedMedia({ item, index }: { item: PreviewItem; index: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={styles.mediaError} role="status">
        <ImageIcon size={30} strokeWidth={1.4} aria-hidden="true" />
        <p>This {item.type} preview is unavailable.</p>
        <span>The file may be unavailable or unsupported by your browser.</span>
        <a
          className={styles.textButton}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open original <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
    );
  }

  return item.type === "image" ? (
    <img
      className={styles.dialogImage}
      src={item.url}
      alt={item.caption ?? `Image ${index + 1}`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <video
      className={styles.dialogImage}
      src={item.url}
      controls
      autoPlay
      playsInline
      aria-label={item.caption ?? `Video ${index + 1}`}
      onError={() => setFailed(true)}
    />
  );
}

const samples = [
  ["01-forest.jpg", "Forest light"],
  ["02-lake.jpg", "Mountain lake"],
  ["03-coast.jpg", "Coastal blue"],
  ["04-mountains.jpg", "Alpine peaks"],
  ["05-meadow.jpg", "Morning meadow"],
  ["06-canyon.jpg", "Desert contours"],
] as const;

const videoSamples = [
  ["07-flower.mp4", "Flower in the breeze · MP4"],
  ["08-flower.webm", "Flower in the breeze · WebM"],
] as const;
type SampleKind = "photos" | "mixed" | "large";

const formats: { value: OutputFormat; label: string }[] = [
  { value: "plain", label: "Plain URLs" },
  { value: "bbcode", label: "BBCode" },
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
];

export default function ImgurApp() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [input, setInput] = useState("");
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [format, setFormat] = useState<OutputFormat>("plain");
  const [isSample, setIsSample] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const thumbnailRef = useRef<HTMLButtonElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const lookupRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<AbortController | null>(null);
  const output = formatMediaItems(items, format);
  const selectedItem = selected === null ? undefined : items[selected];

  const loadSample = useCallback((kind: SampleKind = "photos") => {
    lookupRef.current?.abort();
    lookupRef.current = null;
    setIsLoading(false);
    downloadRef.current?.abort();
    downloadRef.current = null;
    setDownloading(false);
    const collection =
      kind === "photos"
        ? samples
        : [videoSamples[0], samples[0], videoSamples[1], ...samples.slice(1)];
    const count = kind === "large" ? 1000 : collection.length;
    setItems(
      Array.from({ length: count }, (_, index): PreviewItem => {
        const [filename, caption] = collection[index % collection.length]!;
        const url = new URL(
          `/design-preview/${filename}`,
          window.location.origin,
        );
        if (kind === "large") url.searchParams.set("sample", String(index + 1));
        return {
          url: url.href,
          type: /\.(mp4|webm)$/.test(filename) ? "video" : "image",
          caption: kind === "large" ? `${caption} · ${index + 1}` : caption,
        };
      }),
    );
    setIsSample(true);
    setHasLoaded(true);
    setInput("");
    setError(null);
    setNotice(null);
    setSelected(null);
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.sample === "1") loadSample();
    if (router.query.sample === "videos") loadSample("mixed");
    if (router.query.sample === "large") loadSample("large");
  }, [router.isReady, router.query.sample, loadSample]);

  useEffect(() => {
    setCopied(false);
    clearTimeout(copyTimer.current);
  }, [output]);

  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      lookupRef.current?.abort();
      lookupRef.current = null;
      downloadRef.current?.abort();
      downloadRef.current = null;
    },
    [],
  );

  function cancelLookup() {
    lookupRef.current?.abort();
    lookupRef.current = null;
    setIsLoading(false);
    setNotice("Lookup cancelled. You can try another link.");
  }

  function cancelDownload() {
    downloadRef.current?.abort();
    downloadRef.current = null;
    setDownloading(false);
    setNotice("Download cancelled.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookupRef.current) return;
    if (!extractLinkInfo(input)) {
      setError("Enter a valid Imgur album, gallery, or image link.");
      return;
    }
    downloadRef.current?.abort();
    downloadRef.current = null;
    setDownloading(false);
    setError(null);
    setNotice(null);
    setItems([]);
    setIsSample(false);
    setHasLoaded(false);
    setSelected(null);
    const controller = new AbortController();
    lookupRef.current = controller;
    setIsLoading(true);
    try {
      const result = await resolveImgur(input, { signal: controller.signal });
      if (lookupRef.current !== controller) return;
      setItems(result.items);
      setHasLoaded(true);
      if (result.items.some((item) => item.note)) {
        setNotice(
          "Some original files could not be verified. Available video or preview links are included instead.",
        );
      }
    } catch (cause) {
      if (lookupRef.current !== controller) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      if (lookupRef.current === controller) {
        lookupRef.current = null;
        setIsLoading(false);
      }
    }
  }

  async function copyLinks() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setNotice(null);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setNotice(
        "Copy is unavailable. The links are selected so you can copy them manually.",
      );
    }
  }

  async function download() {
    if (downloadRef.current !== null || items.length === 0) return;
    const controller = new AbortController();
    downloadRef.current = controller;
    setDownloading(true);
    setNotice(null);
    try {
      const { blob, successCount, failedUrls } = await createMediaZip(items, {
        signal: controller.signal,
      });
      if (downloadRef.current !== controller) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `imgur-${Date.now()}.zip`;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(
        `Download started with ${successCount} ${successCount === 1 ? "file" : "files"}.${failedUrls.length ? ` ${failedUrls.length} could not be downloaded.` : ""}`,
      );
    } catch (cause) {
      if (downloadRef.current !== controller) return;
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Could not prepare your download. Please try again.",
      );
    } finally {
      if (downloadRef.current === controller) {
        downloadRef.current = null;
        setDownloading(false);
      }
    }
  }

  const status = isLoading
    ? "Getting links…"
    : hasLoaded
      ? `${items.length} ${items.length === 1 ? "link" : "links"} found.`
      : "";

  return (
    <div className={styles.page} data-theme={theme}>
      <Head>
        <title>imgur.plen.io · Direct Imgur links</title>
        <meta name="referrer" content="no-referrer" />
        <link rel="canonical" href="https://imgur.plen.io/" />
        {router.pathname === "/design-preview" && (
          <meta name="robots" content="noindex, nofollow" />
        )}
        <meta
          name="theme-color"
          content={theme === "dark" ? "#121811" : "#f4f5ef"}
        />
      </Head>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link
            href="/"
            className={styles.brand}
            aria-label="imgur.plen.io home"
          >
            <span className={styles.brandIcon}>
              <Link2 size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              imgur<span className={styles.brandSuffix}>.plen.io</span>
            </span>
          </Link>
          <div className={styles.headerRight}>
            <button
              type="button"
              className={styles.themeButton}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? (
                <Moon size={18} aria-hidden="true" />
              ) : (
                <Sun size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        <main>
          <div className={styles.hero}>
            <div>
              <h1>
                Your images. <em>Direct links.</em>
              </h1>
              <p>Direct links to your Imgur images, GIFs, and videos.</p>
            </div>
          </div>

          <section
            className={styles.workspace}
            aria-label="Imgur link extractor"
          >
            <form className={styles.inputSection} onSubmit={submit}>
              <div className={styles.fieldLabel}>
                <label htmlFor="draft-url">Imgur link</label>
                <button
                  type="button"
                  onClick={isLoading ? cancelLookup : () => loadSample()}
                  className={styles.textButton}
                >
                  {isLoading ? "Cancel" : "Try a sample"}
                </button>
              </div>
              <div className={styles.inputRow}>
                <div className={styles.urlField}>
                  <Link2 size={18} strokeWidth={1.6} aria-hidden="true" />
                  <input
                    id="draft-url"
                    type="url"
                    required
                    readOnly={isLoading}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="https://imgur.com/a/your-album"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    aria-invalid={Boolean(error && !extractLinkInfo(input))}
                    aria-describedby={error ? "draft-error" : undefined}
                  />
                </div>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2
                      size={17}
                      className={styles.spinner}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isLoading ? "Getting links…" : "Get links"}
                  {!isLoading && <ArrowUpRight size={18} aria-hidden="true" />}
                </button>
              </div>
              {error && (
                <p id="draft-error" className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </form>

            <div className={styles.srOnly} role="status" aria-atomic="true">
              {status}
            </div>

            {isLoading && (
              <div className={styles.loadingState} aria-hidden="true">
                <span className={styles.loadingThumbnail}>
                  <ImageIcon size={22} strokeWidth={1.4} />
                </span>
                <div className={styles.loadingLines}>
                  <span />
                  <span />
                </div>
              </div>
            )}
            {hasLoaded && items.length === 0 && (
              <p className={styles.emptyResult}>
                No media found in this album.
              </p>
            )}
            {items.length > 0 && (
              <div className={styles.resultPanel}>
                <div
                  className={styles.results}
                  data-size={
                    items.length <= 3
                      ? "small"
                      : items.length <= 6
                        ? "medium"
                        : "large"
                  }
                >
                  <section
                    className={styles.linksPane}
                    aria-labelledby="draft-links-title"
                  >
                    <div className={styles.paneHeader}>
                      <div className={styles.sectionHeading}>
                        <h2 id="draft-links-title">
                          Links
                          {items.length > 0 && (
                            <span className={styles.count}>{items.length}</span>
                          )}
                        </h2>
                        <div
                          className={styles.formatTabs}
                          role="group"
                          aria-label="Link format"
                        >
                          {formats.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={styles.formatTab}
                              aria-pressed={format === option.value}
                              onClick={() => setFormat(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <label htmlFor="draft-output" className={styles.srOnly}>
                      Formatted direct media links
                    </label>
                    <textarea
                      id="draft-output"
                      ref={outputRef}
                      className={styles.linkOutput}
                      readOnly
                      rows={Math.max(2, Math.min(items.length, 8))}
                      wrap="off"
                      spellCheck={false}
                      value={output}
                      placeholder="Links appear here"
                    />
                  </section>

                  <section
                    className={styles.galleryPane}
                    aria-labelledby="draft-gallery-title"
                  >
                    <div className={styles.paneHeader}>
                      <div className={styles.sectionHeading}>
                        <h2 id="draft-gallery-title">Preview</h2>
                        {isSample && (
                          <span className={styles.sampleBadge}>Sample</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.galleryViewport}>
                      {items.length > 0 ? (
                        <div
                          className={styles.galleryGrid}
                          data-count={items.length}
                        >
                          {items.map((item, index) => (
                            <button
                              key={`${item.url}-${index}`}
                              type="button"
                              className={styles.thumbnail}
                              aria-label={`Open ${item.caption ?? `${item.type} ${index + 1}`}`}
                              onClick={(event) => {
                                thumbnailRef.current = event.currentTarget;
                                setSelected(index);
                              }}
                            >
                              <ThumbnailMedia item={item} />
                              <span className={styles.thumbnailNumber}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className={styles.thumbnailOpen}>
                                <Maximize2 size={13} aria-hidden="true" />
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.emptyGallery}>
                          <span>
                            <ImageIcon
                              size={29}
                              strokeWidth={1.25}
                              aria-hidden="true"
                            />
                          </span>
                          <p>
                            {hasLoaded
                              ? "No media found."
                              : "Your media will appear here."}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <div className={styles.workspaceFooter}>
                  <div className={styles.resultActions}>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={copyLinks}
                      disabled={items.length === 0}
                    >
                      {copied ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Copy size={16} aria-hidden="true" />
                      )}
                      {copied ? "Copied!" : "Copy links"}
                    </button>
                    <button
                      className={styles.textButton}
                      type="button"
                      disabled={items.length === 0}
                      onClick={() => {
                        downloadRef.current?.abort();
                        downloadRef.current = null;
                        setDownloading(false);
                        setItems(shuffleItems(items));
                        setSelected(null);
                      }}
                    >
                      <Shuffle size={15} aria-hidden="true" /> Shuffle
                    </button>
                  </div>
                  <div className={styles.downloadActions}>
                    {downloading && (
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={cancelDownload}
                      >
                        Cancel download
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.textButton}
                      disabled={items.length === 0 || downloading}
                      onClick={download}
                    >
                      {downloading ? (
                        <Loader2
                          size={15}
                          className={styles.spinner}
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowDownToLine size={15} aria-hidden="true" />
                      )}
                      {downloading ? "Preparing ZIP…" : "Download ZIP"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          <aside className={styles.support} aria-label="Support this tool">
            <Heart
              className={styles.supportIcon}
              size={23}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <div className={styles.supportText}>
              <h2>Find this useful?</h2>
              <p>Your support helps keep this tool free.</p>
            </div>
            <a
              className={styles.supportLink}
              href="https://ko-fi.com/W7W512ZD8I"
              target="_blank"
              rel="noopener noreferrer"
            >
              Say thanks <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </aside>
        </main>

        <footer className={styles.footer}>
          <span>Not affiliated with Imgur.</span>
          <div className={styles.footerLinks}>
            <a
              href="https://github.com/jlplenio/imgur-direct-links-grabber"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={13} aria-hidden="true" /> Source
            </a>
          </div>
        </footer>
      </div>

      <Dialog
        open={Boolean(selectedItem)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className={styles.dialog}
          data-theme={theme}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            thumbnailRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (
              selected === null ||
              selectedItem?.type === "video" ||
              event.altKey ||
              event.metaKey ||
              event.ctrlKey ||
              event.defaultPrevented
            )
              return;
            if (event.key === "ArrowLeft" && selected > 0) {
              event.preventDefault();
              setSelected(selected - 1);
            }
            if (event.key === "ArrowRight" && selected < items.length - 1) {
              event.preventDefault();
              setSelected(selected + 1);
            }
          }}
        >
          <DialogTitle className={styles.dialogTitle}>
            {selectedItem?.caption ?? "Media preview"}
          </DialogTitle>
          {selectedItem && selected !== null && (
            <SelectedMedia
              key={`${selectedItem.url}-${selected}`}
              item={selectedItem}
              index={selected}
            />
          )}
          <div className={styles.dialogToolbar}>
            <span>
              {(selected ?? 0) + 1} / {items.length}
            </span>
            <div>
              {selectedItem && (
                <a
                  className={styles.textButton}
                  href={selectedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open original <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
              {selectedItem?.videoUrl &&
                selectedItem.videoUrl !== selectedItem.url && (
                  <a
                    className={styles.textButton}
                    href={selectedItem.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MP4 <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
              <button
                type="button"
                className={styles.iconButton}
                disabled={selected === null || selected === 0}
                onClick={() =>
                  setSelected((index) =>
                    index === null ? null : Math.max(0, index - 1),
                  )
                }
                aria-label="Previous media"
              >
                <ChevronLeft size={19} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                disabled={selected === null || selected === items.length - 1}
                onClick={() =>
                  setSelected((index) =>
                    index === null
                      ? null
                      : Math.min(items.length - 1, index + 1),
                  )
                }
                aria-label="Next media"
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

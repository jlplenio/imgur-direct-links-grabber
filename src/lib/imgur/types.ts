export type GifCandidate = {
  url: string;
  size: number;
  width: number;
  height: number;
};

export type GifVerification =
  | { status: "unverified" | "not-gif"; reason: string }
  | {
      status: "verified";
      url: string;
      width: number;
      height: number;
      bytesRead: number;
      totalBytes: number | null;
      sizeMatchesMetadata: boolean | null;
    };

export type ImgurMediaItem = {
  id: string;
  url: string;
  type: "image" | "video";
  animated: boolean;
  width: number | null;
  height: number | null;
  videoUrl?: string;
  gifVerified?: boolean;
  gifVerification?: GifVerification;
  gifCandidate?: GifCandidate;
  originalFromThumbnail?: boolean;
  originalVerified?: boolean;
  note?: string;
};

export type ImgurCollection = {
  id: string;
  title: string | null;
  count: number;
  items: ImgurMediaItem[];
};

export type ImgurResult = ImgurCollection & {
  source: "embed" | "direct";
  requests: number;
};

export type ResolveOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

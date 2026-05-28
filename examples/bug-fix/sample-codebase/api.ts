import { formatPreview, takeFirst } from "./utils";

export interface Digest {
  headline: string;
  preview: string[];
}

export function buildDigest(events: string[]): Digest {
  const preview = takeFirst(events, 3);

  return {
    headline: formatPreview(preview),
    preview,
  };
}

/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

const BLOCKED_PROTOCOLS = new Set(["mailto:", "tel:", "javascript:"]);

const DOWNLOAD_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".gz",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".svg",
  ".tar",
  ".tgz",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip"
]);

export interface UrlEvaluation {
  url?: string;
  skipReason?: string;
}

export function normalizeUrl(rawUrl: string, baseUrl?: string): UrlEvaluation {
  let parsedUrl: URL;

  try {
    parsedUrl = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
  } catch {
    return { skipReason: "invalid-url" };
  }

  if (BLOCKED_PROTOCOLS.has(parsedUrl.protocol)) {
    return { skipReason: `blocked-protocol:${parsedUrl.protocol}` };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { skipReason: `unsupported-protocol:${parsedUrl.protocol}` };
  }

  const extension = getPathExtension(parsedUrl.pathname);

  if (extension && DOWNLOAD_EXTENSIONS.has(extension)) {
    return { skipReason: `download:${extension}` };
  }

  parsedUrl.hash = "";
  return { url: parsedUrl.toString() };
}

export function isSameOrigin(url: string, origin: string): boolean {
  return new URL(url).origin === origin;
}

function getPathExtension(pathname: string): string | undefined {
  const lastSegment = pathname.split("/").pop();

  if (!lastSegment || !lastSegment.includes(".")) {
    return undefined;
  }

  const extension = lastSegment.slice(lastSegment.lastIndexOf(".")).toLowerCase();
  return extension || undefined;
}

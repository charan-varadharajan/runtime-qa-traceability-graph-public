import { chromium, type Browser, type Page, type Request, type Response } from "playwright";
import type {
  ApiClassification,
  CapturedNetworkCall,
  CrawledPage,
  CrawlResult,
  NetworkInventory,
  NetworkInventoryPage,
  NetworkTiming
} from "../types/index.js";

const DEFAULT_CAPTURE_TIMEOUT_MS = 15_000;
const MAX_POST_DATA_CHARS = 4_000;
const MAX_RESPONSE_BODY_BYTES = 80_000;
const MAX_RESPONSE_SAMPLE_CHARS = 6_000;
const STATIC_RESOURCE_TYPES = new Set(["image", "font", "stylesheet", "media"]);
const STATIC_CONTENT_TYPE_PATTERNS = [
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "text/css",
  "image/",
  "font/",
  "audio/",
  "video/"
];
const STATIC_PATH_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".webm",
  ".mp3"
]);
const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|password|secret|api[-_ ]?key|apikey/i;

export interface CaptureNetworkInventoryOptions {
  crawlResult: CrawlResult;
  sourceCrawlPath: string;
  headed: boolean;
  timeoutMs?: number;
}

interface PendingCall {
  request: Request;
  failureText?: string;
}

export async function captureNetworkInventory(
  options: CaptureNetworkInventoryOptions
): Promise<NetworkInventory> {
  const startedAt = new Date().toISOString();
  const pages: NetworkInventoryPage[] = [];
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: !options.headed });
    const context = await browser.newContext({ storageState: options.crawlResult.storageState });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS);
    page.setDefaultTimeout(options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS);

    for (const crawledPage of uniqueBy(options.crawlResult.pages, (page) => page.url)) {
      pages.push(await capturePageNetwork(page, crawledPage));
    }
  } finally {
    await browser?.close();
  }

  const completedAt = new Date().toISOString();
  const calls = pages.flatMap((page) => page.calls);

  return {
    sourceCrawlPath: options.sourceCrawlPath,
    generatedAt: completedAt,
    pages,
    summary: {
      pagesVisited: pages.length,
      failedPages: pages.filter((page) => page.errorMessage).length,
      totalNetworkCalls: calls.length,
      likelyApiCalls: calls.filter((call) => call.likelyApiCall).length,
      failedCalls: calls.filter((call) => (call.statusCode ?? 0) >= 400 || call.failureText).length,
      startedAt,
      completedAt
    }
  };
}

async function capturePageNetwork(page: Page, crawledPage: CrawledPage): Promise<NetworkInventoryPage> {
  const timestamp = new Date().toISOString();
  const pendingCalls = new Map<Request, PendingCall>();
  const capturedCalls: CapturedNetworkCall[] = [];

  const onRequest = (request: Request): void => {
    pendingCalls.set(request, { request });
  };

  const onRequestFailed = (request: Request): void => {
    const pendingCall = pendingCalls.get(request) ?? { request };
    pendingCall.failureText = request.failure()?.errorText;
    pendingCalls.set(request, pendingCall);
  };

  const onRequestFinished = (request: Request): void => {
    if (!pendingCalls.has(request)) {
      pendingCalls.set(request, { request });
    }
  };

  page.on("request", onRequest);
  page.on("requestfailed", onRequestFailed);
  page.on("requestfinished", onRequestFinished);

  try {
    await page.goto(crawledPage.url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_CAPTURE_TIMEOUT_MS
    });

    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await flushPendingCalls(pendingCalls, capturedCalls);
    detachNetworkListeners(page, onRequest, onRequestFailed, onRequestFinished);

    return {
      url: crawledPage.url,
      title: crawledPage.title,
      timestamp,
      calls: sortCalls(capturedCalls),
      errorMessage: message
    };
  }

  await flushPendingCalls(pendingCalls, capturedCalls);
  detachNetworkListeners(page, onRequest, onRequestFailed, onRequestFinished);

  return {
    url: crawledPage.url,
    title: await page.title().catch(() => crawledPage.title),
    timestamp,
    calls: sortCalls(capturedCalls)
  };
}

async function flushPendingCalls(
  pendingCalls: Map<Request, PendingCall>,
  capturedCalls: CapturedNetworkCall[]
): Promise<void> {
  const calls = await Promise.all(Array.from(pendingCalls.values()).map(toCapturedNetworkCall));

  for (const call of calls) {
    if (call && shouldIncludeCall(call) && !hasCapturedCall(capturedCalls, call)) {
      capturedCalls.push(call);
    }
  }

  pendingCalls.clear();
}

function detachNetworkListeners(
  page: Page,
  onRequest: (request: Request) => void,
  onRequestFailed: (request: Request) => void,
  onRequestFinished: (request: Request) => void
): void {
  page.off("request", onRequest);
  page.off("requestfailed", onRequestFailed);
  page.off("requestfinished", onRequestFinished);
}

async function toCapturedNetworkCall(pendingCall: PendingCall): Promise<CapturedNetworkCall | undefined> {
  const request = pendingCall.request;
  const response = await request.response().catch(() => null);
  const responseContentType = getResponseContentType(response);
  const apiIndicators = getApiIndicators(request, responseContentType);
  const likelyApiCall = apiIndicators.length > 0;

  if (request.resourceType() === "script" && !likelyApiCall) {
    return undefined;
  }

  return {
    requestUrl: sanitizeUrlForOutput(request.url()),
    method: request.method(),
    resourceType: request.resourceType(),
    statusCode: response?.status(),
    responseContentType,
    requestPostData: getSafePostData(request),
    responseBodySample: await getSafeResponseBodySample(response, responseContentType),
    timing: getRequestTiming(request),
    likelyApiCall,
    apiIndicators,
    apiClassification: classifyApiCall(request.url()),
    failureText: pendingCall.failureText
  };
}

function shouldIncludeCall(call: CapturedNetworkCall): boolean {
  if (call.likelyApiCall || call.failureText || (call.statusCode ?? 0) >= 400) {
    return true;
  }

  return !isStaticAssetCall(call);
}

function isStaticAssetCall(call: CapturedNetworkCall): boolean {
  if (STATIC_RESOURCE_TYPES.has(call.resourceType)) {
    return true;
  }

  const contentType = call.responseContentType?.toLowerCase() ?? "";

  if (STATIC_CONTENT_TYPE_PATTERNS.some((pattern) => contentType.includes(pattern))) {
    return true;
  }

  try {
    const pathname = new URL(call.requestUrl).pathname.toLowerCase();
    const extension = pathname.slice(pathname.lastIndexOf("."));
    return STATIC_PATH_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

function hasCapturedCall(calls: CapturedNetworkCall[], nextCall: CapturedNetworkCall): boolean {
  return calls.some(
    (call) =>
      call.method === nextCall.method &&
      call.requestUrl === nextCall.requestUrl &&
      call.resourceType === nextCall.resourceType &&
      call.statusCode === nextCall.statusCode
  );
}

function getApiIndicators(request: Request, responseContentType?: string): string[] {
  const indicators: string[] = [];
  const url = request.url().toLowerCase();
  const resourceType = request.resourceType();
  const isHtmlDocument =
    resourceType === "document" && Boolean(responseContentType?.toLowerCase().includes("text/html"));

  if (resourceType === "fetch") {
    indicators.push("fetch");
  }

  if (resourceType === "xhr") {
    indicators.push("xhr");
  }

  if (url.includes("/api/") && !isHtmlDocument) {
    indicators.push("url:/api/");
  }

  if (responseContentType?.toLowerCase().includes("application/json")) {
    indicators.push("json-response");
  }

  if (url.includes("graphql") || looksLikeGraphQlPost(request)) {
    indicators.push("graphql-candidate");
  }

  return indicators;
}

function classifyApiCall(url: string): ApiClassification {
  const value = url.toLowerCase();

  if (/\b(wsdl|wadl|openapi|swagger|api-docs?)\b|[?&]_?wadl\b/.test(value)) {
    return "service_definition";
  }

  if (/\b(auth|oauth|login|logout|signin|signup|session|token)\b/.test(value)) {
    return "auth";
  }

  if (/\b(admin|configuration|initialize|shutdown)\b/.test(value)) {
    return "admin";
  }

  if (/\b(search|query|suggest|autocomplete)\b/.test(value)) {
    return "search";
  }

  if (/\b(account|accounts|profile|customer|transaction|statement)\b/.test(value)) {
    return "account";
  }

  if (/\b(transfer|withdraw|deposit)\b/.test(value)) {
    return "transfer";
  }

  if (/\b(billpay|bill-pay|bill_pay|payee)\b/.test(value)) {
    return "bill_payment";
  }

  if (/\b(loan|mortgage|credit)\b/.test(value)) {
    return "loan";
  }

  if (/\b(product|products|sku|catalog|inventory)\b/.test(value)) {
    return "product";
  }

  if (/\b(cart|basket|bag)\b/.test(value)) {
    return "cart";
  }

  if (/\b(payment|pay now|billing)\b/.test(value)) {
    return "payment";
  }

  if (/\b(checkout|order|purchase)\b/.test(value)) {
    return "checkout";
  }

  if (/\b(content|cms|article|page|post)\b/.test(value)) {
    return "content";
  }

  if (/\b(analytics|collect|telemetry|metrics|segment|gtag|ga4)\b/.test(value)) {
    return "analytics";
  }

  return "unknown";
}

function getResponseContentType(response: Response | null): string | undefined {
  const contentType = response?.headers()["content-type"];
  return contentType ? redactSensitiveString(contentType) : undefined;
}

function getSafePostData(request: Request): unknown {
  const postData = request.postData();

  if (!postData || postData.length > MAX_POST_DATA_CHARS) {
    return undefined;
  }

  return parseAndRedactBody(postData, request.headers()["content-type"]);
}

async function getSafeResponseBodySample(
  response: Response | null,
  responseContentType?: string
): Promise<unknown> {
  if (!response || !responseContentType?.toLowerCase().includes("application/json")) {
    return undefined;
  }

  const headers = response.headers();
  const contentLength = Number(headers["content-length"]);

  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BODY_BYTES) {
    return "[omitted: response too large]";
  }

  try {
    const body = await response.body();

    if (body.byteLength > MAX_RESPONSE_BODY_BYTES) {
      return "[omitted: response too large]";
    }

    const text = body.toString("utf8").slice(0, MAX_RESPONSE_SAMPLE_CHARS);
    return parseAndRedactBody(text, responseContentType);
  } catch {
    return undefined;
  }
}

function parseAndRedactBody(value: string, contentType?: string): unknown {
  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return redactSensitiveValue(JSON.parse(value));
    } catch {
      return redactSensitiveString(value);
    }
  }

  if (contentType?.toLowerCase().includes("x-www-form-urlencoded")) {
    const params = new URLSearchParams(value);
    const output: Record<string, string> = {};

    for (const [key, paramValue] of params.entries()) {
      output[key] = isSensitiveKey(key) ? "[REDACTED]" : redactSensitiveString(paramValue);
    }

    return output;
  }

  return redactSensitiveString(value);
}

function redactSensitiveValue(value: unknown, keyName?: string): unknown {
  if (isSensitiveKey(keyName)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = redactSensitiveValue(nestedValue, key);
    }

    return output;
  }

  if (typeof value === "string") {
    return redactSensitiveString(value);
  }

  return value;
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/(authorization|token|password|secret|api[-_ ]?key|apikey)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

function sanitizeUrlForOutput(value: string): string {
  try {
    const url = new URL(value);

    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return redactSensitiveString(url.toString());
  } catch {
    return redactSensitiveString(value);
  }
}

function isSensitiveKey(keyName?: string): boolean {
  return Boolean(keyName && SENSITIVE_KEY_PATTERN.test(keyName));
}

function looksLikeGraphQlPost(request: Request): boolean {
  if (request.method() !== "POST") {
    return false;
  }

  const postData = request.postData();
  return Boolean(postData && /"query"\s*:/.test(postData));
}

function getRequestTiming(request: Request): NetworkTiming | undefined {
  const timing = request.timing();

  if (!timing) {
    return undefined;
  }

  return {
    startTime: timing.startTime,
    domainLookupStart: timing.domainLookupStart,
    domainLookupEnd: timing.domainLookupEnd,
    connectStart: timing.connectStart,
    secureConnectionStart: timing.secureConnectionStart,
    connectEnd: timing.connectEnd,
    requestStart: timing.requestStart,
    responseStart: timing.responseStart,
    responseEnd: timing.responseEnd
  };
}

function sortCalls(calls: CapturedNetworkCall[]): CapturedNetworkCall[] {
  return [...calls].sort((a, b) => {
    const startA = a.timing?.startTime ?? 0;
    const startB = b.timing?.startTime ?? 0;

    if (startA !== startB) {
      return startA - startB;
    }

    return a.requestUrl.localeCompare(b.requestUrl);
  });
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const uniqueItems: T[] = [];

  for (const item of items) {
    const key = getKey(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

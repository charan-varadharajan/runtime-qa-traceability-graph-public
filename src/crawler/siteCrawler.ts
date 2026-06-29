/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { CrawlAuthSession, CrawledPage, CrawlResult, SkippedUrl } from "../types/index.js";
import { isSameOrigin, normalizeUrl } from "../utils/urlUtils.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const AUTH_SETTLE_TIMEOUT_MS = 3_000;

export interface CrawlSiteOptions {
  startUrl: URL;
  maxPages: number;
  headed: boolean;
  timeoutMs?: number;
  credentials?: CrawlCredentials;
}

export interface CrawlCredentials {
  userName: string;
  password: string;
}

interface GeneratedRegistrationData extends CrawlCredentials {
  email: string;
}

export async function crawlSite(options: CrawlSiteOptions): Promise<CrawlResult> {
  const startedAt = new Date().toISOString();
  const normalizedStart = normalizeUrl(options.startUrl.toString());

  if (!normalizedStart.url) {
    throw new Error(`Start URL cannot be crawled: ${normalizedStart.skipReason ?? "unknown reason"}`);
  }

  const origin = new URL(normalizedStart.url).origin;
  const maxPages = Math.max(1, Math.floor(options.maxPages));
  const queue: string[] = [normalizedStart.url];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const skippedUrls: SkippedUrl[] = [];
  const skippedKeys = new Set<string>();
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let storageState: CrawlResult["storageState"];
  let authSession: CrawlAuthSession = {
    attempted: false,
    method: "none",
    status: "skipped",
    generatedCredentials: false,
    message: "No credentials provided and no registration flow attempted."
  };

  try {
    browser = await chromium.launch({ headless: !options.headed });
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(options.timeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS);

    authSession = await establishSession(page, normalizedStart.url, origin, options.credentials);

    for (const seedUrl of await getSeedUrlsAfterAuth(page, normalizedStart.url, origin)) {
      if (!queued.has(seedUrl)) {
        queue.push(seedUrl);
        queued.add(seedUrl);
      }
    }

    while (queue.length > 0 && pages.length < maxPages) {
      const currentUrl = queue.shift();

      if (!currentUrl || visited.has(currentUrl)) {
        continue;
      }

      visited.add(currentUrl);
      const crawledPage = await crawlPage(page, currentUrl);
      pages.push(crawledPage);

      for (const link of crawledPage.discoveredLinks) {
        if (pages.length + queue.length >= maxPages) {
          break;
        }

        if (!isSameOrigin(link, origin)) {
          recordSkippedUrl(skippedUrls, skippedKeys, link, "cross-origin");
          continue;
        }

        if (!visited.has(link) && !queued.has(link)) {
          queue.push(link);
          queued.add(link);
        }
      }
    }

    storageState = await context.storageState();
  } finally {
    await browser?.close();
  }

  const completedAt = new Date().toISOString();
  const failedPages = pages.filter((page) => page.errorMessage).length;

  return {
    startUrl: normalizedStart.url,
    origin,
    maxPages,
    pages,
    skippedUrls,
    storageState,
    authSession,
    summary: {
      maxPages,
      crawledPages: pages.length,
      failedPages,
      discoveredUrls: queued.size + skippedUrls.length,
      startedAt,
      completedAt
    }
  };
}

async function establishSession(
  page: Page,
  startUrl: string,
  origin: string,
  credentials: CrawlCredentials | undefined
): Promise<CrawlAuthSession> {
  if (credentials) {
    return attemptLogin(page, startUrl, credentials, {
      method: "provided_credentials",
      generatedCredentials: false
    });
  }

  return attemptRegistration(page, startUrl, origin);
}

async function attemptLogin(
  page: Page,
  startUrl: string,
  credentials: CrawlCredentials,
  options: { method: "provided_credentials" | "auto_registration"; generatedCredentials: boolean }
): Promise<CrawlAuthSession> {
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });

    if (await looksAuthenticated(page)) {
      return {
        attempted: true,
        method: options.method,
        status: "authenticated",
        userName: credentials.userName,
        generatedCredentials: options.generatedCredentials,
        entryUrl: page.url(),
        message: "Authenticated UI indicators were already present."
      };
    }

    const loginForm = await findLoginForm(page);

    if (!loginForm) {
      return {
        attempted: true,
        method: options.method,
        status: "failed",
        userName: credentials.userName,
        generatedCredentials: options.generatedCredentials,
        message: "No visible login form was found."
      };
    }

    await fillLoginForm(loginForm, credentials);
    await submitForm(loginForm, page);

    return {
      attempted: true,
      method: options.method,
      status: (await looksAuthenticated(page)) ? "authenticated" : "failed",
      userName: credentials.userName,
      generatedCredentials: options.generatedCredentials,
      entryUrl: page.url(),
      message: (await looksAuthenticated(page))
        ? "Login flow completed and authenticated UI indicators were detected."
        : "Login form was submitted, but authenticated UI indicators were not detected."
    };
  } catch (error) {
    return {
      attempted: true,
      method: options.method,
      status: "failed",
      userName: credentials.userName,
      generatedCredentials: options.generatedCredentials,
      message: `Login attempt failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function attemptRegistration(page: Page, startUrl: string, origin: string): Promise<CrawlAuthSession> {
  const generatedData = createRegistrationData();

  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
    const registrationUrl = await findRegistrationUrl(page, origin);

    if (!registrationUrl) {
      return {
        attempted: false,
        method: "none",
        status: "skipped",
        generatedCredentials: false,
        message: "No register, sign-up, or create-account entry point was found."
      };
    }

    await page.goto(registrationUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
    const registrationForm = await findRegistrationForm(page);

    if (!registrationForm) {
      return {
        attempted: true,
        method: "auto_registration",
        status: "failed",
        userName: generatedData.userName,
        generatedCredentials: true,
        entryUrl: registrationUrl,
        message: "Registration entry point was found, but no suitable registration form was detected."
      };
    }

    await fillRegistrationForm(registrationForm, generatedData);
    await submitForm(registrationForm, page);

    if (await looksAuthenticated(page)) {
      return {
        attempted: true,
        method: "auto_registration",
        status: "authenticated",
        userName: generatedData.userName,
        generatedCredentials: true,
        entryUrl: registrationUrl,
        message: "Auto-registration completed and authenticated UI indicators were detected."
      };
    }

    const loginResult = await attemptLogin(page, startUrl, generatedData, {
      method: "auto_registration",
      generatedCredentials: true
    });

    return {
      ...loginResult,
      entryUrl: registrationUrl,
      message:
        loginResult.status === "authenticated"
          ? "Auto-registration completed, then generated credentials were used to log in."
          : "Auto-registration was submitted, but the generated account could not be confirmed as authenticated."
    };
  } catch (error) {
    return {
      attempted: true,
      method: "auto_registration",
      status: "failed",
      userName: generatedData.userName,
      generatedCredentials: true,
      message: `Auto-registration attempt failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function findLoginForm(page: Page) {
  const forms = page.locator("form").filter({ has: page.locator("input[type='password']") });
  const count = await forms.count().catch(() => 0);

  if (count > 0) {
    return forms.first();
  }

  return undefined;
}

async function findRegistrationForm(page: Page) {
  const forms = page.locator("form");
  const count = await forms.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const form = forms.nth(index);
    const score = await form
      .evaluate((element) => {
        const text = [
          element.id,
          element.getAttribute("name"),
          element.getAttribute("action"),
          element.textContent
        ]
          .join(" ")
          .toLowerCase();
        const passwordInputs = element.querySelectorAll("input[type='password']").length;
        const textInputs = element.querySelectorAll("input:not([type]), input[type='text'], input[type='email']").length;
        let value = 0;

        if (/\b(register|registration|sign up|signup|create account|join)\b/.test(text)) {
          value += 4;
        }

        value += Math.min(passwordInputs, 2);
        value += Math.min(textInputs, 4);
        return value;
      })
      .catch(() => 0);

    if (score >= 4) {
      return form;
    }
  }

  return undefined;
}

async function findRegistrationUrl(page: Page, origin: string): Promise<string | undefined> {
  const candidates = await page
    .locator("a[href]")
    .evaluateAll((anchors) =>
      anchors
        .map((anchor) => ({
          href: (anchor as HTMLAnchorElement).href,
          text: (anchor.textContent ?? "").trim()
        }))
        .filter((anchor) => /\b(register|sign up|signup|create account|join)\b/i.test(`${anchor.text} ${anchor.href}`))
    )
    .catch(() => []);

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.href, page.url()).url;

    if (normalized && isSameOrigin(normalized, origin)) {
      return normalized;
    }
  }

  return undefined;
}

async function fillLoginForm(form: ReturnType<Page["locator"]>, credentials: CrawlCredentials): Promise<void> {
  const userInput = form
    .locator("input:not([type]), input[type='text'], input[type='email'], input[name*='user' i], input[id*='user' i]")
    .first();
  const passwordInput = form.locator("input[type='password']").first();

  if ((await userInput.count().catch(() => 0)) > 0) {
    await userInput.fill(credentials.userName);
  }

  if ((await passwordInput.count().catch(() => 0)) > 0) {
    await passwordInput.fill(credentials.password);
  }
}

async function fillRegistrationForm(
  form: ReturnType<Page["locator"]>,
  data: GeneratedRegistrationData
): Promise<void> {
  const fields = form.locator("input, textarea, select");
  const count = await fields.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    const type = (await field.getAttribute("type").catch(() => ""))?.toLowerCase() ?? "";

    if (["hidden", "submit", "button", "reset", "checkbox", "radio"].includes(type)) {
      continue;
    }

    if (tagName === "select") {
      await field.selectOption({ index: 1 }).catch(() => undefined);
      continue;
    }

    await field.fill(valueForRegistrationField(await getFieldDescriptor(field), type, data)).catch(() => undefined);
  }
}

async function getFieldDescriptor(field: ReturnType<Page["locator"]>): Promise<string> {
  return field
    .evaluate((element) =>
      [
        element.getAttribute("name"),
        element.id,
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.closest("label")?.textContent
      ]
        .join(" ")
        .toLowerCase()
    )
    .catch(() => "");
}

function valueForRegistrationField(
  descriptor: string,
  type: string,
  data: GeneratedRegistrationData
): string {
  if (type === "email" || /\b(email|e-mail)\b/.test(descriptor)) {
    return data.email;
  }

  if (type === "password" || /\b(password|passcode)\b/.test(descriptor)) {
    return data.password;
  }

  if (/\b(user|login)\b/.test(descriptor)) {
    return data.userName;
  }

  if (/\b(first|given)\b/.test(descriptor)) {
    return "QA";
  }

  if (/\b(last|family|surname)\b/.test(descriptor)) {
    return "Tester";
  }

  if (/\b(phone|mobile|tel)\b/.test(descriptor)) {
    return "5551234567";
  }

  if (/\b(ssn|tax|national)\b/.test(descriptor)) {
    return "123456789";
  }

  if (/\b(zip|postal)\b/.test(descriptor)) {
    return "90210";
  }

  if (/\b(city)\b/.test(descriptor)) {
    return "Testville";
  }

  if (/\b(state|province|region)\b/.test(descriptor)) {
    return "CA";
  }

  if (/\b(address|street)\b/.test(descriptor)) {
    return "123 Test Street";
  }

  return "QA Test";
}

async function submitForm(form: ReturnType<Page["locator"]>, page: Page): Promise<void> {
  const submit = form
    .locator("button, input[type='submit'], input[type='button'], [role='button']")
    .filter({ hasText: /register|sign up|create account|log in|login|submit|continue|next/i })
    .first();

  const fallbackSubmit = form.locator("button, input[type='submit'], input[type='button'], [role='button']").first();
  const target = (await submit.count().catch(() => 0)) > 0 ? submit : fallbackSubmit;

  if ((await target.count().catch(() => 0)) > 0) {
    await target.click();
  } else {
    await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  }

  await page.waitForLoadState("domcontentloaded", { timeout: AUTH_SETTLE_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: AUTH_SETTLE_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);
}

async function looksAuthenticated(page: Page): Promise<boolean> {
  const bodyText = await page.locator("body").innerText({ timeout: AUTH_SETTLE_TIMEOUT_MS }).catch(() => "");

  if (/\b(log out|logout|sign out|account overview|open new account|transfer funds|bill pay|request loan)\b/i.test(bodyText)) {
    return true;
  }

  const passwordInputs = await page.locator("input[type='password']").count().catch(() => 0);
  return passwordInputs === 0 && /\b(welcome|hello|my account|accounts?)\b/i.test(bodyText);
}

async function getSeedUrlsAfterAuth(page: Page, startUrl: string, origin: string): Promise<string[]> {
  const current = normalizeUrl(page.url(), startUrl).url;
  const links = await page
    .locator("a[href]")
    .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
    .catch(() => []);

  return Array.from(
    new Set(
      [current, startUrl, ...links]
        .filter((link): link is string => Boolean(link))
        .flatMap((link) => {
          const normalized = normalizeUrl(link, startUrl).url;
          return normalized && isSameOrigin(normalized, origin) ? [normalized] : [];
        })
    )
  );
}

function createRegistrationData(): GeneratedRegistrationData {
  const suffix = Date.now().toString(36);

  return {
    userName: `rqatg_${suffix}`,
    password: `RQAtg-${suffix}-Pass1`,
    email: `rqatg_${suffix}@example.test`
  };
}

async function crawlPage(page: Page, url: string): Promise<CrawledPage> {
  const timestamp = new Date().toISOString();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS
    });

    const title = await page.title().catch(() => "");
    const rawLinks = await page
      .locator("a[href]")
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
      .catch(() => []);

    const discoveredLinks = Array.from(
      new Set(
        rawLinks
          .map((link) => normalizeUrl(link, url).url)
          .filter((link): link is string => Boolean(link))
      )
    );

    return {
      url,
      title,
      status: response?.status(),
      discoveredLinks,
      timestamp
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      url,
      title: "",
      discoveredLinks: [],
      timestamp,
      errorMessage: message
    };
  }
}

function recordSkippedUrl(
  skippedUrls: SkippedUrl[],
  skippedKeys: Set<string>,
  url: string,
  reason: string
): void {
  const key = `${reason}:${url}`;

  if (skippedKeys.has(key)) {
    return;
  }

  skippedKeys.add(key);
  skippedUrls.push({ url, reason });
}

/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { chromium, type Browser, type Page } from "playwright";
import type {
  BasicActionClassification,
  CrawledPage,
  CrawlResult,
  DomHeading,
  DomImportantText,
  DomInventory,
  DomInventoryButton,
  DomInventoryForm,
  DomInventoryInput,
  DomInventoryLink,
  DomInventoryPage,
  DomMessageCandidate
} from "../types/index.js";

const DEFAULT_EXTRACTION_TIMEOUT_MS = 15_000;

export interface ExtractDomInventoryOptions {
  crawlResult: CrawlResult;
  sourceCrawlPath: string;
  headed: boolean;
  timeoutMs?: number;
}

export async function extractDomInventory(options: ExtractDomInventoryOptions): Promise<DomInventory> {
  const startedAt = new Date().toISOString();
  const pages: DomInventoryPage[] = [];
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: !options.headed });
    const context = await browser.newContext({ storageState: options.crawlResult.storageState });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.timeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS);
    page.setDefaultTimeout(options.timeoutMs ?? DEFAULT_EXTRACTION_TIMEOUT_MS);

    for (const crawledPage of uniqueBy(options.crawlResult.pages, (page) => page.url)) {
      pages.push(await extractDomInventoryPage(page, crawledPage, options.crawlResult.origin));
    }
  } finally {
    await browser?.close();
  }

  const completedAt = new Date().toISOString();

  return {
    sourceCrawlPath: options.sourceCrawlPath,
    generatedAt: completedAt,
    pages,
    summary: {
      pagesAnalyzed: pages.length,
      failedPages: pages.filter((page) => page.errorMessage).length,
      forms: pages.reduce((count, page) => count + page.forms.length, 0),
      buttons: pages.reduce((count, page) => count + page.buttons.length, 0),
      links: pages.reduce((count, page) => count + page.links.length, 0),
      inputsOutsideForms: pages.reduce((count, page) => count + page.inputsOutsideForms.length, 0),
      headings: pages.reduce((count, page) => count + page.importantText.headings.length, 0),
      messageCandidates: pages.reduce(
        (count, page) => count + page.importantText.messageCandidates.length,
        0
      ),
      startedAt,
      completedAt
    }
  };
}

async function extractDomInventoryPage(
  page: Page,
  crawledPage: CrawledPage,
  crawlOrigin: string
): Promise<DomInventoryPage> {
  const timestamp = new Date().toISOString();

  try {
    await page.goto(crawledPage.url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_EXTRACTION_TIMEOUT_MS
    });

    const extracted = await page.evaluate(
      ({ extractionScript, origin }) => {
        const runExtraction = new Function(
          "crawlOrigin",
          `${extractionScript}\nreturn extractVisibleDomInventory(crawlOrigin);`
        );

        return runExtraction(origin) as {
          forms: DomInventoryForm[];
          buttons: DomInventoryButton[];
          links: DomInventoryLink[];
          inputsOutsideForms: DomInventoryInput[];
          importantText: DomImportantText;
        };
      },
      {
        extractionScript: createExtractionScript(),
        origin: crawlOrigin
      }
    );
    const title = await page.title().catch(() => crawledPage.title);

    return {
      url: crawledPage.url,
      title,
      status: crawledPage.status,
      timestamp,
      ...extracted
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      url: crawledPage.url,
      title: crawledPage.title,
      status: crawledPage.status,
      timestamp,
      forms: [],
      buttons: [],
      links: [],
      inputsOutsideForms: [],
      importantText: {
        headings: [],
        messageCandidates: []
      },
      errorMessage: message
    };
  }
}

function createExtractionScript(): string {
  return [
    extractVisibleDomInventory,
    toInputInventory,
    toButtonInventory,
    toLinkInventory,
    toHeading,
    getMessageCandidates,
    classifyAction,
    classifyMessageKind,
    getBestSelector,
    getCssFallbackSelector,
    getInputType,
    getLabelText,
    isVisibleElement,
    isDisabled,
    isSubmitButton,
    inferButtonRole,
    inferElementRole,
    isButtonInput,
    getElementText,
    toAbsoluteUrl,
    normalizeText,
    optionalString,
    selectorText,
    cssEscape,
    uniqueBy,
    uniqueLinksByDestination,
    getLinkScore,
    getButtonKey,
    getLinkKey,
    getInputKey
  ]
    .map((func) => func.toString())
    .join("\n");
}

function extractVisibleDomInventory(crawlOrigin: string): {
  forms: DomInventoryForm[];
  buttons: DomInventoryButton[];
  links: DomInventoryLink[];
  inputsOutsideForms: DomInventoryInput[];
  importantText: DomImportantText;
} {
  const formElements = Array.from(document.querySelectorAll("form")).filter(isVisibleElement);
  const forms = uniqueBy(
    formElements.map((form, index) => {
    const inputs = Array.from(
      form.querySelectorAll("input, textarea, select")
    ).filter(isVisibleElement) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
    const buttons = Array.from(
      form.querySelectorAll("button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']")
    ).filter(isVisibleElement) as HTMLElement[];

    const formText = [
      form.id,
      form.getAttribute("name"),
      form.getAttribute("action"),
      normalizeText(form.textContent ?? "")
    ].join(" ");

    const actionClassification = classifyAction(formText, "submit");
    const formButtons = uniqueBy(buttons.map(toButtonInventory), getButtonKey).map((button) =>
      actionClassification === "search" && button.actionClassification === "submit"
        ? { ...button, actionClassification: "search" as BasicActionClassification }
        : button
    );

    return {
      index,
      id: optionalString(form.id),
      name: optionalString(form.getAttribute("name")),
      action: optionalString(toAbsoluteUrl(form.getAttribute("action") ?? "", document.location.href)),
      method: (form.getAttribute("method") || "get").toLowerCase(),
      selector: getBestSelector(form),
      actionClassification,
      inputs: uniqueBy(inputs.map(toInputInventory), getInputKey),
      buttons: formButtons
    };
    }),
    (form) => form.selector
  );

  const buttons = uniqueBy(
    Array.from(
      document.querySelectorAll("button, input[type='button'], input[type='submit'], input[type='reset'], [role='button']")
    )
      .filter(isVisibleElement)
      .map((button) => toButtonInventory(button as HTMLElement)),
    getButtonKey
  );

  const links = uniqueLinksByDestination(
    Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisibleElement)
      .map((link) => toLinkInventory(link as HTMLAnchorElement, crawlOrigin))
      .filter((link): link is DomInventoryLink => Boolean(link))
  );

  const inputsOutsideForms = uniqueBy(
    Array.from(document.querySelectorAll("input, textarea, select"))
      .filter(isVisibleElement)
      .filter((input) => !(input as HTMLElement).closest("form"))
      .map((input) =>
        toInputInventory(input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
      ),
    getInputKey
  );

  const importantText = {
    headings: uniqueBy(
      Array.from(document.querySelectorAll("h1, h2, h3"))
        .filter(isVisibleElement)
        .map(toHeading)
        .filter((heading): heading is DomHeading => Boolean(heading)),
      (heading) => `${heading.level}:${heading.text.toLowerCase()}`
    ),
    messageCandidates: getMessageCandidates()
  };

  return {
    forms,
    buttons,
    links,
    inputsOutsideForms,
    importantText
  };
}

function toInputInventory(
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): DomInventoryInput {
  const text = [
    input.getAttribute("type"),
    input.getAttribute("name"),
    input.id,
    input.getAttribute("placeholder"),
    getLabelText(input)
  ].join(" ");

  return {
    type: getInputType(input),
    name: optionalString(input.getAttribute("name")),
    id: optionalString(input.id),
    placeholder: optionalString(input.getAttribute("placeholder")),
    label: optionalString(getLabelText(input)),
    required: input.required || input.getAttribute("aria-required") === "true",
    selector: getBestSelector(input),
    actionClassification: classifyAction(text, "unknown")
  };
}

function toButtonInventory(button: HTMLElement): DomInventoryButton {
  const text = getElementText(button);
  const ariaLabel = optionalString(button.getAttribute("aria-label"));
  const role = optionalString(button.getAttribute("role") ?? inferButtonRole(button));
  const inputValue = button instanceof HTMLInputElement ? button.value : "";
  const classificationText = [text, ariaLabel, inputValue, button.id, button.getAttribute("name")].join(" ");

  return {
    text: optionalString(text || inputValue),
    ariaLabel,
    role,
    disabled: isDisabled(button),
    selector: getBestSelector(button),
    actionClassification: classifyAction(
      classificationText,
      isSubmitButton(button) ? "submit" : "unknown"
    )
  };
}

function toLinkInventory(link: HTMLAnchorElement, crawlOrigin: string): DomInventoryLink | undefined {
  const href = toAbsoluteUrl(link.getAttribute("href") ?? "", document.location.href);

  if (!href) {
    return undefined;
  }

  let scope: "internal" | "external" = "external";

  try {
    scope = new URL(href).origin === crawlOrigin ? "internal" : "external";
  } catch {
    return undefined;
  }

  const text = getElementText(link);

  return {
    text: optionalString(text),
    href,
    scope,
    selector: getBestSelector(link),
    actionClassification: classifyAction(text || href, "navigation")
  };
}

function toHeading(element: Element): DomHeading | undefined {
  const text = getElementText(element as HTMLElement);

  if (!text) {
    return undefined;
  }

  return {
    level: Number(element.tagName.slice(1)) as 1 | 2 | 3,
    text,
    selector: getBestSelector(element as HTMLElement)
  };
}

function getMessageCandidates(): DomMessageCandidate[] {
  const candidates = Array.from(
    document.querySelectorAll(
      "[role='alert'], [role='status'], [aria-live], .error, .errors, .alert, .success, .message, .notice, .toast"
    )
  ).filter(isVisibleElement);

  const seen = new Set<string>();
  const messages: DomMessageCandidate[] = [];

  for (const candidate of candidates) {
    const text = getElementText(candidate as HTMLElement);

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    messages.push({
      text,
      kind: classifyMessageKind(candidate as HTMLElement, text),
      selector: getBestSelector(candidate as HTMLElement)
    });
  }

  return messages;
}

function classifyAction(text: string, fallback: BasicActionClassification): BasicActionClassification {
  const value = text.toLowerCase();

  if (/\b(log out|logout|sign out|signout)\b/.test(value)) {
    return "logout";
  }

  if (/\b(admin|administration|configure|configuration|initialize|shutdown|clean)\b/.test(value)) {
    return "admin";
  }

  if (/\b(accounts? overview|account summary|account activity|account transactions?|account statements?|balances?|statements?\s+for\s+account)\b/.test(value)) {
    return "account_overview";
  }

  if (/\b(open (new )?account|new account|create account)\b/.test(value)) {
    return "account_opening";
  }

  if (/\b(transfer funds?|funds? transfer|wire transfer|send money|withdraw funds?)\b/.test(value)) {
    return "funds_transfer";
  }

  if (/\b(bill pay|pay bill|payee|make payment)\b/.test(value)) {
    return "bill_payment";
  }

  if (/\b(request loan|apply for loan|loan application|mortgage|credit application)\b/.test(value)) {
    return "loan_application";
  }

  if (/\b(update contact|profile|settings|preferences|user management)\b/.test(value)) {
    return "account_management";
  }

  if (/\b(wsdl|wadl|openapi|swagger|api docs?|service definition)\b/.test(value)) {
    return "service_definition";
  }

  if (/\b(checkout|payment|pay now|place order)\b/.test(value)) {
    return "checkout";
  }

  if (/\b(cart|basket|bag)\b/.test(value)) {
    return "cart";
  }

  if (/\b(sign up|signup|register|create account|join (now|today)|join as|join the (program|service|platform|site|community)|membership application)\b/.test(value)) {
    return "signup";
  }

  if (/\b(log in|login|sign in|signin)\b/.test(value)) {
    return "login";
  }

  if (/\b(search|find)\b/.test(value)) {
    return "search";
  }

  if (/\b(delete|remove|discard|clear item)\b/.test(value)) {
    return "item_removal";
  }

  if (/\b(add|create|new|insert)\b.*\b(item|element|row|record|entry|task|ticket|issue)\b|\b(new item|new element|new row|new record|new entry|new task|new ticket|new issue)\b/.test(value)) {
    return "item_creation";
  }

  if (/\b(show|hide|toggle|expand|collapse|open|close|reveal|more|less)\b/.test(value)) {
    return "ui_state_management";
  }

  if (/\b(filter|sort)\b/.test(value)) {
    return "filtering_sorting";
  }

  if (/\b(upload|attach file|choose file)\b/.test(value)) {
    return "file_upload";
  }

  if (/\b(validate|check|verify|invalid|required)\b/.test(value)) {
    return "validation_feedback";
  }

  if (/\b(contact|support|help|message us)\b/.test(value)) {
    return "contact";
  }

  if (/\b(submit|send|save|continue|next)\b/.test(value)) {
    return "submit";
  }

  return fallback;
}

function classifyMessageKind(element: HTMLElement, text: string): "error" | "success" | "status" {
  const value = [element.className, element.id, element.getAttribute("role"), text].join(" ").toLowerCase();

  if (/\b(error|invalid|failed|failure|danger)\b/.test(value)) {
    return "error";
  }

  if (/\b(success|complete|completed|saved|sent)\b/.test(value)) {
    return "success";
  }

  return "status";
}

function getBestSelector(element: HTMLElement): string {
  const testId = element.getAttribute("data-testid");

  if (testId) {
    return `[data-testid="${cssEscape(testId)}"]`;
  }

  const dataTest = element.getAttribute("data-test");

  if (dataTest) {
    return `[data-test="${cssEscape(dataTest)}"]`;
  }

  const ariaLabel = element.getAttribute("aria-label");

  if (ariaLabel) {
    return `[aria-label="${cssEscape(ariaLabel)}"]`;
  }

  const role = element.getAttribute("role") ?? inferElementRole(element);
  const text = getElementText(element);

  if (role && text) {
    return `role=${role}[name="${selectorText(text)}"]`;
  }

  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const name = element.getAttribute("name");

  if (name) {
    return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  }

  if (text) {
    return `text="${selectorText(text)}"`;
  }

  return getCssFallbackSelector(element);
}

function getCssFallbackSelector(element: HTMLElement): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    const tagName = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (!parent) {
      segments.unshift(tagName);
      break;
    }

    const sameTagSiblings = Array.from(parent.children as HTMLCollectionOf<Element>).filter(
      (child: Element) => child.tagName.toLowerCase() === tagName
    );
    const siblingIndex = sameTagSiblings.indexOf(current) + 1;
    const segment = sameTagSiblings.length > 1 ? `${tagName}:nth-of-type(${siblingIndex})` : tagName;

    segments.unshift(segment);
    current = parent;
  }

  return segments.length > 0 ? segments.join(" > ") : element.tagName.toLowerCase();
}

function getInputType(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (input instanceof HTMLTextAreaElement) {
    return "textarea";
  }

  if (input instanceof HTMLSelectElement) {
    return "select";
  }

  return input.type || "text";
}

function getLabelText(input: HTMLElement): string {
  const ariaLabel = input.getAttribute("aria-label");

  if (ariaLabel) {
    return normalizeText(ariaLabel);
  }

  const ariaLabelledBy = input.getAttribute("aria-labelledby");

  if (ariaLabelledBy) {
    const label = ariaLabelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const normalized = normalizeText(label);

    if (normalized) {
      return normalized;
    }
  }

  if (input.id) {
    const explicitLabel = document.querySelector(`label[for="${cssEscape(input.id)}"]`);
    const labelText = normalizeText(explicitLabel?.textContent ?? "");

    if (labelText) {
      return labelText;
    }
  }

  const wrappingLabel = input.closest("label");
  return normalizeText(wrappingLabel?.textContent ?? "");
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    element.getClientRects().length > 0
  );
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    (element instanceof HTMLButtonElement && element.disabled) ||
    (element instanceof HTMLInputElement && element.disabled)
  );
}

function isSubmitButton(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) {
    return !element.type || element.type === "submit";
  }

  return element instanceof HTMLInputElement && element.type === "submit";
}

function inferButtonRole(element: HTMLElement): string | undefined {
  if (element instanceof HTMLButtonElement) {
    return "button";
  }

  if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
    return "button";
  }

  return undefined;
}

function inferElementRole(element: HTMLElement): string | undefined {
  if (element instanceof HTMLAnchorElement && element.href) {
    return "link";
  }

  if (element instanceof HTMLButtonElement || isButtonInput(element)) {
    return "button";
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return "textbox";
  }

  if (element instanceof HTMLSelectElement) {
    return "combobox";
  }

  return undefined;
}

function isButtonInput(element: HTMLElement): boolean {
  return element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type);
}

function getElementText(element: HTMLElement): string {
  if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
    return normalizeText(element.value);
  }

  return normalizeText(element.innerText || element.textContent || "");
}

function toAbsoluteUrl(value: string, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function optionalString(value: string | null | undefined): string | undefined {
  const normalized = normalizeText(value ?? "");
  return normalized || undefined;
}

function selectorText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80).replace(/"/g, '\\"');
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/"/g, '\\"');
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

function uniqueLinksByDestination(links: DomInventoryLink[]): DomInventoryLink[] {
  const linksByDestination = new Map<string, DomInventoryLink>();

  for (const link of links) {
    const key = getLinkKey(link);
    const existing = linksByDestination.get(key);

    if (!existing || getLinkScore(link) > getLinkScore(existing)) {
      linksByDestination.set(key, link);
    }
  }

  return Array.from(linksByDestination.values());
}

function getLinkScore(link: DomInventoryLink): number {
  const text = link.text?.toLowerCase() ?? "";
  let score = 0;

  if (text) {
    score += 2;
  }

  if (text && text !== "skip to main content") {
    score += 3;
  }

  if (link.scope === "internal") {
    score += 1;
  }

  return score;
}

function getButtonKey(button: DomInventoryButton): string {
  return [
    button.text?.toLowerCase() ?? "",
    button.ariaLabel?.toLowerCase() ?? "",
    button.role ?? "",
    button.selector
  ].join("|");
}

function getLinkKey(link: DomInventoryLink): string {
  return [link.href, link.scope].join("|");
}

function getInputKey(input: DomInventoryInput): string {
  return [
    input.type,
    input.name ?? "",
    input.id ?? "",
    input.placeholder?.toLowerCase() ?? "",
    input.label?.toLowerCase() ?? "",
    input.selector
  ].join("|");
}

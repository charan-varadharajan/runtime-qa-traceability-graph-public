import { chromium, type Browser, type Page, type Request, type Response } from "playwright";
import type {
  BasicActionClassification,
  CrawlResult,
  DomInventory,
  InteractionCleanupAction,
  InteractionDiscoveredAction,
  InteractionInventory,
  InteractionNetworkCall,
  InteractionObservation,
  StaticScriptHint
} from "../types/index.js";

const MAX_INTERACTIONS_PER_PAGE = 6;
const MAX_TEXT_CHANGES = 8;
const MUTATION_WAIT_MS = 350;

export interface DiscoverInteractionsOptions {
  crawlResult: CrawlResult;
  domInventory: DomInventory;
  sourceCrawlPath: string;
  sourceDomInventoryPath: string;
  headed: boolean;
}

interface ActionSnapshot {
  label: string;
  selector: string;
  role?: string;
  href?: string;
  disabled: boolean;
  actionClassification: BasicActionClassification;
}

interface PageSnapshot {
  actions: ActionSnapshot[];
  texts: string[];
}

interface ClickCandidate extends ActionSnapshot {
  staticHints: string[];
}

export async function discoverInteractions(
  options: DiscoverInteractionsOptions
): Promise<InteractionInventory> {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: !options.headed });
  const pages = [];

  try {
    for (const crawledPage of options.crawlResult.pages) {
      const context = await browser.newContext({
        storageState: options.crawlResult.storageState
      });
      const page = await context.newPage();

      try {
        await page.goto(crawledPage.url, { waitUntil: "domcontentloaded" });
        await settlePage(page);

        const staticScriptHints = await collectStaticScriptHints(page);
        const before = await captureSnapshot(page);
        const candidates = selectSafeCandidates(before.actions, staticScriptHints, page.url());
        const interactions: InteractionObservation[] = [];

        for (const candidate of candidates.slice(0, MAX_INTERACTIONS_PER_PAGE)) {
          interactions.push(await observeCandidate(browser, options, crawledPage.url, candidate));
        }

        pages.push({
          url: crawledPage.url,
          title: crawledPage.title,
          timestamp: new Date().toISOString(),
          staticScriptHints,
          interactions
        });
      } catch (error) {
        pages.push({
          url: crawledPage.url,
          title: crawledPage.title,
          timestamp: new Date().toISOString(),
          staticScriptHints: [],
          interactions: [],
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const completedAt = new Date().toISOString();
  const interactions = pages.flatMap((page) => page.interactions);

  return {
    sourceCrawlPath: options.sourceCrawlPath,
    sourceDomInventoryPath: options.sourceDomInventoryPath,
    generatedAt: completedAt,
    pages,
    summary: {
      pagesAnalyzed: pages.length,
      failedPages: pages.filter((page) => page.errorMessage).length,
      candidateActions: pages.reduce(
        (total, page) => total + page.interactions.length,
        0
      ),
      interactionsAttempted: interactions.filter((interaction) => interaction.clicked).length,
      interactionsWithDomChanges: interactions.filter(
        (interaction) =>
          interaction.addedActions.length > 0 ||
          interaction.removedActions.length > 0 ||
          interaction.addedTexts.length > 0 ||
          interaction.removedTexts.length > 0
      ).length,
      discoveredActions: interactions.reduce(
        (total, interaction) => total + interaction.addedActions.length,
        0
      ),
      startedAt,
      completedAt
    }
  };
}

async function observeCandidate(
  browser: Browser,
  options: DiscoverInteractionsOptions,
  url: string,
  candidate: ClickCandidate
): Promise<InteractionObservation> {
  const context = await browser.newContext({
    storageState: options.crawlResult.storageState
  });
  const page = await context.newPage();
  const networkCalls: InteractionNetworkCall[] = [];
  const responsesByUrl = new Map<string, number>();

  page.on("response", (response: Response) => {
    responsesByUrl.set(response.url(), response.status());
  });
  page.on("requestfinished", (request: Request) => {
    const requestUrl = request.url();
    networkCalls.push({
      requestUrl,
      method: request.method(),
      resourceType: request.resourceType(),
      statusCode: responsesByUrl.get(requestUrl)
    });
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const before = await captureSnapshot(page);
    networkCalls.length = 0;
    responsesByUrl.clear();
    const target = page.locator(candidate.selector).first();
    const urlBefore = page.url();
    await target.click({ timeout: 3000 });
    await page.waitForTimeout(MUTATION_WAIT_MS);
    await settlePage(page);

    const after = await captureSnapshot(page);
    const urlAfter = page.url();

    if (!isSameDocumentOrHashChange(urlBefore, urlAfter)) {
      return {
        actionLabel: candidate.label,
        actionSelector: candidate.selector,
        actionClassification: candidate.actionClassification,
        safeAction: true,
        clicked: true,
        urlBefore,
        urlAfter,
        addedActions: [],
        removedActions: [],
        addedTexts: [],
        removedTexts: [],
        networkCalls: networkCalls.filter(isLikelyUsefulNetworkCall).slice(0, 20),
        staticHints: candidate.staticHints,
        evidence: [
          `Interaction "${candidate.label}" navigated from ${urlBefore} to ${urlAfter}; DOM mutation evidence was not attributed to the source page.`
        ]
      };
    }

    const addedActions = diffAddedActions(before.actions, after.actions);
    const removedActions = diffAddedActions(after.actions, before.actions);
    const cleanupAction = await tryCleanup(page, after, addedActions);
    const evidence = createInteractionEvidence(candidate, addedActions, removedActions, before, after, cleanupAction);

    return {
      actionLabel: candidate.label,
      actionSelector: candidate.selector,
      actionClassification: candidate.actionClassification,
      safeAction: true,
      clicked: true,
      urlBefore,
      urlAfter,
      addedActions,
      removedActions,
      addedTexts: diffTexts(before.texts, after.texts),
      removedTexts: diffTexts(after.texts, before.texts),
      networkCalls: networkCalls.filter(isLikelyUsefulNetworkCall).slice(0, 20),
      cleanupAction,
      staticHints: candidate.staticHints,
      evidence
    };
  } catch (error) {
    return {
      actionLabel: candidate.label,
      actionSelector: candidate.selector,
      actionClassification: candidate.actionClassification,
      safeAction: true,
      clicked: false,
      urlBefore: url,
      urlAfter: url,
      addedActions: [],
      removedActions: [],
      addedTexts: [],
      removedTexts: [],
      networkCalls: [],
      staticHints: candidate.staticHints,
      evidence: [`Could not safely click "${candidate.label}": ${error instanceof Error ? error.message : String(error)}`]
    };
  } finally {
    await context.close();
  }
}

async function tryCleanup(
  page: Page,
  afterInitialClick: PageSnapshot,
  addedActions: InteractionDiscoveredAction[]
): Promise<InteractionCleanupAction | undefined> {
  const cleanupCandidate = addedActions.find((action) => action.actionClassification === "item_removal");

  if (!cleanupCandidate) {
    return undefined;
  }

  try {
    await page.locator(cleanupCandidate.selector).first().click({ timeout: 3000 });
    await page.waitForTimeout(MUTATION_WAIT_MS);
    const afterCleanup = await captureSnapshot(page);
    const stillExists = afterCleanup.actions.some((action) => action.selector === cleanupCandidate.selector);

    if (stillExists) {
      return undefined;
    }

    return {
      actionLabel: cleanupCandidate.label,
      actionSelector: cleanupCandidate.selector,
      actionClassification: cleanupCandidate.actionClassification,
      removedSelector: cleanupCandidate.selector,
      evidence: [
        `Clicking revealed action "${cleanupCandidate.label}" removed selector ${cleanupCandidate.selector}`,
        `Actions before cleanup: ${afterInitialClick.actions.length}; after cleanup: ${afterCleanup.actions.length}`
      ]
    };
  } catch {
    return undefined;
  }
}

async function captureSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const selectorText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const cssEscape = (value: string): string => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    };
    const visible = (element: Element): boolean => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const bestSelector = (element: HTMLElement): string => {
      const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
      if (testId) {
        return `[data-testid="${cssEscape(testId)}"], [data-test="${cssEscape(testId)}"]`;
      }
      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }
      const text = normalize(element.innerText || element.textContent);
      const role = element.getAttribute("role") || (element.tagName.toLowerCase() === "a" ? "link" : "button");
      if (text && ["button", "link"].includes(role)) {
        return `role=${role}[name="${selectorText(text)}"]`;
      }
      const tag = element.tagName.toLowerCase();
      const index = Array.from(document.querySelectorAll(tag)).indexOf(element) + 1;
      return `${tag}:nth-of-type(${Math.max(index, 1)})`;
    };
    const classify = (text: string): BasicActionClassification => {
      const value = text.toLowerCase();
      if (/\b(delete|remove|discard|clear item)\b/.test(value)) return "item_removal";
      if (/\b(add|create|new|insert)\b.*\b(item|element|row|record|entry|task|ticket|issue)\b|\b(new item|new element|new row|new record|new entry|new task|new ticket|new issue)\b/.test(value)) return "item_creation";
      if (/\b(show|hide|toggle|expand|collapse|open|close|reveal)\b/.test(value)) return "ui_state_management";
      if (/\b(filter|sort)\b/.test(value)) return "filtering_sorting";
      if (/\b(upload|attach file)\b/.test(value)) return "file_upload";
      if (/\b(validate|check|verify)\b/.test(value)) return "validation_feedback";
      return "unknown";
    };
    const actionElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, a[href], input[type='button'], input[type='submit'], [role='button'], [role='link']"
      )
    ).filter(visible);
    const actions = actionElements.map((element) => {
      const text = normalize(
        element.innerText ||
          element.getAttribute("aria-label") ||
          element.getAttribute("value") ||
          element.textContent
      );
      const role =
        element.getAttribute("role") ||
        (element.tagName.toLowerCase() === "a" ? "link" : "button");
      const href =
        element instanceof HTMLAnchorElement && element.href ? element.href : undefined;
      return {
        label: text || bestSelector(element),
        selector: bestSelector(element),
        role,
        href,
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
        actionClassification: classify([text, element.id, element.className].join(" "))
      };
    });
    const texts = Array.from(document.body.querySelectorAll<HTMLElement>("body *"))
      .filter(visible)
      .map((element) => normalize(element.innerText || element.textContent))
      .filter((text) => text.length >= 3 && text.length <= 160);
    return { actions, texts: Array.from(new Set(texts)).slice(0, 200) };
  });
}

async function collectStaticScriptHints(page: Page): Promise<StaticScriptHint[]> {
  return page.evaluate(async () => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const scriptElements = Array.from(document.querySelectorAll<HTMLScriptElement>("script"));
    const scriptTexts: string[] = [];

    for (const script of scriptElements) {
      if (script.src) {
        try {
          if (new URL(script.src, window.location.href).origin === window.location.origin) {
            const response = await fetch(script.src);
            scriptTexts.push(await response.text());
          }
        } catch {
          scriptTexts.push(script.src);
        }
      } else if (script.textContent) {
        scriptTexts.push(script.textContent);
      }
    }

    const hints: StaticScriptHint[] = [];
    const addHint = (kind: StaticScriptHint["kind"], value: string, evidence: string): void => {
      if (!hints.some((hint) => hint.kind === kind && hint.value === value)) {
        hints.push({ kind, value, evidence: normalize(evidence).slice(0, 240) });
      }
    };

    for (const text of scriptTexts) {
      if (/addEventListener|onclick\s*=/.test(text)) {
        addHint("event_listener", "click handler", "Script contains click event registration.");
      }
      if (/appendChild|insertAdjacentHTML|createElement|append\(/.test(text)) {
        addHint("dom_append", "DOM append", "Script contains DOM creation or append logic.");
      }
      if (/\.remove\(|removeChild|innerHTML\s*=/.test(text)) {
        addHint("dom_remove", "DOM removal", "Script contains DOM removal or replacement logic.");
      }
      if (/classList\.(toggle|add|remove)|hidden\s*=|display\s*=/.test(text)) {
        addHint("dom_toggle", "visibility toggle", "Script contains visibility or class toggle logic.");
      }
      if (/\bmodal|dialog\b/i.test(text)) {
        addHint("modal", "modal/dialog", "Script references modal or dialog behavior.");
      }
      if (/\bvalidat|invalid|required\b/i.test(text)) {
        addHint("validation", "validation", "Script references validation behavior.");
      }
    }

    return hints.slice(0, 20);
  });
}

function selectSafeCandidates(
  actions: ActionSnapshot[],
  hints: StaticScriptHint[],
  pageUrl: string
): ClickCandidate[] {
  return actions
    .filter((action) => !action.disabled)
    .filter((action) => isLowRiskDiscoveryAction(action, pageUrl))
    .map((action) => ({
      ...action,
      staticHints: hints.map((hint) => `${hint.kind}: ${hint.value}`).slice(0, 6)
    }));
}

function isLowRiskDiscoveryAction(action: ActionSnapshot, pageUrl: string): boolean {
  const text = `${action.label} ${action.selector}`.toLowerCase();

  if (action.role === "link" && action.href && !isSameDocumentOrHashChange(pageUrl, action.href)) {
    return false;
  }

  if (
    /\b(submit|save|sign in|signin|login|register|checkout|pay|payment|transfer|send|apply|order|delete|remove|clear all)\b/.test(
      text
    )
  ) {
    return false;
  }

  return (
    (action.role !== "link" && action.actionClassification === "item_creation") ||
    action.actionClassification === "ui_state_management" ||
    action.actionClassification === "dynamic_content" ||
    action.actionClassification === "modal_dialog" ||
    action.actionClassification === "filtering_sorting" ||
    /\b(add|show|hide|toggle|expand|collapse|open|close|reveal|more|less|filter|sort|preview)\b/.test(
      text
    )
  );
}

function isSameDocumentOrHashChange(before: string, after: string): boolean {
  try {
    const beforeUrl = new URL(before);
    const afterUrl = new URL(after, beforeUrl);
    return (
      beforeUrl.origin === afterUrl.origin &&
      beforeUrl.pathname === afterUrl.pathname &&
      beforeUrl.search === afterUrl.search
    );
  } catch {
    return before === after;
  }
}

function diffAddedActions(
  before: ActionSnapshot[],
  after: ActionSnapshot[]
): InteractionDiscoveredAction[] {
  const beforeKeys = new Set(before.map(actionKey));
  return after
    .filter((action) => !beforeKeys.has(actionKey(action)))
    .map((action) => ({
      label: action.label,
      selector: action.selector,
      role: action.role,
      actionClassification: action.actionClassification
    }));
}

function actionKey(action: { selector: string; label: string }): string {
  return `${action.selector}:${action.label}`;
}

function diffTexts(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((text) => !beforeSet.has(text)).slice(0, MAX_TEXT_CHANGES);
}

function createInteractionEvidence(
  candidate: ClickCandidate,
  addedActions: InteractionDiscoveredAction[],
  removedActions: InteractionDiscoveredAction[],
  before: PageSnapshot,
  after: PageSnapshot,
  cleanupAction: InteractionCleanupAction | undefined
): string[] {
  const evidence = [
    `Interaction "${candidate.label}" was safely clicked using selector ${candidate.selector}`,
    `DOM actions before click: ${before.actions.length}; after click: ${after.actions.length}`
  ];

  if (addedActions.length > 0) {
    evidence.push(
      `Click revealed action(s): ${addedActions.map((action) => `"${action.label}"`).join(", ")}`
    );
  }

  if (removedActions.length > 0) {
    evidence.push(
      `Click removed action(s): ${removedActions.map((action) => `"${action.label}"`).join(", ")}`
    );
  }

  if (cleanupAction) {
    evidence.push(...cleanupAction.evidence);
  }

  if (candidate.staticHints.length > 0) {
    evidence.push(`Static script hints: ${candidate.staticHints.join("; ")}`);
  }

  return evidence;
}

function isLikelyUsefulNetworkCall(call: InteractionNetworkCall): boolean {
  return !/\.(png|jpe?g|gif|svg|ico|css|woff2?|ttf)(\?|$)/i.test(call.requestUrl);
}

async function settlePage(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 1200 });
  } catch {
    await page.waitForTimeout(150);
  }
}

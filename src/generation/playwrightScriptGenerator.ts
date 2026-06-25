import path from "node:path";
import type {
  AutomationFeasibilityInventory,
  AutomationFeasibilityResult,
  DomInventory,
  DomInventoryInput,
  DomInventoryPage,
  FlowGraph,
  FlowGraphNode,
  GeneratedAutomationIndex,
  GeneratedAutomationTest,
  ManualTestCase,
  ManualTestCaseInventory
} from "../types/index.js";

export interface GeneratePlaywrightScriptsOptions {
  manualTestCases: ManualTestCaseInventory;
  automationFeasibility: AutomationFeasibilityInventory;
  flowGraph: FlowGraph;
  domInventory: DomInventory;
  outputDirectory: string;
  sourceManualTestCasesPath: string;
  sourceAutomationFeasibilityPath: string;
  sourceFlowGraphPath: string;
  sourceDomInventoryPath: string;
}

export interface GeneratedPlaywrightScript {
  filePath: string;
  content: string;
}

export interface GeneratePlaywrightScriptsResult {
  index: GeneratedAutomationIndex;
  scripts: GeneratedPlaywrightScript[];
}

interface ScriptContext {
  testCase: ManualTestCase;
  feasibility: AutomationFeasibilityResult;
  pageNode?: FlowGraphNode;
  actionNode?: FlowGraphNode;
  domPage?: DomInventoryPage;
  targetUrl: string;
  setupActionSelector?: string;
  setupActionLabel?: string;
  actionSelector?: string;
  actionLabel?: string;
  actionClassification?: string;
  interactionEffects: InteractionEffects;
  postClickHiddenSelector?: string;
  relatedApiNodeIds: string[];
  importantTexts: string[];
  requiredEnvVars: string[];
  credentialFields: CredentialFields;
  shouldClickAction: boolean;
  generationNotes: string[];
}

interface CredentialFields {
  usernameSelector?: string;
  passwordSelector?: string;
  usernameEnvVar?: string;
  passwordEnvVar?: string;
}

interface InteractionEffects {
  revealedActions: InteractionEffectAction[];
  cleanupAction?: InteractionCleanupEffect;
}

interface InteractionEffectAction {
  label: string;
  selector: string;
  actionClassification?: string;
}

interface InteractionCleanupEffect {
  actionLabel: string;
  actionSelector: string;
  removedSelector: string;
}

const ELIGIBLE_CLASSIFICATIONS = new Set(["fully_automatable", "partially_automatable"]);
const ELIGIBLE_SAFE_MODES = new Set(["execute", "dry_run"]);
const RISKY_ACTION_CLASSIFICATIONS = new Set([
  "admin",
  "account_management",
  "account_opening",
  "bill_payment",
  "checkout",
  "contact",
  "form_submission",
  "funds_transfer",
  "item_removal",
  "loan_application",
  "payment",
  "signup",
  "submit"
]);

export function generatePlaywrightScripts(
  options: GeneratePlaywrightScriptsOptions
): GeneratePlaywrightScriptsResult {
  const startedAt = new Date().toISOString();
  const testCasesById = new Map(
    options.manualTestCases.testCases.map((testCase) => [testCase.testCaseId, testCase])
  );
  const graphNodesById = new Map(options.flowGraph.nodes.map((node) => [node.id, node]));
  const domPagesByUrl = new Map(options.domInventory.pages.map((page) => [page.url, page]));
  const eligibleFeasibility = options.automationFeasibility.results.filter(isEligibleForGeneration);
  const skippedCandidateCount =
    options.automationFeasibility.results.length - eligibleFeasibility.length;

  const generatedTests: GeneratedAutomationTest[] = [];
  const scripts: GeneratedPlaywrightScript[] = [];

  for (const feasibility of eligibleFeasibility) {
    const testCase = testCasesById.get(feasibility.testCaseId);

    if (!testCase) {
      continue;
    }

    const context = createScriptContext(testCase, feasibility, graphNodesById, domPagesByUrl);

    if (!context.targetUrl) {
      continue;
    }

    const filePath = path.join(
      options.outputDirectory,
      `${slugify(`${testCase.testCaseId}-${testCase.title}`)}.spec.ts`
    );

    scripts.push({
      filePath,
      content: createSpecContent(context)
    });

    generatedTests.push({
      testCaseId: testCase.testCaseId,
      scenarioId: testCase.scenarioId,
      title: testCase.title,
      classification: feasibility.classification,
      safeExecutionMode: feasibility.safeExecutionMode,
      filePath,
      relatedApiNodeIds: context.relatedApiNodeIds,
      requiredEnvVars: context.requiredEnvVars,
      generationNotes: context.generationNotes
    });
  }

  const completedAt = new Date().toISOString();

  return {
    scripts,
    index: {
      sourceManualTestCasesPath: options.sourceManualTestCasesPath,
      sourceAutomationFeasibilityPath: options.sourceAutomationFeasibilityPath,
      sourceFlowGraphPath: options.sourceFlowGraphPath,
      sourceDomInventoryPath: options.sourceDomInventoryPath,
      generatedAt: completedAt,
      outputDirectory: options.outputDirectory,
      tests: generatedTests,
      summary: {
        generatedTestCount: generatedTests.length,
        skippedCandidateCount,
        byClassification: countBy(generatedTests, (test) => test.classification),
        bySafeExecutionMode: countBy(generatedTests, (test) => test.safeExecutionMode),
        startedAt,
        completedAt
      }
    }
  };
}

function isEligibleForGeneration(feasibility: AutomationFeasibilityResult): boolean {
  return (
    ELIGIBLE_CLASSIFICATIONS.has(feasibility.classification) &&
    ELIGIBLE_SAFE_MODES.has(feasibility.safeExecutionMode) &&
    feasibility.recommendedFramework !== "api_test" &&
    feasibility.recommendedFramework !== "manual"
  );
}

function createScriptContext(
  testCase: ManualTestCase,
  feasibility: AutomationFeasibilityResult,
  graphNodesById: Map<string, FlowGraphNode>,
  domPagesByUrl: Map<string, DomInventoryPage>
): ScriptContext {
  const actionNode = firstNode(testCase.evidenceSource.relatedActionNodeIds, graphNodesById, "action");
  const pageNode =
    pageNodeForAction(actionNode, graphNodesById) ??
    firstNode(testCase.evidenceSource.relatedPageNodeIds, graphNodesById, "page");
  const targetUrl = getString(actionNode?.metadata?.pageUrl) ?? getString(pageNode?.metadata?.url) ?? "";
  const setupActionNode = setupActionNodeFor(actionNode, graphNodesById);
  const setupActionSelector = getString(setupActionNode?.metadata?.selector);
  const domPage = targetUrl ? domPagesByUrl.get(targetUrl) : undefined;
  const actionSelector = getString(actionNode?.metadata?.selector);
  const actionClassification = getString(actionNode?.metadata?.actionClassification);
  const interactionEffects = interactionEffectsFor(actionNode);
  const knownSafeCleanup = isKnownSafeCleanup(actionNode, setupActionNode);
  const relatedApiNodeIds = testCase.evidenceSource.relatedApiNodeIds;
  const requiredEnvVars = requiredEnvVarsFor(feasibility.requiredInputs);
  const credentialFields = credentialFieldsFor(domPage, requiredEnvVars);
  const shouldClickAction =
    feasibility.safeExecutionMode === "execute" &&
    Boolean(actionSelector) &&
    (!isRiskyAction(testCase, actionClassification) || knownSafeCleanup);
  const generationNotes = createGenerationNotes(feasibility, shouldClickAction, actionClassification);

  return {
    testCase,
    feasibility,
    pageNode,
    actionNode,
    domPage,
    targetUrl,
    setupActionSelector,
    setupActionLabel: setupActionNode?.label,
    actionSelector,
    actionLabel: actionNode?.label,
    actionClassification,
    interactionEffects,
    postClickHiddenSelector: knownSafeCleanup ? actionSelector : undefined,
    relatedApiNodeIds,
    importantTexts: importantTextsFor(domPage),
    requiredEnvVars,
    credentialFields,
    shouldClickAction,
    generationNotes
  };
}

function pageNodeForAction(
  actionNode: FlowGraphNode | undefined,
  graphNodesById: Map<string, FlowGraphNode>
): FlowGraphNode | undefined {
  const pageUrl = getString(actionNode?.metadata?.pageUrl);

  if (!pageUrl) {
    return undefined;
  }

  return Array.from(graphNodesById.values()).find(
    (node) => node.type === "page" && getString(node.metadata?.url) === pageUrl
  );
}

function interactionEffectsFor(actionNode: FlowGraphNode | undefined): InteractionEffects {
  const effects = actionNode?.metadata?.interactionEffects;

  if (!isRecord(effects)) {
    return { revealedActions: [] };
  }

  const revealedActions = Array.isArray(effects.revealedActions)
    ? effects.revealedActions.filter(isRecord).flatMap((action) => {
        const label = getString(action.label);
        const selector = getString(action.selector);

        if (!label || !selector) {
          return [];
        }

        return [
          {
            label,
            selector,
            actionClassification: getString(action.actionClassification)
          }
        ];
      })
    : [];
  const cleanup = isRecord(effects.cleanupAction) ? effects.cleanupAction : undefined;
  const cleanupAction =
    cleanup &&
    getString(cleanup.actionLabel) &&
    getString(cleanup.actionSelector) &&
    getString(cleanup.removedSelector)
      ? {
          actionLabel: getString(cleanup.actionLabel) ?? "",
          actionSelector: getString(cleanup.actionSelector) ?? "",
          removedSelector: getString(cleanup.removedSelector) ?? ""
        }
      : undefined;

  return {
    revealedActions,
    cleanupAction
  };
}

function setupActionNodeFor(
  actionNode: FlowGraphNode | undefined,
  graphNodesById: Map<string, FlowGraphNode>
): FlowGraphNode | undefined {
  const revealedByActionId = getString(actionNode?.metadata?.revealedByActionId);
  return revealedByActionId ? graphNodesById.get(revealedByActionId) : undefined;
}

function isKnownSafeCleanup(
  actionNode: FlowGraphNode | undefined,
  setupActionNode: FlowGraphNode | undefined
): boolean {
  const selector = getString(actionNode?.metadata?.selector);
  const setupEffects = interactionEffectsFor(setupActionNode);

  return Boolean(
    selector &&
      setupEffects.cleanupAction &&
      setupEffects.cleanupAction.actionSelector === selector &&
      setupEffects.cleanupAction.removedSelector === selector
  );
}

function createSpecContent(context: ScriptContext): string {
  const testName = traceFriendlyTestName(context);
  const targetUrl = JSON.stringify(context.targetUrl);
  const actionSelector = context.actionSelector ? JSON.stringify(context.actionSelector) : undefined;
  const relatedApiIds = context.relatedApiNodeIds.length
    ? context.relatedApiNodeIds.join(", ")
    : "none";
  const envArray = `[${context.requiredEnvVars.map((envVar) => JSON.stringify(envVar)).join(", ")}]`;
  const visibleTextAssertions = context.importantTexts
    .map(
      (text) =>
        `  await expect(page.getByText(${JSON.stringify(text)}, { exact: false }).first()).toBeVisible();`
    )
    .join("\n");
  const credentialFill = createCredentialFillBlock(context.credentialFields);
  const setupActionBlock = context.setupActionSelector
    ? [
        `  const setupAction = page.locator(${JSON.stringify(context.setupActionSelector)}).first();`,
        "  await expect(setupAction).toBeVisible();",
        "  await expect(setupAction).toBeEnabled();",
        `  // Setup action reveals the dynamic target: ${commentSafe(context.setupActionLabel ?? context.setupActionSelector)}`,
        "  await setupAction.click();",
        "  await page.waitForTimeout(250);"
      ].join("\n")
    : "";

  const actionExecutionBlock =
    context.shouldClickAction
      ? [
          "  await actionTarget.click();",
          "  await page.waitForLoadState(\"domcontentloaded\").catch(() => undefined);",
          "  await page.waitForTimeout(250);",
          createInteractionAssertions(context),
          context.postClickHiddenSelector
            ? `  await expect(page.locator(${JSON.stringify(context.postClickHiddenSelector)}).first()).toBeHidden();`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
      : `  // Action execution intentionally not performed: ${commentSafe(
          actionSkipReason(context)
        )}`;
  const actionAssertions = actionSelector
    ? [
        `  const actionTarget = page.locator(${actionSelector}).first();`,
        "  await expect(actionTarget).toBeVisible();",
        "  await expect(actionTarget).toBeEnabled();",
        actionExecutionBlock
      ].join("\n")
    : "  // No stable action selector was available for this generated test.";

  const partialNotes =
    context.feasibility.classification === "partially_automatable"
      ? [
          "  // Partially automatable: final business assertion is intentionally not claimed here.",
          "  // Blocked assertion: validate the downstream effect manually or with a configured sandbox/mock."
        ].join("\n")
      : "";

  return `import { test, expect } from "@playwright/test";

test.describe("Generated UI automation", () => {
  const requiredEnvVars = ${envArray};
  const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
  test.skip(missingEnvVars.length > 0, \`Missing required sandbox env vars: \${missingEnvVars.join(", ")}\`);

  test(${JSON.stringify(testName)}, async ({ page }) => {
    // scenarioId: ${commentSafe(context.testCase.scenarioId)}
    // testCaseId: ${commentSafe(context.testCase.testCaseId)}
    // relatedApiIds: ${commentSafe(relatedApiIds)}
    // classification: ${context.feasibility.classification}
    // safeExecutionMode: ${context.feasibility.safeExecutionMode}

    const targetUrl = ${targetUrl};

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page).toHaveTitle(/.+/);
${visibleTextAssertions || "  // No important text assertion was available from dom-inventory.json."}
${credentialFill ? `\n${credentialFill}` : ""}
${setupActionBlock ? `\n${setupActionBlock}` : ""}

${actionAssertions}
${partialNotes ? `\n${partialNotes}` : ""}
  });
});
`;
}

function createInteractionAssertions(context: ScriptContext): string {
  const revealedAction = context.interactionEffects.revealedActions[0];
  const cleanupAction = context.interactionEffects.cleanupAction;
  const lines: string[] = [];

  if (revealedAction?.selector) {
    lines.push(
      `  const revealedAction = page.locator(${JSON.stringify(revealedAction.selector)}).first();`,
      `  await expect(revealedAction).toBeVisible();`
    );
  }

  if (cleanupAction?.actionSelector && cleanupAction.removedSelector) {
    lines.push(
      `  const cleanupAction = page.locator(${JSON.stringify(cleanupAction.actionSelector)}).first();`,
      "  await expect(cleanupAction).toBeVisible();",
      "  await cleanupAction.click();",
      "  await page.waitForTimeout(250);",
      `  await expect(page.locator(${JSON.stringify(cleanupAction.removedSelector)}).first()).toBeHidden();`
    );
  }

  return lines.join("\n");
}

function firstNode(
  nodeIds: string[],
  graphNodesById: Map<string, FlowGraphNode>,
  type: FlowGraphNode["type"]
): FlowGraphNode | undefined {
  return nodeIds.map((nodeId) => graphNodesById.get(nodeId)).find((node) => node?.type === type);
}

function importantTextsFor(domPage: DomInventoryPage | undefined): string[] {
  if (!domPage) {
    return [];
  }

  const headings = domPage.importantText.headings.map((heading) => heading.text);
  const messages = domPage.importantText.messageCandidates.map((message) => message.text);

  return dedupe([...headings, ...messages])
    .filter((text) => text.length >= 3 && text.length <= 120)
    .slice(0, 2);
}

function credentialFieldsFor(
  domPage: DomInventoryPage | undefined,
  requiredEnvVars: string[]
): CredentialFields {
  if (!domPage || !requiresCredentials(requiredEnvVars)) {
    return {};
  }

  const inputs = allInputs(domPage);
  const usernameInput = inputs.find(isUsernameInput);
  const passwordInput = inputs.find((input) => input.type.toLowerCase() === "password");
  const roleCredentials =
    requiredEnvVars.includes("RQATG_ROLE_USERNAME") && requiredEnvVars.includes("RQATG_ROLE_PASSWORD");

  return {
    usernameSelector: usernameInput?.selector,
    passwordSelector: passwordInput?.selector,
    usernameEnvVar: roleCredentials ? "RQATG_ROLE_USERNAME" : "RQATG_TEST_USERNAME",
    passwordEnvVar: roleCredentials ? "RQATG_ROLE_PASSWORD" : "RQATG_TEST_PASSWORD"
  };
}

function allInputs(domPage: DomInventoryPage): DomInventoryInput[] {
  return [
    ...domPage.inputsOutsideForms,
    ...domPage.forms.flatMap((form) => form.inputs)
  ];
}

function isUsernameInput(input: DomInventoryInput): boolean {
  const haystack = [
    input.type,
    input.name,
    input.id,
    input.placeholder,
    input.label,
    input.selector
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    input.type.toLowerCase() !== "password" &&
    (haystack.includes("user") ||
      haystack.includes("login") ||
      haystack.includes("email") ||
      haystack.includes("account"))
  );
}

function requiresCredentials(requiredEnvVars: string[]): boolean {
  return (
    requiredEnvVars.includes("RQATG_TEST_USERNAME") ||
    requiredEnvVars.includes("RQATG_ROLE_USERNAME")
  );
}

function createCredentialFillBlock(fields: CredentialFields): string {
  if (!fields.usernameSelector || !fields.passwordSelector || !fields.usernameEnvVar || !fields.passwordEnvVar) {
    return "";
  }

  return [
    `  await page.locator(${JSON.stringify(fields.usernameSelector)}).first().fill(process.env.${fields.usernameEnvVar} ?? "");`,
    `  await page.locator(${JSON.stringify(fields.passwordSelector)}).first().fill(process.env.${fields.passwordEnvVar} ?? "");`
  ].join("\n");
}

function requiredEnvVarsFor(requiredInputs: string[]): string[] {
  const envVars = new Set<string>();
  const text = requiredInputs.join(" ").toLowerCase();

  if (text.includes("credentials") || text.includes("username") || text.includes("password")) {
    envVars.add("RQATG_TEST_USERNAME");
    envVars.add("RQATG_TEST_PASSWORD");
  }

  if (text.includes("role-based") || text.includes("permissions")) {
    envVars.add("RQATG_ROLE_USERNAME");
    envVars.add("RQATG_ROLE_PASSWORD");
  }

  if (text.includes("seed")) {
    envVars.add("RQATG_SEEDED_DATA_READY");
  }

  if (text.includes("sandbox") || text.includes("pre-production")) {
    envVars.add("RQATG_SANDBOX_CONFIRMED");
  }

  if (text.includes("external") || text.includes("mock service")) {
    envVars.add("RQATG_EXTERNAL_SYSTEM_READY");
  }

  if (text.includes("payment")) {
    envVars.add("RQATG_PAYMENT_SANDBOX_READY");
  }

  return Array.from(envVars).sort();
}

function createGenerationNotes(
  feasibility: AutomationFeasibilityResult,
  shouldClickAction: boolean,
  actionClassification: string | undefined
): string[] {
  const notes = [
    `Generated from ${feasibility.classification} feasibility with ${feasibility.safeExecutionMode} execution mode.`
  ];

  if (!shouldClickAction) {
    notes.push("The script asserts the action target but does not execute a risky or unsupported final action.");
  }

  if (actionClassification) {
    notes.push(`Primary action classification: ${actionClassification}.`);
  }

  return notes;
}

function isRiskyAction(testCase: ManualTestCase, actionClassification: string | undefined): boolean {
  if (actionClassification && RISKY_ACTION_CLASSIFICATIONS.has(actionClassification)) {
    return true;
  }

  const category = testCase.evidenceSource.scenarioCategory;

  return RISKY_ACTION_CLASSIFICATIONS.has(category);
}

function actionSkipReason(context: ScriptContext): string {
  if (context.feasibility.safeExecutionMode === "dry_run") {
    return "safeExecutionMode is dry_run";
  }

  if (isRiskyAction(context.testCase, context.actionClassification)) {
    return `primary action is classified as ${context.actionClassification ?? context.testCase.evidenceSource.scenarioCategory}`;
  }

  return "action execution was not confidently safe";
}

function traceFriendlyTestName(context: ScriptContext): string {
  return `${context.testCase.evidenceSource.scenarioCategory} | ${context.feasibility.classification} | ${context.testCase.title}`;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countBy<T>(values: T[], keySelector: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = keySelector(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function commentSafe(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/\r?\n/g, " ");
}

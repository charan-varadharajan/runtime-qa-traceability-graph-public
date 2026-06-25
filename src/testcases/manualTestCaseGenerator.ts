import { createHash } from "node:crypto";
import type {
  BusinessScenarioCategory,
  BusinessScenarioInventory,
  BusinessScenarioPriority,
  FlowGraph,
  FlowGraphNode,
  InferredBusinessScenario,
  ManualTestCase,
  ManualTestCaseInventory
} from "../types/index.js";

export interface GenerateManualTestCasesOptions {
  scenarios: BusinessScenarioInventory;
  flowGraph: FlowGraph;
  sourceScenariosPath: string;
}

interface ManualTemplate {
  title: string;
  objective: string;
  createSteps: (context: ScenarioTestContext) => string[];
  expectedResult: (context: ScenarioTestContext) => string;
}

interface ScenarioTestContext {
  scenario: InferredBusinessScenario;
  primaryPage?: FlowGraphNode;
  primaryAction?: FlowGraphNode;
  primaryApi?: FlowGraphNode;
  actionLabel: string;
  pageTarget: string;
  apiTarget: string;
}

export function generateManualTestCases(
  options: GenerateManualTestCasesOptions
): ManualTestCaseInventory {
  const startedAt = new Date().toISOString();
  const graphIndex = createGraphIndex(options.flowGraph);
  const testCases = options.scenarios.scenarios.flatMap((scenario) =>
    createTestCasesForScenario(scenario, graphIndex)
  );
  const completedAt = new Date().toISOString();

  return {
    sourceScenariosPath: options.sourceScenariosPath,
    generatedAt: completedAt,
    testCases,
    summary: {
      testCaseCount: testCases.length,
      byPriority: countBy(testCases, (testCase) => testCase.priority),
      automatableCandidateCount: testCases.filter((testCase) => testCase.automatableCandidate).length,
      manualOnlyCount: testCases.filter((testCase) => !testCase.automatableCandidate).length,
      startedAt,
      completedAt
    }
  };
}

function createTestCasesForScenario(
  scenario: InferredBusinessScenario,
  graphIndex: Map<string, FlowGraphNode>
): ManualTestCase[] {
  const context = createScenarioTestContext(scenario, graphIndex);
  const templates = templatesForCategory(scenario.category, isDryRunOnly(scenario));

  return templates.map((template, index) => {
    const baseTitle = `${template.title}: ${scenario.name}`;
    const title = templates.length === 1 ? baseTitle : `${baseTitle} (${index + 1})`;

    return {
      testCaseId: createTestCaseId(scenario, title),
      scenarioId: scenario.scenarioId,
      title,
      objective: `${template.objective} Scenario: ${scenario.description}`,
      preconditions: createPreconditions(scenario),
      testData: createTestData(scenario),
      steps: template.createSteps(context),
      expectedResult: template.expectedResult(context),
      priority: scenario.priority,
      automatableCandidate: isAutomatableCandidate(scenario),
      automationNotes: createAutomationNotes(scenario),
      coverageLimitations: createCoverageLimitations(scenario),
      evidenceSource: {
        scenarioSource: scenario.source,
        scenarioCategory: scenario.category,
        scenarioConfidence: scenario.confidence,
        evidence: scenario.evidence,
        relatedPageNodeIds: scenario.relatedPageNodeIds,
        relatedActionNodeIds: scenario.relatedActionNodeIds,
        relatedApiNodeIds: scenario.relatedApiNodeIds
      }
    };
  });
}

function templatesForCategory(
  category: BusinessScenarioCategory,
  dryRunOnly: boolean
): ManualTemplate[] {
  if (dryRunOnly) {
    return [dryRunTemplate(category)];
  }

  switch (category) {
    case "authentication":
      return [
        {
          title: "Verify user authentication flow",
          objective: "Confirm that a tester can reach and exercise the sign-in entry point with approved credentials.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click or submit "${context.actionLabel}".`,
            "Enter approved test username and password supplied for this environment.",
            "Submit the sign-in form.",
            "Observe the post-login landing page or authenticated navigation."
          ],
          expectedResult: () => "The user is authenticated and a logged-in state is visible."
        }
      ];
    case "session_management":
      return [
        {
          title: "Verify session management flow",
          objective: "Confirm that a tester can safely end or change an authenticated session.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            "Sign in with approved test credentials.",
            `Click "${context.actionLabel}".`,
            "Attempt to access an authenticated page again."
          ],
          expectedResult: () => "Authenticated content is no longer accessible without signing in again."
        }
      ];
    case "registration":
      return [
        {
          title: "Verify registration flow with approved test data",
          objective: "Confirm that the registration entry point and required fields can be completed with non-production data.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Review visible required fields and validation hints.",
            "Enter approved non-production registration data.",
            "Submit the registration form only in an environment where account creation is permitted."
          ],
          expectedResult: () => "The registration flow shows an account-created confirmation or an explicit next step."
        }
      ];
    case "search":
      return [
        {
          title: "Verify search flow",
          objective: "Confirm that a user can perform a search and receive relevant results or an empty-state message.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Focus "${context.actionLabel}".`,
            "Enter an approved search term that is expected to exist in the environment.",
            "Submit or trigger the search.",
            "Review the results area or empty-state message."
          ],
          expectedResult: () => "The application displays search results or a clear no-results message."
        }
      ];
    case "navigation":
      return [
        {
          title: "Verify primary navigation flow",
          objective: "Confirm that visible navigation actions lead to reachable pages.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Wait for the destination page to finish loading.",
            "Confirm the browser remains on the same application origin.",
            "Confirm the page has visible content."
          ],
          expectedResult: (context) => `The "${context.actionLabel}" navigation action loads a visible destination page.`
        }
      ];
    case "contact":
      return [
        {
          title: "Verify contact flow with non-production message",
          objective: "Confirm that the contact or support form can be completed safely with approved test data.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Fill required fields with approved non-production contact details.",
            "Use a test message that clearly identifies the submission as a QA validation.",
            "Submit only if the environment permits externally visible test messages."
          ],
          expectedResult: () => "The contact flow shows a submission confirmation or explicit validation message."
        }
      ];
    case "account_overview":
      return [
        {
          title: "Verify account overview information",
          objective: "Confirm that account summary, balance, transaction, or statement information is visible and internally consistent.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            "Sign in with approved test credentials if the scenario requires authentication.",
            `Click "${context.actionLabel}".`,
            "Review the displayed account identifiers, balances, transaction rows, and timestamps.",
            "Open one representative account or transaction detail if available."
          ],
          expectedResult: () => "The account overview displays seeded account information with visible balances or transaction details."
        }
      ];
    case "content_browsing":
      return [
        {
          title: "Verify content browsing flow",
          objective: "Confirm that content pages are readable and reachable from public navigation.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            "Review headings, body content, and visible links.",
            "Follow one representative in-content link.",
            "Return to the content page."
          ],
          expectedResult: () => "The content page displays readable headings/body content and at least one in-content link works."
        }
      ];
    case "item_creation":
      return [
        {
          title: "Verify visible item creation",
          objective: "Confirm that a user action creates a visible in-page item or control without requiring backend data changes.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Observe the page for a newly displayed row, item, button, or control.",
            "If a safe remove/delete control appears for the newly added item, click it to return the page to its prior state."
          ],
          expectedResult: (context) => `Clicking "${context.actionLabel}" creates a visible in-page item or control.`
        }
      ];
    case "item_removal":
      return [
        {
          title: "Verify visible item removal",
          objective: "Confirm that a user can remove a visible in-page item or temporary control safely.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            "Create or locate a removable test item if the page requires one.",
            `Click "${context.actionLabel}".`,
            "Observe whether the target item or control is removed from the page."
          ],
          expectedResult: (context) => `Clicking "${context.actionLabel}" removes the target in-page item or control.`
        }
      ];
    case "ui_state_management":
      return [
        {
          title: "Verify UI state change",
          objective: "Confirm that a user can change visible page state through an expand, collapse, show, hide, open, close, or toggle action.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Observe the visible state change on the page.",
            "Click the same control or available close/collapse control again if the UI supports reversing the state."
          ],
          expectedResult: (context) => `Clicking "${context.actionLabel}" changes the visible page state.`
        }
      ];
    case "dynamic_content":
      return [
        {
          title: "Verify dynamic content update",
          objective: "Confirm that a user action reveals, refreshes, or updates client-side content.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Wait for any dynamic content, loading indicator, or UI update to settle.",
            "Review the changed content for readability and consistency."
          ],
          expectedResult: () => "The page displays updated or newly revealed dynamic content."
        }
      ];
    case "modal_dialog":
      return [
        {
          title: "Verify modal dialog interaction",
          objective: "Confirm that a modal or dialog opens, displays expected content, and can be closed safely.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Click "${context.actionLabel}".`,
            "Confirm that a modal or dialog is visible.",
            "Close the modal or dialog using the visible close/cancel control."
          ],
          expectedResult: () => "The modal or dialog opens visibly and can be closed without leaving the page in a blocked state."
        }
      ];
    case "filtering_sorting":
      return [
        {
          title: "Verify filter or sort behavior",
          objective: "Confirm that filtering or sorting updates the visible list, table, or content set.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            "Identify the list, table, or content set affected by the control.",
            `Click or change "${context.actionLabel}".`,
            "Compare the visible item order, count, or filtered state after the action."
          ],
          expectedResult: () => "The visible content updates according to the selected filter or sort action."
        }
      ];
    case "file_upload":
      return [
        {
          title: "Verify file upload entry point",
          objective: "Confirm that the upload control accepts an approved test file and shows the next expected state.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Activate "${context.actionLabel}".`,
            "Select an approved non-sensitive test file.",
            "Stop before final submission if upload completion would persist data outside the test environment."
          ],
          expectedResult: () => "The upload flow accepts the selected test file or shows clear validation feedback."
        }
      ];
    case "validation_feedback":
      return [
        {
          title: "Verify validation feedback",
          objective: "Confirm that invalid or incomplete input produces clear validation feedback.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Activate "${context.actionLabel}" with intentionally incomplete or invalid approved test input.`,
            "Review the visible validation message, highlighted field, or disabled state.",
            "Correct the input if applicable and observe whether validation feedback clears."
          ],
          expectedResult: () => "The page displays clear validation feedback for invalid input."
        }
      ];
    case "service_integration":
      return [
        {
          title: "Verify service integration discovery",
          objective: "Confirm that public API or service definition surfaces are reachable and recognizable.",
          createSteps: (context) => [
            `Open ${context.pageTarget}.`,
            `Navigate to ${context.apiTarget}.`,
            "Review the response or page for a recognizable service contract, operation list, or API documentation.",
            "Do not invoke mutating operations during this manual discovery test."
          ],
          expectedResult: () => "The service integration surface exposes recognizable API documentation or a service contract."
        }
      ];
    default:
      return [standardTemplate(category)];
  }
}

function standardTemplate(category: BusinessScenarioCategory): ManualTemplate {
  return {
    title: `Verify ${formatCategory(category)} flow`,
    objective: `Confirm that the ${formatCategory(category)} scenario can be exercised with approved test data.`,
    createSteps: (context) => [
      `Open ${context.pageTarget}.`,
      `Navigate to or activate "${context.actionLabel}".`,
      "Review visible fields, controls, and validation guidance.",
      "Enter approved non-production test data when input is required.",
      "Complete the action only if the environment permits the operation."
    ],
    expectedResult: (context) => `The ${formatCategory(context.scenario.category)} flow reaches its visible confirmation or validation state.`
  };
}

function dryRunTemplate(category: BusinessScenarioCategory): ManualTemplate {
  switch (category) {
    case "account_opening":
      return {
        title: "Dry-run account opening flow",
        objective: "Review account creation/opening requirements without creating a real account or resource.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Sign in with approved test credentials if required.",
          `Click "${context.actionLabel}".`,
          "Review available account/resource types, required fields, defaults, and disclosures.",
          "Stop before the final create, open, submit, or confirmation action."
        ],
        expectedResult: () => "The account opening flow shows required inputs and a final confirmation boundary without creating a real account or resource."
      };
    case "account_management":
      return {
        title: "Dry-run account management flow",
        objective: "Review profile, settings, or contact update behavior without saving destructive or externally visible changes.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Sign in with approved test credentials if required.",
          `Click "${context.actionLabel}".`,
          "Review editable fields, validation rules, and save/cancel behavior.",
          "Stop before saving changes unless the environment explicitly permits test updates."
        ],
        expectedResult: () => "The account management flow shows editable fields, validation behavior, and a save boundary without making unauthorized changes."
      };
    case "funds_transfer":
      return {
        title: "Dry-run funds transfer flow",
        objective: "Review transfer setup and confirmation behavior without moving money, balance, or value.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Sign in with approved test credentials if required.",
          `Click "${context.actionLabel}".`,
          "Review source, destination, amount, scheduling, and validation fields.",
          "Stop before the final transfer, submit, or confirmation action."
        ],
        expectedResult: () => "The transfer flow shows required transfer data and a final confirmation boundary without executing a transfer."
      };
    case "bill_payment":
      return {
        title: "Dry-run bill payment flow",
        objective: "Review bill payment setup and confirmation behavior without sending money or notifying an external payee.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Sign in with approved test credentials if required.",
          `Click "${context.actionLabel}".`,
          "Review payee, amount, schedule, account, memo, and validation fields.",
          "Stop before the final payment, submit, or confirmation action."
        ],
        expectedResult: () => "The bill payment flow shows required payment data and a final confirmation boundary without submitting a payment."
      };
    case "loan_application":
      return {
        title: "Dry-run loan application flow",
        objective: "Review loan or credit request requirements without submitting an externally visible application.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Sign in with approved test credentials if required.",
          `Click "${context.actionLabel}".`,
          "Review requested amount, down payment, term, eligibility, and required applicant fields.",
          "Stop before the final apply, submit, or confirmation action."
        ],
        expectedResult: () => "The loan request flow shows required application data and a final submission boundary without filing an application."
      };
    case "administration":
      return {
        title: "Dry-run administration flow",
        objective: "Review administrative controls without changing configuration, resetting data, or affecting service availability.",
        createSteps: (context) => [
          `Open ${context.pageTarget} in an approved non-production environment if available.`,
          "Use an approved role-based test user if authentication is required.",
          `Click "${context.actionLabel}".`,
          "Review available controls, warnings, defaults, and required permissions.",
          "Stop before any initialize, reset, shutdown, clean, save, or destructive action."
        ],
        expectedResult: () => "The administration flow shows privileged controls and unsafe action boundaries without changing system state."
      };
  }

  return {
    title: `Dry-run ${formatCategory(category)} flow`,
    objective: `Review the ${formatCategory(category)} scenario without performing unsafe, destructive, payment, or externally visible actions.`,
    createSteps: (context) => [
      `Open ${context.pageTarget} in an approved non-production environment if available.`,
      `Navigate to or activate "${context.actionLabel}".`,
      "Review visible fields, controls, warnings, and confirmation screens.",
      "Enter only approved dummy data if the flow can be stopped before final submission.",
      "Stop before any final submit, payment, deletion, transfer, external message, or irreversible action."
    ],
    expectedResult: (context) => `The ${formatCategory(context.scenario.category)} flow shows its required data and final confirmation boundary without completing a risky action.`
  };
}

function createPreconditions(scenario: InferredBusinessScenario): string[] {
  const preconditions = ["The application under test is reachable in an approved test environment."];

  if (scenario.dataDependencies.includes("requires_credentials")) {
    preconditions.push("Approved test credentials are available; do not invent or use production credentials.");
  }

  if (scenario.dataDependencies.includes("requires_role_based_user")) {
    preconditions.push("A test user with the required role or permissions is available.");
  }

  if (scenario.dataDependencies.includes("requires_seeded_data")) {
    preconditions.push("Required seed records exist in the test environment.");
  }

  if (scenario.dataDependencies.includes("requires_payment_sandbox")) {
    preconditions.push("A payment sandbox is configured; do not use real payment instruments.");
  }

  if (scenario.dataDependencies.includes("requires_external_system")) {
    preconditions.push("Any external system or notification destination is approved for QA validation.");
  }

  if (isDryRunOnly(scenario)) {
    preconditions.push("Tester has permission to inspect this flow and must stop before unsafe or externally visible completion.");
  }

  return unique(preconditions);
}

function createTestData(scenario: InferredBusinessScenario): string[] {
  const testData = ["Use only approved non-production test data for this environment."];

  if (scenario.dataDependencies.includes("requires_credentials")) {
    testData.push("Credential set: supplied by the test environment owner.");
  }

  if (scenario.dataDependencies.includes("requires_seeded_data")) {
    testData.push("Seed record: an existing non-production record relevant to the scenario.");
  }

  if (scenario.dataDependencies.includes("requires_payment_sandbox")) {
    testData.push("Payment data: sandbox-only payment instrument supplied by the payment provider or test owner.");
  }

  if (scenario.dataDependencies.includes("requires_external_system")) {
    testData.push("External-system data: QA-approved endpoint, inbox, account, or destination.");
  }

  if (scenario.dataDependencies.includes("unknown")) {
    testData.push("Specific required data is unknown from runtime evidence; tester must identify it before execution.");
  }

  return unique(testData);
}

function createAutomationNotes(scenario: InferredBusinessScenario): string[] {
  if (!isAutomatableCandidate(scenario)) {
    return [
      "Manual or dry-run validation is recommended before automation.",
      "Automation should wait until safe test data, environment permissions, and rollback expectations are explicit."
    ];
  }

  return [
    "Candidate for future Playwright automation after selectors and stable test data are confirmed.",
    "No Playwright script is generated in this step."
  ];
}

function createCoverageLimitations(scenario: InferredBusinessScenario): string[] {
  const limitations: string[] = [];

  if (scenario.confidence < 0.7) {
    limitations.push("Scenario confidence is below 0.70; a human should confirm the inferred business intent.");
  }

  if (scenario.relatedPageNodeIds.length === 0) {
    limitations.push("No related page nodes were captured for this scenario.");
  }

  if (scenario.relatedActionNodeIds.length === 0 && scenario.relatedApiNodeIds.length === 0) {
    limitations.push("No related action or API nodes were captured for this scenario.");
  }

  if (scenario.dataDependencies.includes("unknown")) {
    limitations.push("Required data dependencies could not be fully determined from runtime evidence.");
  }

  if (scenario.dataDependencies.includes("requires_credentials")) {
    limitations.push("Execution requires approved test credentials; the generator does not provide or verify them.");
  }

  if (scenario.dataDependencies.includes("requires_seeded_data")) {
    limitations.push("Expected results depend on seeded test data being present and stable.");
  }

  if (scenario.dataDependencies.includes("requires_external_system")) {
    limitations.push("External notifications, integrations, or downstream effects are not verified by this generated manual case.");
  }

  if (isDryRunOnly(scenario)) {
    limitations.push("Coverage is limited to manual review or dry-run because the flow may be unsafe, destructive, or externally visible.");
  }

  limitations.push("Steps are generated from runtime-discovered pages/actions and should be confirmed by a tester before execution.");

  return unique(limitations);
}

function createGraphIndex(flowGraph: FlowGraph): Map<string, FlowGraphNode> {
  return new Map(flowGraph.nodes.map((node) => [node.id, node]));
}

function createScenarioTestContext(
  scenario: InferredBusinessScenario,
  graphIndex: Map<string, FlowGraphNode>
): ScenarioTestContext {
  const primaryAction = firstUsefulNode(scenario.relatedActionNodeIds, graphIndex, scenario);
  const primaryPage =
    pageForAction(primaryAction, graphIndex) ?? firstUsefulNode(scenario.relatedPageNodeIds, graphIndex, scenario);
  const primaryApi = firstUsefulNode(scenario.relatedApiNodeIds, graphIndex, scenario);
  const actionLabel = cleanLabel(primaryAction?.label) ?? cleanLabel(primaryApi?.label) ?? scenario.name;
  const pageTarget = formatPageTarget(primaryPage, primaryAction);
  const apiTarget = formatApiTarget(primaryApi, primaryAction);

  return {
    scenario,
    primaryPage,
    primaryAction,
    primaryApi,
    actionLabel,
    pageTarget,
    apiTarget
  };
}

function firstUsefulNode(
  nodeIds: string[],
  graphIndex: Map<string, FlowGraphNode>,
  scenario: InferredBusinessScenario
): FlowGraphNode | undefined {
  const nodes = nodeIds.map((id) => graphIndex.get(id)).filter((node): node is FlowGraphNode => Boolean(node));
  return nodes.sort((a, b) => nodeUsefulnessScore(b, scenario) - nodeUsefulnessScore(a, scenario))[0];
}

function nodeUsefulnessScore(node: FlowGraphNode, scenario: InferredBusinessScenario): number {
  let score = isUsefulLabel(node.label) ? 10 : 0;
  const href = typeof node.metadata?.href === "string" ? node.metadata.href.toLowerCase() : "";
  const scope = node.metadata?.scope;

  if (scope === "internal") {
    score += 5;
  }

  if (scope === "external") {
    score -= 8;
  }

  if (href && isServiceDefinitionHref(href) && scenario.category !== "service_integration") {
    score -= 10;
  }

  if (scenario.category === "navigation" && scope === "internal") {
    score += 8;
  }

  const label = node.label.toLowerCase();

  if (scenario.category === "authentication") {
    if (/\b(log in|login|sign in|signin)\b/.test(label)) {
      score += 10;
    }

    if (/\bforgot|reset|recover\b/.test(label)) {
      score -= 12;
    }
  }

  if (scenario.category === "registration" && /\b(register|sign up|signup|create account)\b/.test(label)) {
    score += 8;
  }

  if (node.type === "page") {
    score += 2;
  }

  return score;
}

function pageForAction(
  action: FlowGraphNode | undefined,
  graphIndex: Map<string, FlowGraphNode>
): FlowGraphNode | undefined {
  const pageUrl = action?.metadata?.pageUrl;

  if (typeof pageUrl !== "string") {
    return undefined;
  }

  return Array.from(graphIndex.values()).find(
    (node) => node.type === "page" && node.metadata?.url === pageUrl
  );
}

function formatPageTarget(
  page: FlowGraphNode | undefined,
  action: FlowGraphNode | undefined
): string {
  const pageUrl = page?.metadata?.url;

  if (page && typeof pageUrl === "string") {
    const label = cleanLabel(page.label);
    return label ? `"${label}" at ${pageUrl}` : pageUrl;
  }

  const actionPageUrl = action?.metadata?.pageUrl;

  if (typeof actionPageUrl === "string") {
    return actionPageUrl;
  }

  return "the application start URL";
}

function formatApiTarget(
  api: FlowGraphNode | undefined,
  action: FlowGraphNode | undefined
): string {
  const requestUrl = api?.metadata?.requestUrl;

  if (typeof requestUrl === "string") {
    return requestUrl;
  }

  const href = action?.metadata?.href;

  if (typeof href === "string") {
    return href;
  }

  return "the service or API endpoint identified for this scenario";
}

function cleanLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!isUsefulLabel(normalized)) {
    return undefined;
  }

  return normalized;
}

function isUsefulLabel(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return !/^role=|^input\[|^#|^\./i.test(value);
}

function isServiceDefinitionHref(value: string): boolean {
  return /\b(wsdl|wadl|openapi|swagger|api-docs?)\b|[?&]_?wadl\b/.test(value);
}

function isAutomatableCandidate(scenario: InferredBusinessScenario): boolean {
  return scenario.safetyClassification === "safe_read_only" || scenario.safetyClassification === "safe_non_destructive";
}

function isDryRunOnly(scenario: InferredBusinessScenario): boolean {
  return (
    scenario.safetyClassification === "potentially_destructive" ||
    scenario.safetyClassification === "externally_visible" ||
    scenario.safetyClassification === "unsafe_without_permission" ||
    scenario.dataDependencies.includes("requires_payment_sandbox")
  );
}

function createTestCaseId(scenario: InferredBusinessScenario, title: string): string {
  const hash = createHash("sha1")
    .update(`${scenario.scenarioId}:${scenario.category}:${title}`)
    .digest("hex")
    .slice(0, 8);

  return `manual:${scenario.category}:${hash}`;
}

function formatCategory(category: BusinessScenarioCategory): string {
  return category.replace(/_/g, " ");
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

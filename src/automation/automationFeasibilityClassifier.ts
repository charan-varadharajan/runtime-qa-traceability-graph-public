/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import type {
  AutomationFeasibilityClassification,
  AutomationFeasibilityInventory,
  AutomationFeasibilityResult,
  AutomationSafeExecutionMode,
  BusinessScenarioInventory,
  FlowGraph,
  FlowGraphNode,
  InferredBusinessScenario,
  ManualTestCase,
  ManualTestCaseInventory,
  RecommendedAutomationFramework,
  ScenarioDataDependency
} from "../types/index.js";

export interface ClassifyAutomationFeasibilityOptions {
  manualTestCases: ManualTestCaseInventory;
  businessScenarios: BusinessScenarioInventory;
  flowGraph: FlowGraph;
  sourceManualTestCasesPath: string;
  sourceBusinessScenariosPath: string;
  sourceFlowGraphPath: string;
}

interface ScenarioGraphEvidence {
  pages: FlowGraphNode[];
  actions: FlowGraphNode[];
  apis: FlowGraphNode[];
}

interface ClassificationDecision {
  classification: AutomationFeasibilityClassification;
  confidence: number;
  safeExecutionMode: AutomationSafeExecutionMode;
  recommendedFramework: RecommendedAutomationFramework;
  reasons: string[];
  requiredInputs: string[];
  automationStrategy: string[];
}

const BLOCKING_DATA_DEPENDENCIES = new Set<ScenarioDataDependency>([
  "requires_payment_sandbox",
  "unknown"
]);

const SETUP_DATA_DEPENDENCIES = new Set<ScenarioDataDependency>([
  "requires_credentials",
  "requires_seeded_data",
  "requires_role_based_user"
]);

export function classifyAutomationFeasibility(
  options: ClassifyAutomationFeasibilityOptions
): AutomationFeasibilityInventory {
  const startedAt = new Date().toISOString();
  const scenariosById = new Map(
    options.businessScenarios.scenarios.map((scenario) => [scenario.scenarioId, scenario])
  );
  const graphNodesById = new Map(options.flowGraph.nodes.map((node) => [node.id, node]));

  const results = options.manualTestCases.testCases.map((testCase) => {
    const scenario = scenariosById.get(testCase.scenarioId);
    const evidence = scenario ? createScenarioGraphEvidence(scenario, graphNodesById) : undefined;
    return createFeasibilityResult(testCase, scenario, evidence);
  });
  const completedAt = new Date().toISOString();

  return {
    sourceManualTestCasesPath: options.sourceManualTestCasesPath,
    sourceBusinessScenariosPath: options.sourceBusinessScenariosPath,
    sourceFlowGraphPath: options.sourceFlowGraphPath,
    generatedAt: completedAt,
    results,
    summary: {
      resultCount: results.length,
      byClassification: countBy(results, (result) => result.classification),
      bySafeExecutionMode: countBy(results, (result) => result.safeExecutionMode),
      byRecommendedFramework: countBy(results, (result) => result.recommendedFramework),
      startedAt,
      completedAt
    }
  };
}

function createFeasibilityResult(
  testCase: ManualTestCase,
  scenario: InferredBusinessScenario | undefined,
  evidence: ScenarioGraphEvidence | undefined
): AutomationFeasibilityResult {
  if (!scenario || !evidence) {
    return {
      testCaseId: testCase.testCaseId,
      scenarioId: testCase.scenarioId,
      classification: "manual_only",
      confidence: 0.5,
      reasons: [
        "The referenced business scenario was not found in business-scenarios.json.",
        "Without scenario safety, data dependency, and graph evidence, automation coverage cannot be claimed."
      ],
      requiredInputs: ["Human review to restore or regenerate the missing business scenario."],
      automationStrategy: [
        "Do not generate automation until the test case can be linked to a current scenario.",
        "Regenerate business scenarios and manual test cases from the same flow graph."
      ],
      safeExecutionMode: "skip",
      recommendedFramework: "manual"
    };
  }

  const decision = classifyScenarioTestCase(testCase, scenario, evidence);

  return {
    testCaseId: testCase.testCaseId,
    scenarioId: testCase.scenarioId,
    classification: decision.classification,
    confidence: decision.confidence,
    reasons: decision.reasons,
    requiredInputs: decision.requiredInputs,
    automationStrategy: decision.automationStrategy,
    safeExecutionMode: decision.safeExecutionMode,
    recommendedFramework: decision.recommendedFramework
  };
}

function classifyScenarioTestCase(
  testCase: ManualTestCase,
  scenario: InferredBusinessScenario,
  evidence: ScenarioGraphEvidence
): ClassificationDecision {
  const reasons = createBaseReasons(testCase, scenario, evidence);
  const requiredInputs = requiredInputsForScenario(scenario);

  const blockingDependencies = scenario.dataDependencies.filter((dependency) =>
    BLOCKING_DATA_DEPENDENCIES.has(dependency)
  );

  if (blockingDependencies.length > 0) {
    return {
      classification: "blocked_by_missing_data",
      confidence: 0.9,
      reasons: [
        ...reasons,
        `Blocking data dependency detected: ${blockingDependencies.join(", ")}.`,
        "The test case cannot be executed end-to-end until this sandbox capability is configured.",
        "Automation would overclaim coverage if it ignored the missing environment dependency."
      ],
      requiredInputs,
      automationStrategy: [
        "Do not run the end-to-end path until the required sandbox capability is supplied.",
        "After inputs are available, automate visible navigation and field interactions with Playwright.",
        "Add assertions for the final state only after the sandbox dependency is confirmed."
      ],
      safeExecutionMode:
        blockingDependencies.includes("requires_payment_sandbox") ? "mock_required" : "skip",
      recommendedFramework: "manual"
    };
  }

  if (scenario.dataDependencies.includes("requires_external_system")) {
    return {
      classification: "partially_automatable",
      confidence: 0.84,
      reasons: [
        ...reasons,
        "The scenario depends on an external system, so local UI/API coverage is possible but final integration behavior needs a mock, sandbox, or manual confirmation.",
        "The classifier is intentionally limiting the automation claim to the observable application boundary."
      ],
      requiredInputs,
      automationStrategy: [
        "Automate same-origin UI/API behavior that is visible in the flow graph.",
        "Use a mock or approved sandbox for the external dependency before validating final integration behavior.",
        "Keep a manual checkpoint for any external delivery, third-party state, or downstream confirmation."
      ],
      safeExecutionMode: "mock_required",
      recommendedFramework: recommendFramework(evidence, true)
    };
  }

  const setupDependencies = scenario.dataDependencies.filter((dependency) =>
    SETUP_DATA_DEPENDENCIES.has(dependency)
  );

  if (isSandboxGuardedScenario(scenario)) {
    return {
      classification: evidence.actions.length > 0 ? "fully_automatable" : "partially_automatable",
      confidence: evidence.actions.length > 0 ? confidenceFromEvidence(scenario, evidence) : 0.76,
      reasons: [
        ...reasons,
        `Safety classification is ${scenario.safetyClassification}, which may change data or create visible side effects.`,
        "The framework assumes execution against sandbox or pre-production environments, so this is automation-feasible when approved test data and cleanup expectations exist.",
        scenario.safetyClassification === "unsafe_without_permission"
          ? "This flow still needs explicit environment-owner approval before being enabled in CI, but that is treated as a sandbox governance requirement rather than a manual-only blocker."
          : "Sandbox/pre-production execution prevents this from being treated as a production safety blocker.",
        setupDependencies.length > 0
          ? `Setup data dependency detected: ${setupDependencies.join(", ")}. These are treated as automation setup inputs, not blockers, for sandbox/pre-production execution.`
          : "No credential, seeded-data, or role-user setup dependency was detected.",
        evidence.actions.length > 0
          ? "Visible action nodes exist in flow-graph.json, so the guarded sandbox flow can be automated."
          : "No visible action nodes are linked, so automation can cover only the observed page/API boundary."
      ],
      requiredInputs: dedupe([
        ...requiredInputs,
        "Sandbox or pre-production target environment.",
        "Approved non-production test data and cleanup/reset expectations."
      ]),
      automationStrategy: [
        "Use Playwright to execute the scenario against sandbox or pre-production only.",
        "Use generated or seeded non-production data and assert the final expected result.",
        "Add cleanup, idempotency, or reset handling before running this test repeatedly in CI."
      ],
      safeExecutionMode: "execute",
      recommendedFramework: recommendFramework(evidence, false)
    };
  }

  if (!testCase.automatableCandidate) {
    return {
      classification: "manual_only",
      confidence: 0.78,
      reasons: [
        ...reasons,
        "The manual test case is marked as not an automation candidate by the deterministic test generator.",
        "The expected result depends on human review or evidence not available from the runtime graph."
      ],
      requiredInputs,
      automationStrategy: [
        "Keep this as a human-executed test case.",
        "Use automation only for setup or navigation if a future graph exposes stable selectors and objective assertions."
      ],
      safeExecutionMode: "dry_run",
      recommendedFramework: "manual"
    };
  }

  if (evidence.actions.length > 0) {
    return {
      classification: "fully_automatable",
      confidence: confidenceFromEvidence(scenario, evidence),
      reasons: [
        ...reasons,
        "The scenario is safe to execute and no unknown data, payment sandbox, or external system dependency is required.",
        setupDependencies.length > 0
          ? `Setup data dependency detected: ${setupDependencies.join(", ")}. These are expected to be supplied by the sandbox/pre-production test harness.`
          : "No credential, seeded-data, or role-user setup dependency was detected.",
        "Visible action nodes exist in flow-graph.json, so Playwright can target concrete UI interactions."
      ],
      requiredInputs,
      automationStrategy: [
        "Use Playwright to open the related page, locate the recorded action selectors, execute the safe flow, and assert the single expected result.",
        "Reuse related API nodes for additional response or state assertions when they are present.",
        "Keep generated scripts scoped to same-origin pages already observed in the crawl."
      ],
      safeExecutionMode: "execute",
      recommendedFramework: recommendFramework(evidence, false)
    };
  }

  if (evidence.pages.length > 0 || evidence.apis.length > 0) {
    return {
      classification: "partially_automatable",
      confidence: 0.72,
      reasons: [
        ...reasons,
        "The scenario is safe, but no visible action nodes are linked to the test case.",
        setupDependencies.length > 0
          ? `Setup data dependency detected: ${setupDependencies.join(", ")}. These are expected to be supplied by the sandbox/pre-production test harness.`
          : "No credential, seeded-data, or role-user setup dependency was detected.",
        "Automation can cover page/API reachability and static assertions, but it cannot claim end-to-end action coverage."
      ],
      requiredInputs,
      automationStrategy: [
        "Automate page reachability, basic content assertions, and API smoke checks where evidence exists.",
        "Leave any missing click/form path as a manual coverage limitation until a visible action is captured."
      ],
      safeExecutionMode: "execute",
      recommendedFramework: recommendFramework(evidence, false)
    };
  }

  return {
    classification: "manual_only",
    confidence: 0.68,
    reasons: [
      ...reasons,
      "No related page, action, or API node evidence is available for a reliable automated path.",
      "A human tester must validate the scenario until the crawler captures usable runtime evidence."
    ],
    requiredInputs,
    automationStrategy: [
      "Keep the test as manual.",
      "Re-crawl with a broader page limit, supplied credentials, or seeded navigation to expose automation evidence."
    ],
    safeExecutionMode: "skip",
    recommendedFramework: "manual"
  };
}

function createScenarioGraphEvidence(
  scenario: InferredBusinessScenario,
  graphNodesById: Map<string, FlowGraphNode>
): ScenarioGraphEvidence {
  return {
    pages: getNodesById(scenario.relatedPageNodeIds, graphNodesById, "page"),
    actions: getNodesById(scenario.relatedActionNodeIds, graphNodesById, "action"),
    apis: getNodesById(scenario.relatedApiNodeIds, graphNodesById, "api")
  };
}

function getNodesById(
  nodeIds: string[],
  graphNodesById: Map<string, FlowGraphNode>,
  type: FlowGraphNode["type"]
): FlowGraphNode[] {
  return nodeIds
    .map((nodeId) => graphNodesById.get(nodeId))
    .filter((node): node is FlowGraphNode => node !== undefined && node.type === type);
}

function createBaseReasons(
  testCase: ManualTestCase,
  scenario: InferredBusinessScenario,
  evidence: ScenarioGraphEvidence
): string[] {
  return [
    `Scenario "${scenario.name}" is categorized as ${scenario.category} with priority ${scenario.priority}.`,
    `Safety classification is ${scenario.safetyClassification}.`,
    `Data dependencies are ${scenario.dataDependencies.join(", ")}.`,
    `Graph evidence links ${evidence.pages.length} page node(s), ${evidence.actions.length} action node(s), and ${evidence.apis.length} API node(s).`,
    `Manual test automatableCandidate is ${String(testCase.automatableCandidate)}.`
  ];
}

function isSandboxGuardedScenario(scenario: InferredBusinessScenario): boolean {
  return (
    scenario.safetyClassification === "potentially_destructive" ||
    scenario.safetyClassification === "externally_visible" ||
    scenario.safetyClassification === "unsafe_without_permission"
  );
}

function requiredInputsForScenario(scenario: InferredBusinessScenario): string[] {
  const inputs = scenario.dataDependencies.flatMap((dependency) => {
    switch (dependency) {
      case "none_detected":
        return ["No additional inputs detected from the runtime graph."];
      case "requires_credentials":
        return ["Approved test credentials for the target environment."];
      case "requires_seeded_data":
        return ["Stable seeded test records that match the scenario."];
      case "requires_role_based_user":
        return ["Approved role-based test user with the required permissions."];
      case "requires_payment_sandbox":
        return ["Payment sandbox, fake payment token, or mocked payment provider."];
      case "requires_external_system":
        return ["Approved external test system, sandbox endpoint, or mock service."];
      case "unknown":
        return ["Human review to identify the missing data or environment prerequisite."];
    }
  });

  return dedupe(inputs);
}

function recommendFramework(
  evidence: ScenarioGraphEvidence,
  externalDependency: boolean
): RecommendedAutomationFramework {
  if (evidence.actions.length > 0 && evidence.apis.length > 0) {
    return "ui_plus_api";
  }

  if (evidence.apis.length > 0 && evidence.actions.length === 0) {
    return "api_test";
  }

  if (evidence.actions.length > 0 || evidence.pages.length > 0) {
    return externalDependency && evidence.apis.length > 0 ? "ui_plus_api" : "playwright_ui";
  }

  return "manual";
}

function confidenceFromEvidence(
  scenario: InferredBusinessScenario,
  evidence: ScenarioGraphEvidence
): number {
  const graphStrength =
    Math.min(evidence.pages.length, 2) * 0.03 +
    Math.min(evidence.actions.length, 3) * 0.04 +
    Math.min(evidence.apis.length, 2) * 0.02;

  return clamp(Number((scenario.confidence * 0.75 + 0.16 + graphStrength).toFixed(2)), 0.7, 0.96);
}

function countBy<T>(values: T[], keySelector: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = keySelector(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

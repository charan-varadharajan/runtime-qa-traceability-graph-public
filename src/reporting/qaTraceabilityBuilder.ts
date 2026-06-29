/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import type {
  AutomationFeasibilityInventory,
  AutomationFeasibilityResult,
  BusinessScenarioInventory,
  FlowGraph,
  FlowGraphNode,
  GeneratedApiTest,
  GeneratedApiTestIndex,
  GeneratedAutomationIndex,
  GeneratedAutomationTest,
  InferredBusinessScenario,
  ManualTestCase,
  ManualTestCaseInventory,
  QATraceabilityDocument,
  QATraceabilityRecord,
  TraceabilityApiTestScriptRef,
  TraceabilityAutomationFeasibilityRef,
  TraceabilityCoverageStatus,
  TraceabilityManualTestCaseRef,
  TraceabilityRelatedApiRef,
  TraceabilityUiAutomationScriptRef
} from "../types/index.js";

export interface BuildQATraceabilityOptions {
  businessScenarios: BusinessScenarioInventory;
  manualTestCases: ManualTestCaseInventory;
  automationFeasibility: AutomationFeasibilityInventory;
  generatedAutomation: GeneratedAutomationIndex;
  generatedApiTests: GeneratedApiTestIndex;
  flowGraph: FlowGraph;
  sources: {
    businessScenariosPath: string;
    manualTestCasesPath: string;
    automationFeasibilityPath: string;
    generatedAutomationIndexPath: string;
    generatedApiTestIndexPath: string;
    flowGraphPath: string;
  };
}

export function buildQATraceability(options: BuildQATraceabilityOptions): QATraceabilityDocument {
  const startedAt = new Date().toISOString();
  const manualTestsByScenario = groupBy(options.manualTestCases.testCases, (testCase) => testCase.scenarioId);
  const feasibilityByTestCase = new Map(
    options.automationFeasibility.results.map((result) => [result.testCaseId, result])
  );
  const uiScriptsByTestCase = new Map(
    options.generatedAutomation.tests.map((script) => [script.testCaseId, script])
  );
  const apiTestsByScenario = createApiTestsByScenario(options.generatedApiTests.tests);
  const apiNodesById = new Map(
    options.flowGraph.nodes.filter((node) => node.type === "api").map((node) => [node.id, node])
  );

  const records = options.businessScenarios.scenarios.map((scenario) =>
    createTraceabilityRecord({
      scenario,
      manualTestCases: manualTestsByScenario.get(scenario.scenarioId) ?? [],
      feasibilityByTestCase,
      uiScriptsByTestCase,
      apiTests: apiTestsByScenario.get(scenario.scenarioId) ?? [],
      apiNodesById
    })
  );
  const completedAt = new Date().toISOString();

  return {
    generatedAt: completedAt,
    sources: options.sources,
    records,
    summary: {
      scenarioCount: records.length,
      manualTestCaseCount: records.reduce((count, record) => count + record.manualTestCases.length, 0),
      uiAutomationScriptCount: records.reduce((count, record) => count + record.uiAutomationScripts.length, 0),
      apiTestScriptCount: records.reduce((count, record) => count + record.apiTestScripts.length, 0),
      byCoverageStatus: countBy(records, (record) => record.coverageStatus),
      byBusinessValidationDecision: countBy(records, (record) => record.businessValidationDecision),
      startedAt,
      completedAt
    }
  };
}

interface RecordContext {
  scenario: InferredBusinessScenario;
  manualTestCases: ManualTestCase[];
  feasibilityByTestCase: Map<string, AutomationFeasibilityResult>;
  uiScriptsByTestCase: Map<string, GeneratedAutomationTest>;
  apiTests: GeneratedApiTest[];
  apiNodesById: Map<string, FlowGraphNode>;
}

function createTraceabilityRecord(context: RecordContext): QATraceabilityRecord {
  const manualTestCases = context.manualTestCases.map(toManualTestRef);
  const automationFeasibility = context.manualTestCases
    .map((testCase) => context.feasibilityByTestCase.get(testCase.testCaseId))
    .filter((result): result is AutomationFeasibilityResult => Boolean(result))
    .map(toAutomationFeasibilityRef);
  const uiAutomationScripts = context.manualTestCases
    .map((testCase) => context.uiScriptsByTestCase.get(testCase.testCaseId))
    .filter((script): script is GeneratedAutomationTest => Boolean(script))
    .map(toUiAutomationScriptRef);
  const apiTestScripts = context.apiTests.map(toApiTestScriptRef);
  const relatedApis = createRelatedApis(context.scenario, context.apiTests, context.apiNodesById);
  const coverageLimitations = createCoverageLimitations(
    context.manualTestCases,
    automationFeasibility,
    uiAutomationScripts,
    apiTestScripts
  );
  const requiredUserInputs = createRequiredUserInputs(
    automationFeasibility,
    uiAutomationScripts,
    apiTestScripts
  );
  const coverageStatus = inferCoverageStatus({
    scenario: context.scenario,
    manualTestCases: context.manualTestCases,
    feasibility: automationFeasibility,
    uiScripts: uiAutomationScripts,
    apiScripts: apiTestScripts,
    coverageLimitations,
    requiredUserInputs
  });

  return {
    scenarioId: context.scenario.scenarioId,
    scenarioName: context.scenario.name,
    scenarioCategory: context.scenario.category,
    scenarioPriority: context.scenario.priority,
    scenarioConfidence: context.scenario.confidence,
    requirementSource: context.scenario.source,
    evidence: context.scenario.evidence,
    manualTestCases,
    uiAutomationScripts,
    apiTestScripts,
    relatedApis,
    automationFeasibility,
    safetyClassification: context.scenario.safetyClassification,
    dataDependencies: context.scenario.dataDependencies,
    coverageStatus,
    coverageLimitations,
    requiredUserInputs,
    businessValidationDecision: "not_executed",
    decisionReason: createDecisionReason(coverageStatus)
  };
}

function toManualTestRef(testCase: ManualTestCase): TraceabilityManualTestCaseRef {
  return {
    testCaseId: testCase.testCaseId,
    title: testCase.title,
    priority: testCase.priority,
    automatableCandidate: testCase.automatableCandidate,
    steps: testCase.steps,
    expectedResult: testCase.expectedResult,
    coverageLimitations: testCase.coverageLimitations
  };
}

function toAutomationFeasibilityRef(
  feasibility: AutomationFeasibilityResult
): TraceabilityAutomationFeasibilityRef {
  return {
    testCaseId: feasibility.testCaseId,
    classification: feasibility.classification,
    confidence: feasibility.confidence,
    safeExecutionMode: feasibility.safeExecutionMode,
    recommendedFramework: feasibility.recommendedFramework,
    reasons: feasibility.reasons,
    requiredInputs: feasibility.requiredInputs,
    automationStrategy: feasibility.automationStrategy
  };
}

function toUiAutomationScriptRef(script: GeneratedAutomationTest): TraceabilityUiAutomationScriptRef {
  return {
    testCaseId: script.testCaseId,
    filePath: script.filePath,
    title: script.title,
    classification: script.classification,
    safeExecutionMode: script.safeExecutionMode,
    requiredEnvVars: script.requiredEnvVars,
    generationNotes: script.generationNotes
  };
}

function toApiTestScriptRef(test: GeneratedApiTest): TraceabilityApiTestScriptRef {
  return {
    apiNodeId: test.apiNodeId,
    filePath: test.filePath,
    title: test.title,
    method: test.method,
    redactedUrl: test.redactedUrl,
    executableByDefault: test.executableByDefault,
    skipReason: test.skipReason,
    requiredEnvVars: test.requiredEnvVars
  };
}

function createRelatedApis(
  scenario: InferredBusinessScenario,
  apiTests: GeneratedApiTest[],
  apiNodesById: Map<string, FlowGraphNode>
): TraceabilityRelatedApiRef[] {
  const apiNodeIds = dedupe([
    ...scenario.relatedApiNodeIds,
    ...apiTests.map((test) => test.apiNodeId).filter((id): id is string => Boolean(id))
  ]);

  return apiNodeIds
    .map((apiNodeId) => apiNodesById.get(apiNodeId))
    .filter((node): node is FlowGraphNode => Boolean(node))
    .map((node) => ({
      apiNodeId: node.id,
      label: node.label,
      method: getString(node.metadata?.method),
      redactedUrl: getString(node.metadata?.requestUrl),
      statusCode: getNumber(node.metadata?.statusCode),
      responseContentType: getString(node.metadata?.responseContentType),
      source: node.source,
      confidence: node.confidence
    }));
}

function createCoverageLimitations(
  manualTestCases: ManualTestCase[],
  feasibility: TraceabilityAutomationFeasibilityRef[],
  uiScripts: TraceabilityUiAutomationScriptRef[],
  apiScripts: TraceabilityApiTestScriptRef[]
): string[] {
  const limitations = manualTestCases.flatMap((testCase) => testCase.coverageLimitations);

  for (const result of feasibility) {
    if (result.classification === "blocked_by_missing_data") {
      limitations.push(`Automation blocked for ${result.testCaseId}: missing data or environment setup.`);
    }

    if (result.safeExecutionMode === "mock_required") {
      limitations.push(`Automation for ${result.testCaseId} requires a mock, sandbox, or external-system substitute.`);
    }

    if (result.safeExecutionMode === "dry_run") {
      limitations.push(`Automation for ${result.testCaseId} is limited to dry-run behavior.`);
    }
  }

  for (const script of uiScripts) {
    for (const note of script.generationNotes) {
      if (note.includes("does not execute")) {
        limitations.push(`${script.filePath}: ${note}`);
      }
    }
  }

  for (const apiScript of apiScripts) {
    if (!apiScript.executableByDefault) {
      limitations.push(`${apiScript.filePath}: ${apiScript.skipReason ?? "API smoke test is skipped by default."}`);
    }
  }

  return dedupe(limitations);
}

function createRequiredUserInputs(
  feasibility: TraceabilityAutomationFeasibilityRef[],
  uiScripts: TraceabilityUiAutomationScriptRef[],
  apiScripts: TraceabilityApiTestScriptRef[]
): string[] {
  return dedupe([
    ...feasibility.flatMap((result) => result.requiredInputs),
    ...uiScripts.flatMap((script) => script.requiredEnvVars.map((envVar) => `Environment variable ${envVar}`)),
    ...apiScripts.flatMap((script) => script.requiredEnvVars.map((envVar) => `Environment variable ${envVar}`))
  ]);
}

interface CoverageContext {
  scenario: InferredBusinessScenario;
  manualTestCases: ManualTestCase[];
  feasibility: TraceabilityAutomationFeasibilityRef[];
  uiScripts: TraceabilityUiAutomationScriptRef[];
  apiScripts: TraceabilityApiTestScriptRef[];
  coverageLimitations: string[];
  requiredUserInputs: string[];
}

function inferCoverageStatus(context: CoverageContext): TraceabilityCoverageStatus {
  if (
    context.feasibility.some((result) => result.classification === "unsafe_to_automate") &&
    context.uiScripts.length === 0 &&
    context.apiScripts.length === 0
  ) {
    return "unsafe";
  }

  if (
    context.feasibility.some((result) => result.classification === "blocked_by_missing_data") &&
    context.uiScripts.length === 0 &&
    context.apiScripts.length === 0
  ) {
    return "blocked";
  }

  if (context.manualTestCases.length === 0) {
    return "not_covered";
  }

  if (context.uiScripts.length === 0 && context.apiScripts.length === 0) {
    return "not_covered";
  }

  if (
    context.feasibility.some((result) => result.classification === "manual_only") ||
    context.feasibility.some((result) => result.classification === "partially_automatable") ||
    context.feasibility.some((result) => result.safeExecutionMode === "mock_required") ||
    context.apiScripts.some((script) => !script.executableByDefault) ||
    context.coverageLimitations.some(isMaterialCoverageLimitation) ||
    context.requiredUserInputs.length > 0
  ) {
    return "partially_covered";
  }

  return "covered";
}

function isMaterialCoverageLimitation(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("limited") ||
    normalized.includes("blocked") ||
    normalized.includes("manual") ||
    normalized.includes("dry-run") ||
    normalized.includes("external") ||
    normalized.includes("unknown") ||
    normalized.includes("credentials") ||
    normalized.includes("seed")
  );
}

function createDecisionReason(coverageStatus: TraceabilityCoverageStatus): string {
  return `No execution result has been recorded yet. Static traceability coverage is ${coverageStatus}.`;
}

function createApiTestsByScenario(apiTests: GeneratedApiTest[]): Map<string, GeneratedApiTest[]> {
  const grouped = new Map<string, GeneratedApiTest[]>();

  for (const apiTest of apiTests) {
    for (const scenarioId of apiTest.relatedScenarioIds) {
      const existing = grouped.get(scenarioId) ?? [];
      existing.push(apiTest);
      grouped.set(scenarioId, existing);
    }
  }

  return grouped;
}

function groupBy<T>(values: T[], keySelector: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = keySelector(value);
    const existing = grouped.get(key) ?? [];
    existing.push(value);
    grouped.set(key, existing);
  }

  return grouped;
}

function countBy<T>(values: T[], keySelector: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = keySelector(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

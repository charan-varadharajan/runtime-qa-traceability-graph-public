export type AnalysisRunStatus =
  | "initialized"
  | "crawling"
  | "extracting"
  | "generating"
  | "executing"
  | "completed"
  | "failed";

export interface AnalysisRun {
  id: string;
  targetUrl: string;
  status: AnalysisRunStatus;
  createdAt: string;
  updatedAt: string;
  artifacts: {
    metadataPath: string;
    crawlOutputPath?: string;
    domInventoryPath?: string;
    interactionInventoryPath?: string;
    networkInventoryPath?: string;
    flowGraphPath?: string;
    scenariosPath?: string;
    manualTestCasesPath?: string;
    automationFeasibilityPath?: string;
    generatedAutomationIndexPath?: string;
    crossOriginDependenciesPath?: string;
    automationScriptsPath?: string;
    apiSmokeTestsPath?: string;
    generatedApiTestIndexPath?: string;
    traceabilityPath?: string;
    htmlReportPath?: string;
  };
  crawlSummary?: CrawlSummary;
  domSummary?: DomInventorySummary;
  interactionSummary?: InteractionInventorySummary;
  networkSummary?: NetworkInventorySummary;
  flowGraphSummary?: FlowGraphSummary;
  businessScenarioSummary?: BusinessScenarioSummary;
  manualTestCaseSummary?: ManualTestCaseSummary;
  automationFeasibilitySummary?: AutomationFeasibilitySummary;
  generatedAutomationSummary?: GeneratedAutomationSummary;
  generatedApiTestSummary?: GeneratedApiTestSummary;
  qaTraceabilitySummary?: QATraceabilitySummary;
  crossOriginDependencySummary?: CrossOriginDependencySummary;
  authSession?: CrawlAuthSession;
  errorMessage?: string;
}

export interface CrawlSummary {
  maxPages: number;
  crawledPages: number;
  failedPages: number;
  discoveredUrls: number;
  startedAt: string;
  completedAt: string;
}

export interface CrawlResult {
  startUrl: string;
  origin: string;
  maxPages: number;
  pages: CrawledPage[];
  skippedUrls: SkippedUrl[];
  storageState?: BrowserStorageState;
  authSession?: CrawlAuthSession;
  summary: CrawlSummary;
}

export interface BrowserStorageState {
  cookies: BrowserStorageCookie[];
  origins: BrowserStorageOrigin[];
}

export interface BrowserStorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface BrowserStorageOrigin {
  origin: string;
  localStorage: {
    name: string;
    value: string;
  }[];
}

export interface CrawlAuthSession {
  attempted: boolean;
  method: "provided_credentials" | "auto_registration" | "none";
  status: "authenticated" | "skipped" | "failed";
  userName?: string;
  generatedCredentials: boolean;
  entryUrl?: string;
  message: string;
}

export interface CrawledPage {
  url: string;
  title: string;
  status?: number;
  discoveredLinks: string[];
  timestamp: string;
  errorMessage?: string;
}

export interface SkippedUrl {
  url: string;
  reason: string;
}

export interface CrossOriginDependencyInventory {
  sourceCrawlPath: string;
  generatedAt: string;
  policy: "same_origin_only";
  dependencies: CrossOriginDependency[];
  summary: CrossOriginDependencySummary;
}

export interface CrossOriginDependency {
  origin: string;
  url: string;
  reason: "cross-origin";
  handling: "not_crawled";
  recommendation: string;
}

export interface CrossOriginDependencySummary {
  totalUrls: number;
  uniqueOrigins: number;
  byOrigin: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export type BasicActionClassification =
  | "navigation"
  | "submit"
  | "search"
  | "login"
  | "logout"
  | "signup"
  | "contact"
  | "cart"
  | "checkout"
  | "account_overview"
  | "account_opening"
  | "account_management"
  | "funds_transfer"
  | "bill_payment"
  | "loan_application"
  | "admin"
  | "service_definition"
  | "ui_state_management"
  | "item_creation"
  | "item_removal"
  | "dynamic_content"
  | "modal_dialog"
  | "filtering_sorting"
  | "file_upload"
  | "validation_feedback"
  | "unknown";

export interface DomInventory {
  sourceCrawlPath: string;
  generatedAt: string;
  pages: DomInventoryPage[];
  summary: DomInventorySummary;
}

export interface DomInventorySummary {
  pagesAnalyzed: number;
  failedPages: number;
  forms: number;
  buttons: number;
  links: number;
  inputsOutsideForms: number;
  headings: number;
  messageCandidates: number;
  startedAt: string;
  completedAt: string;
}

export interface DomInventoryPage {
  url: string;
  title: string;
  status?: number;
  timestamp: string;
  forms: DomInventoryForm[];
  buttons: DomInventoryButton[];
  links: DomInventoryLink[];
  inputsOutsideForms: DomInventoryInput[];
  importantText: DomImportantText;
  errorMessage?: string;
}

export interface DomInventoryForm {
  index: number;
  id?: string;
  name?: string;
  action?: string;
  method: string;
  selector: string;
  actionClassification: BasicActionClassification;
  inputs: DomInventoryInput[];
  buttons: DomInventoryButton[];
}

export interface DomInventoryInput {
  type: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  required: boolean;
  selector: string;
  actionClassification: BasicActionClassification;
}

export interface DomInventoryButton {
  text?: string;
  ariaLabel?: string;
  role?: string;
  disabled: boolean;
  selector: string;
  actionClassification: BasicActionClassification;
}

export interface DomInventoryLink {
  text?: string;
  href: string;
  scope: "internal" | "external";
  selector: string;
  actionClassification: BasicActionClassification;
}

export interface DomImportantText {
  headings: DomHeading[];
  messageCandidates: DomMessageCandidate[];
}

export interface DomHeading {
  level: 1 | 2 | 3;
  text: string;
  selector: string;
}

export interface DomMessageCandidate {
  text: string;
  kind: "error" | "success" | "status";
  selector: string;
}

export interface InteractionInventory {
  sourceCrawlPath: string;
  sourceDomInventoryPath: string;
  generatedAt: string;
  pages: InteractionInventoryPage[];
  summary: InteractionInventorySummary;
}

export interface InteractionInventorySummary {
  pagesAnalyzed: number;
  failedPages: number;
  candidateActions: number;
  interactionsAttempted: number;
  interactionsWithDomChanges: number;
  discoveredActions: number;
  startedAt: string;
  completedAt: string;
}

export interface InteractionInventoryPage {
  url: string;
  title: string;
  timestamp: string;
  staticScriptHints: StaticScriptHint[];
  interactions: InteractionObservation[];
  errorMessage?: string;
}

export interface StaticScriptHint {
  kind:
    | "event_listener"
    | "dom_append"
    | "dom_remove"
    | "dom_toggle"
    | "modal"
    | "validation"
    | "literal_text";
  value: string;
  evidence: string;
}

export interface InteractionObservation {
  actionLabel: string;
  actionSelector: string;
  actionClassification: BasicActionClassification;
  safeAction: boolean;
  clicked: boolean;
  urlBefore: string;
  urlAfter: string;
  addedActions: InteractionDiscoveredAction[];
  removedActions: InteractionDiscoveredAction[];
  addedTexts: string[];
  removedTexts: string[];
  networkCalls: InteractionNetworkCall[];
  cleanupAction?: InteractionCleanupAction;
  staticHints: string[];
  evidence: string[];
}

export interface InteractionDiscoveredAction {
  label: string;
  selector: string;
  role?: string;
  actionClassification: BasicActionClassification;
}

export interface InteractionNetworkCall {
  requestUrl: string;
  method: string;
  resourceType: string;
  statusCode?: number;
}

export interface InteractionCleanupAction {
  actionLabel: string;
  actionSelector: string;
  actionClassification: BasicActionClassification;
  removedSelector: string;
  evidence: string[];
}

export type ApiClassification =
  | "auth"
  | "search"
  | "product"
  | "account"
  | "transfer"
  | "bill_payment"
  | "loan"
  | "payment"
  | "cart"
  | "checkout"
  | "admin"
  | "service_definition"
  | "content"
  | "analytics"
  | "unknown";

export interface NetworkInventory {
  sourceCrawlPath: string;
  generatedAt: string;
  pages: NetworkInventoryPage[];
  summary: NetworkInventorySummary;
}

export interface NetworkInventorySummary {
  pagesVisited: number;
  failedPages: number;
  totalNetworkCalls: number;
  likelyApiCalls: number;
  failedCalls: number;
  startedAt: string;
  completedAt: string;
}

export interface NetworkInventoryPage {
  url: string;
  title: string;
  timestamp: string;
  calls: CapturedNetworkCall[];
  errorMessage?: string;
}

export interface CapturedNetworkCall {
  requestUrl: string;
  method: string;
  resourceType: string;
  statusCode?: number;
  responseContentType?: string;
  requestPostData?: unknown;
  responseBodySample?: unknown;
  timing?: NetworkTiming;
  likelyApiCall: boolean;
  apiIndicators: string[];
  apiClassification: ApiClassification;
  failureText?: string;
}

export interface NetworkTiming {
  startTime?: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  secureConnectionStart?: number;
  connectEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
}

export type FlowGraphNodeType = "page" | "action" | "api" | "form" | "message";

export type FlowGraphEdgeType =
  | "page_has_action"
  | "page_links_to_page"
  | "page_calls_api"
  | "form_has_input"
  | "action_may_trigger_api"
  | "action_may_navigate_to_page"
  | "action_reveals_action"
  | "action_removes_element"
  | "action_mutates_dom"
  | "action_triggers_network";

export interface FlowGraph {
  generatedAt: string;
  sources: {
    crawlResultPath: string;
    domInventoryPath: string;
    interactionInventoryPath?: string;
    networkInventoryPath: string;
  };
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  summary: FlowGraphSummary;
}

export interface FlowGraphNode {
  id: string;
  type: FlowGraphNodeType;
  label: string;
  source: string;
  confidence: number;
  evidence: string[];
  metadata?: Record<string, unknown>;
}

export interface FlowGraphEdge {
  from: string;
  to: string;
  type: FlowGraphEdgeType;
  confidence: number;
  evidence: string[];
}

export interface FlowGraphSummary {
  pageCount: number;
  actionCount: number;
  apiCount: number;
  formCount: number;
  messageCount: number;
  inferredEdgeCount: number;
  lowConfidenceEdgeCount: number;
  startedAt: string;
  completedAt: string;
}

export type BusinessScenarioCategory =
  | "authentication"
  | "session_management"
  | "registration"
  | "search"
  | "navigation"
  | "contact"
  | "ecommerce_cart"
  | "checkout"
  | "payment"
  | "funds_transfer"
  | "bill_payment"
  | "loan_application"
  | "account_overview"
  | "account_opening"
  | "account_management"
  | "administration"
  | "service_integration"
  | "content_browsing"
  | "ui_state_management"
  | "item_creation"
  | "item_removal"
  | "dynamic_content"
  | "modal_dialog"
  | "filtering_sorting"
  | "file_upload"
  | "validation_feedback"
  | "form_submission"
  | "unknown";

export type BusinessScenarioPriority = "critical" | "high" | "medium" | "low";

export type ScenarioDataDependency =
  | "none_detected"
  | "requires_credentials"
  | "requires_seeded_data"
  | "requires_role_based_user"
  | "requires_payment_sandbox"
  | "requires_external_system"
  | "unknown";

export type ScenarioSafetyClassification =
  | "safe_read_only"
  | "safe_non_destructive"
  | "potentially_destructive"
  | "externally_visible"
  | "unsafe_without_permission";

export interface BusinessScenarioInventory {
  sourceFlowGraphPath: string;
  generatedAt: string;
  scenarios: InferredBusinessScenario[];
  summary: BusinessScenarioSummary;
}

export interface BusinessScenarioSummary {
  scenarioCount: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  bySafetyClassification: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export interface InferredBusinessScenario {
  scenarioId: string;
  name: string;
  description: string;
  category: BusinessScenarioCategory;
  priority: BusinessScenarioPriority;
  confidence: number;
  source: "inferred_from_runtime_graph";
  evidence: string[];
  relatedPageNodeIds: string[];
  relatedActionNodeIds: string[];
  relatedApiNodeIds: string[];
  dataDependencies: ScenarioDataDependency[];
  safetyClassification: ScenarioSafetyClassification;
}

export interface PageNode {
  id: string;
  url: string;
  title?: string;
  discoveredFrom?: string;
  depth: number;
  actions: DomAction[];
  networkCalls: NetworkCall[];
}

export type DomActionType =
  | "click"
  | "input"
  | "select"
  | "submit"
  | "navigation"
  | "keyboard"
  | "unknown";

export interface DomAction {
  id: string;
  pageNodeId: string;
  type: DomActionType;
  selector: string;
  label?: string;
  role?: string;
  text?: string;
  requiredInput?: boolean;
  inferredPurpose?: string;
}

export type NetworkCallType = "xhr" | "fetch" | "document" | "script" | "stylesheet" | "image" | "other";

export interface NetworkCall {
  id: string;
  pageNodeId: string;
  url: string;
  method: string;
  type: NetworkCallType;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBodyPreview?: string;
  responseBodyPreview?: string;
}

export interface BusinessScenario {
  id: string;
  name: string;
  description: string;
  entryPageNodeId?: string;
  relatedPageNodeIds: string[];
  relatedDomActionIds: string[];
  relatedNetworkCallIds: string[];
  confidence: number;
}

export interface ManualTestCaseInventory {
  sourceScenariosPath: string;
  generatedAt: string;
  testCases: ManualTestCase[];
  summary: ManualTestCaseSummary;
}

export interface ManualTestCaseSummary {
  testCaseCount: number;
  byPriority: Record<string, number>;
  automatableCandidateCount: number;
  manualOnlyCount: number;
  startedAt: string;
  completedAt: string;
}

export interface ManualTestCase {
  testCaseId: string;
  scenarioId: string;
  title: string;
  objective: string;
  preconditions: string[];
  testData: string[];
  steps: string[];
  expectedResult: string;
  priority: BusinessScenarioPriority;
  automatableCandidate: boolean;
  automationNotes: string[];
  coverageLimitations: string[];
  evidenceSource: ManualTestEvidenceSource;
}

export interface ManualTestEvidenceSource {
  scenarioSource: "inferred_from_runtime_graph";
  scenarioCategory: BusinessScenarioCategory;
  scenarioConfidence: number;
  evidence: string[];
  relatedPageNodeIds: string[];
  relatedActionNodeIds: string[];
  relatedApiNodeIds: string[];
}

export type AutomationFeasibilityClassification =
  | "fully_automatable"
  | "partially_automatable"
  | "manual_only"
  | "unsafe_to_automate"
  | "blocked_by_missing_data";

export type AutomationSafeExecutionMode = "execute" | "dry_run" | "mock_required" | "skip";

export type RecommendedAutomationFramework =
  | "playwright_ui"
  | "api_test"
  | "ui_plus_api"
  | "manual";

export interface AutomationFeasibilityInventory {
  sourceManualTestCasesPath: string;
  sourceBusinessScenariosPath: string;
  sourceFlowGraphPath: string;
  generatedAt: string;
  results: AutomationFeasibilityResult[];
  summary: AutomationFeasibilitySummary;
}

export interface AutomationFeasibilitySummary {
  resultCount: number;
  byClassification: Record<string, number>;
  bySafeExecutionMode: Record<string, number>;
  byRecommendedFramework: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export interface AutomationFeasibilityResult {
  testCaseId: string;
  scenarioId: string;
  classification: AutomationFeasibilityClassification;
  confidence: number;
  reasons: string[];
  requiredInputs: string[];
  automationStrategy: string[];
  safeExecutionMode: AutomationSafeExecutionMode;
  recommendedFramework: RecommendedAutomationFramework;
}

export interface GeneratedAutomationIndex {
  sourceManualTestCasesPath: string;
  sourceAutomationFeasibilityPath: string;
  sourceFlowGraphPath: string;
  sourceDomInventoryPath: string;
  generatedAt: string;
  outputDirectory: string;
  tests: GeneratedAutomationTest[];
  summary: GeneratedAutomationSummary;
}

export interface GeneratedAutomationSummary {
  generatedTestCount: number;
  skippedCandidateCount: number;
  byClassification: Record<string, number>;
  bySafeExecutionMode: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export interface GeneratedAutomationTest {
  testCaseId: string;
  scenarioId: string;
  title: string;
  classification: AutomationFeasibilityClassification;
  safeExecutionMode: AutomationSafeExecutionMode;
  filePath: string;
  relatedApiNodeIds: string[];
  requiredEnvVars: string[];
  generationNotes: string[];
}

export interface GeneratedApiTestIndex {
  sourceNetworkInventoryPath: string;
  sourceFlowGraphPath: string;
  sourceBusinessScenariosPath: string;
  generatedAt: string;
  outputDirectory: string;
  tests: GeneratedApiTest[];
  summary: GeneratedApiTestSummary;
}

export interface GeneratedApiTestSummary {
  generatedTestCount: number;
  executableByDefaultCount: number;
  skippedByDefaultCount: number;
  byMethod: Record<string, number>;
  byRelatedScenario: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export interface GeneratedApiTest {
  apiNodeId?: string;
  relatedScenarioIds: string[];
  filePath: string;
  title: string;
  method: string;
  redactedUrl: string;
  expectedContentType?: string;
  executableByDefault: boolean;
  skipReason?: string;
  requiredEnvVars: string[];
}

export type TraceabilityCoverageStatus =
  | "covered"
  | "partially_covered"
  | "not_covered"
  | "blocked"
  | "unsafe";

export type BusinessValidationDecision =
  | "not_executed"
  | "passed"
  | "failed"
  | "partially_validated"
  | "blocked";

export interface QATraceabilityDocument {
  generatedAt: string;
  executedAt?: string;
  sources: {
    businessScenariosPath: string;
    manualTestCasesPath: string;
    automationFeasibilityPath: string;
    generatedAutomationIndexPath: string;
    generatedApiTestIndexPath: string;
    flowGraphPath: string;
  };
  records: QATraceabilityRecord[];
  summary: QATraceabilitySummary;
  executionSummary?: ExecutionResultsSummary;
}

export interface QATraceabilitySummary {
  scenarioCount: number;
  manualTestCaseCount: number;
  uiAutomationScriptCount: number;
  apiTestScriptCount: number;
  byCoverageStatus: Record<string, number>;
  byBusinessValidationDecision: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export interface QATraceabilityRecord {
  scenarioId: string;
  scenarioName: string;
  scenarioCategory: BusinessScenarioCategory;
  scenarioPriority: BusinessScenarioPriority;
  scenarioConfidence: number;
  requirementSource: "inferred_from_runtime_graph";
  evidence: string[];
  manualTestCases: TraceabilityManualTestCaseRef[];
  uiAutomationScripts: TraceabilityUiAutomationScriptRef[];
  apiTestScripts: TraceabilityApiTestScriptRef[];
  relatedApis: TraceabilityRelatedApiRef[];
  automationFeasibility: TraceabilityAutomationFeasibilityRef[];
  safetyClassification: ScenarioSafetyClassification;
  dataDependencies: ScenarioDataDependency[];
  coverageStatus: TraceabilityCoverageStatus;
  coverageLimitations: string[];
  requiredUserInputs: string[];
  businessValidationDecision: BusinessValidationDecision;
  decisionReason: string;
  executionResults?: TraceabilityExecutionResultRef[];
}

export interface TraceabilityManualTestCaseRef {
  testCaseId: string;
  title: string;
  priority: BusinessScenarioPriority;
  automatableCandidate: boolean;
  steps: string[];
  expectedResult: string;
  coverageLimitations: string[];
}

export interface TraceabilityUiAutomationScriptRef {
  testCaseId: string;
  filePath: string;
  title: string;
  classification: AutomationFeasibilityClassification;
  safeExecutionMode: AutomationSafeExecutionMode;
  requiredEnvVars: string[];
  generationNotes: string[];
}

export interface TraceabilityApiTestScriptRef {
  apiNodeId?: string;
  filePath: string;
  title: string;
  method: string;
  redactedUrl: string;
  executableByDefault: boolean;
  skipReason?: string;
  requiredEnvVars: string[];
}

export interface TraceabilityRelatedApiRef {
  apiNodeId: string;
  label: string;
  method?: string;
  redactedUrl?: string;
  statusCode?: number;
  responseContentType?: string;
  source: string;
  confidence: number;
}

export interface TraceabilityAutomationFeasibilityRef {
  testCaseId: string;
  classification: AutomationFeasibilityClassification;
  confidence: number;
  safeExecutionMode: AutomationSafeExecutionMode;
  recommendedFramework: RecommendedAutomationFramework;
  reasons: string[];
  requiredInputs: string[];
  automationStrategy: string[];
}

export type ExecutionTestType = "ui" | "api";

export type ExecutionScriptStatus = "passed" | "failed" | "skipped";

export interface ExecutionResultsDocument {
  generatedAt: string;
  sources: {
    qaTraceabilityPath: string;
    uiConfigPath: string;
    apiConfigPath: string;
  };
  scriptResults: ExecutionScriptResult[];
  scenarioResults: ScenarioExecutionResult[];
  summary: ExecutionResultsSummary;
}

export interface ExecutionScriptResult {
  testName: string;
  scenarioId: string;
  testCaseId?: string;
  scriptPath: string;
  status: ExecutionScriptStatus;
  errorMessage?: string;
  durationMs: number;
  testType: ExecutionTestType;
  artifacts?: ExecutionArtifact[];
}

export interface ExecutionArtifact {
  name: string;
  path: string;
  contentType?: string;
}

export interface ScenarioExecutionResult {
  scenarioId: string;
  scenarioName: string;
  scenarioPriority: BusinessScenarioPriority;
  businessValidationDecision: BusinessValidationDecision;
  decisionReason: string;
  scriptResults: ExecutionScriptResult[];
}

export interface TraceabilityExecutionResultRef {
  testName: string;
  testCaseId?: string;
  scriptPath: string;
  status: ExecutionScriptStatus;
  errorMessage?: string;
  durationMs: number;
  testType: ExecutionTestType;
  artifacts?: ExecutionArtifact[];
}

export interface ExecutionResultsSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  scenarioCount: number;
  byBusinessValidationDecision: Record<string, number>;
  startedAt: string;
  completedAt: string;
}

export type AutomationFeasibility = "automatable" | "partially-automatable" | "manual-only" | "unknown";

export interface AutomationScript {
  id: string;
  scenarioId: string;
  testCaseId?: string;
  title: string;
  framework: "playwright";
  language: "typescript";
  feasibility: AutomationFeasibility;
  filePath?: string;
  limitations: CoverageLimitation[];
}

export interface TraceabilityRecord {
  id: string;
  scenarioId: string;
  pageNodeIds: string[];
  domActionIds: string[];
  networkCallIds: string[];
  manualTestCaseIds: string[];
  automationScriptIds: string[];
  coverageLimitations: CoverageLimitation[];
}

export type CoverageLimitationSeverity = "info" | "warning" | "blocking";

export interface CoverageLimitation {
  id: string;
  severity: CoverageLimitationSeverity;
  reason: string;
  affectedArtifactIds: string[];
  recommendation?: string;
}

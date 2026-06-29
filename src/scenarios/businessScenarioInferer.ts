/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { createHash } from "node:crypto";
import type {
  BusinessScenarioCategory,
  BusinessScenarioInventory,
  BusinessScenarioPriority,
  FlowGraph,
  FlowGraphEdge,
  FlowGraphNode,
  InferredBusinessScenario,
  ScenarioDataDependency,
  ScenarioSafetyClassification
} from "../types/index.js";

export interface InferBusinessScenariosOptions {
  flowGraph: FlowGraph;
  sourceFlowGraphPath: string;
}

interface ScenarioSeed {
  category: BusinessScenarioCategory;
  name: string;
  description: string;
  priority: BusinessScenarioPriority;
  confidence: number;
  evidence: string[];
  relatedPageNodeIds: Set<string>;
  relatedActionNodeIds: Set<string>;
  relatedApiNodeIds: Set<string>;
  dataDependencies: Set<ScenarioDataDependency>;
  safetyClassification: ScenarioSafetyClassification;
}

interface GraphIndexes {
  pages: FlowGraphNode[];
  actions: FlowGraphNode[];
  apis: FlowGraphNode[];
  forms: FlowGraphNode[];
  pageIdsByUrl: Map<string, string>;
  pageIdsByActionId: Map<string, Set<string>>;
  apiIdsByActionId: Map<string, Set<string>>;
}

export function inferBusinessScenarios(
  options: InferBusinessScenariosOptions
): BusinessScenarioInventory {
  const startedAt = new Date().toISOString();
  const indexes = createGraphIndexes(options.flowGraph);
  const seeds = new Map<BusinessScenarioCategory, ScenarioSeed>();

  inferActionScenarios(seeds, indexes);
  inferFormScenarios(seeds, indexes);
  inferApiScenarios(seeds, indexes);
  inferContentBrowsingScenario(seeds, indexes);
  inferNavigationScenario(seeds, indexes, options.flowGraph.edges);

  const completedAt = new Date().toISOString();
  const scenarios = Array.from(seeds.values())
    .map(toBusinessScenario)
    .sort((a, b) => {
      const priorityComparison = priorityRank(a.priority) - priorityRank(b.priority);
      return priorityComparison !== 0 ? priorityComparison : a.scenarioId.localeCompare(b.scenarioId);
    });

  return {
    sourceFlowGraphPath: options.sourceFlowGraphPath,
    generatedAt: completedAt,
    scenarios,
    summary: {
      scenarioCount: scenarios.length,
      byCategory: countBy(scenarios, (scenario) => scenario.category),
      byPriority: countBy(scenarios, (scenario) => scenario.priority),
      bySafetyClassification: countBy(scenarios, (scenario) => scenario.safetyClassification),
      startedAt,
      completedAt
    }
  };
}

function inferActionScenarios(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  indexes: GraphIndexes
): void {
  for (const action of indexes.actions) {
    const category = categorizeAction(action);

    if (category === "unknown") {
      continue;
    }

    const seed = getOrCreateSeed(seeds, category);
    seed.relatedActionNodeIds.add(action.id);
    addRelatedPages(seed, indexes.pageIdsByActionId.get(action.id));
    addRelatedApis(seed, indexes.apiIdsByActionId.get(action.id));
    seed.evidence.push(`Action "${action.label}" classified as ${category}`);
    seed.confidence = Math.max(seed.confidence, action.confidence * 0.88);
  }
}

function inferFormScenarios(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  indexes: GraphIndexes
): void {
  for (const form of indexes.forms) {
    const category =
      categoryFromActionClassification(String(form.metadata?.actionClassification ?? "unknown")) ??
      categorizeByVisibleIntent(form, { allowInputIntent: false }) ??
      "form_submission";
    const seed = getOrCreateSeed(seeds, category);

    seed.relatedActionNodeIds.add(form.id);
    addRelatedPages(seed, pageIdsForNode(form, indexes));
    seed.evidence.push(`Form "${form.label}" suggests ${category}`);
    seed.confidence = Math.max(seed.confidence, form.confidence * 0.86);
  }
}

function inferApiScenarios(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  indexes: GraphIndexes
): void {
  for (const api of indexes.apis) {
    const category = categoryFromApiClassification(String(api.metadata?.apiClassification ?? "unknown"));

    if (category === "unknown") {
      continue;
    }

    const seed = getOrCreateSeed(seeds, category);
    seed.relatedApiNodeIds.add(api.id);
    seed.evidence.push(`API "${api.label}" classified as ${category}`);
    seed.confidence = Math.max(seed.confidence, api.confidence * 0.9);
  }
}

function inferContentBrowsingScenario(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  indexes: GraphIndexes
): void {
  const contentPages = indexes.pages.filter((page) => isContentPage(page));

  if (contentPages.length === 0) {
    return;
  }

  const seed = getOrCreateSeed(seeds, "content_browsing");

  for (const page of contentPages) {
    seed.relatedPageNodeIds.add(page.id);
  }

  seed.evidence.push(`${contentPages.length} crawled page(s) look like readable content or documentation`);
  seed.confidence = Math.max(seed.confidence, 0.82);
}

function inferNavigationScenario(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  indexes: GraphIndexes,
  edges: FlowGraphEdge[]
): void {
  const navigationActionIds = indexes.actions
    .filter(
      (action) =>
        action.metadata?.actionClassification === "navigation" &&
        action.metadata?.scope !== "external"
    )
    .map((action) => action.id);
  const navigationEdges = edges.filter(
    (edge) => edge.type === "action_may_navigate_to_page" || edge.type === "page_links_to_page"
  );

  if (navigationActionIds.length === 0 && navigationEdges.length === 0) {
    return;
  }

  const seed = getOrCreateSeed(seeds, "navigation");

  for (const actionId of navigationActionIds) {
    seed.relatedActionNodeIds.add(actionId);
    addRelatedPages(seed, indexes.pageIdsByActionId.get(actionId));
  }

  for (const edge of navigationEdges) {
    if (edge.to.startsWith("page:")) {
      seed.relatedPageNodeIds.add(edge.to);
    }

    if (edge.from.startsWith("page:")) {
      seed.relatedPageNodeIds.add(edge.from);
    }
  }

  seed.evidence.push(
    `${navigationActionIds.length} navigation action(s) and ${navigationEdges.length} navigation edge(s) found`
  );
  seed.confidence = Math.max(seed.confidence, 0.84);
}

function createGraphIndexes(flowGraph: FlowGraph): GraphIndexes {
  const pages = flowGraph.nodes.filter((node) => node.type === "page");
  const actions = flowGraph.nodes.filter((node) => node.type === "action");
  const apis = flowGraph.nodes.filter((node) => node.type === "api");
  const forms = flowGraph.nodes.filter((node) => node.type === "form");
  const pageIdsByUrl = new Map<string, string>();
  const pageIdsByActionId = new Map<string, Set<string>>();
  const apiIdsByActionId = new Map<string, Set<string>>();

  for (const page of pages) {
    const url = page.metadata?.url;

    if (typeof url === "string") {
      pageIdsByUrl.set(url, page.id);
    }
  }

  for (const action of actions) {
    const pageUrl = action.metadata?.pageUrl;

    if (typeof pageUrl === "string") {
      const pageId = pageIdsByUrl.get(pageUrl);

      if (pageId) {
        addToSetMap(pageIdsByActionId, action.id, pageId);
      }
    }
  }

  for (const edge of flowGraph.edges) {
    if (edge.type === "action_may_trigger_api" && edge.to.startsWith("api:")) {
      addToSetMap(apiIdsByActionId, edge.from, edge.to);
    }
  }

  return { pages, actions, apis, forms, pageIdsByUrl, pageIdsByActionId, apiIdsByActionId };
}

function getOrCreateSeed(
  seeds: Map<BusinessScenarioCategory, ScenarioSeed>,
  category: BusinessScenarioCategory
): ScenarioSeed {
  const existing = seeds.get(category);

  if (existing) {
    return existing;
  }

  const seed = createSeed(category);
  seeds.set(category, seed);
  return seed;
}

function createSeed(category: BusinessScenarioCategory): ScenarioSeed {
  const definition = scenarioDefinition(category);

  return {
    category,
    name: definition.name,
    description: definition.description,
    priority: definition.priority,
    confidence: definition.confidence,
    evidence: [],
    relatedPageNodeIds: new Set(),
    relatedActionNodeIds: new Set(),
    relatedApiNodeIds: new Set(),
    dataDependencies: new Set(definition.dataDependencies),
    safetyClassification: definition.safetyClassification
  };
}

function toBusinessScenario(seed: ScenarioSeed): InferredBusinessScenario {
  const relatedPageNodeIds = Array.from(seed.relatedPageNodeIds).sort();
  const relatedActionNodeIds = Array.from(seed.relatedActionNodeIds).sort();
  const relatedApiNodeIds = Array.from(seed.relatedApiNodeIds).sort();

  return {
    scenarioId: createScenarioId(seed.category, [
      ...relatedPageNodeIds,
      ...relatedActionNodeIds,
      ...relatedApiNodeIds
    ]),
    name: createScenarioName(seed),
    description: createScenarioDescription(seed),
    category: seed.category,
    priority: seed.priority,
    confidence: roundConfidence(seed.confidence),
    source: "inferred_from_runtime_graph",
    evidence: unique(seed.evidence).slice(0, 20),
    relatedPageNodeIds,
    relatedActionNodeIds,
    relatedApiNodeIds,
    dataDependencies: Array.from(seed.dataDependencies).sort(),
    safetyClassification: seed.safetyClassification
  };
}

function createScenarioName(seed: ScenarioSeed): string {
  const label = primaryEvidenceLabel(seed.evidence);

  if (!label) {
    return seed.name;
  }

  switch (seed.category) {
    case "authentication":
      return `Authenticate user via ${label}`;
    case "registration":
      return `Register user via ${label}`;
    case "contact":
      return `Contact organization via ${label}`;
    case "bill_payment":
      return `Pay bill via ${label}`;
    case "funds_transfer":
      return `Transfer funds via ${label}`;
    case "service_integration":
      return `Inspect service integration via ${label}`;
    case "administration":
      return `Administer application via ${label}`;
    case "item_creation":
      return `Create UI item via ${label}`;
    case "item_removal":
      return `Remove UI item via ${label}`;
    case "ui_state_management":
      return `Change UI state via ${label}`;
    case "dynamic_content":
      return `Reveal dynamic content via ${label}`;
    case "modal_dialog":
      return `Use modal dialog via ${label}`;
    case "filtering_sorting":
      return `Filter or sort content via ${label}`;
    case "file_upload":
      return `Upload file via ${label}`;
    case "validation_feedback":
      return `Validate input via ${label}`;
    case "navigation":
      return seed.name;
    default:
      return `${seed.name} via ${label}`;
  }
}

function createScenarioDescription(seed: ScenarioSeed): string {
  const label = primaryEvidenceLabel(seed.evidence);

  if (!label) {
    return seed.description;
  }

  return `${seed.description} Primary runtime evidence: ${label}.`;
}

function categorizeAction(action: FlowGraphNode): BusinessScenarioCategory {
  const classification = String(action.metadata?.actionClassification ?? "unknown");
  const scope = String(action.metadata?.scope ?? "");

  if (classification === "submit") {
    if (looksLikeSelectorOnly(action.label)) {
      return "unknown";
    }

    return categorizeByVisibleIntent(action, { allowInputIntent: false }) ?? "form_submission";
  }

  const category =
    categoryFromActionClassification(classification) ??
    categorizeByVisibleIntent(action, { allowInputIntent: false }) ??
    "unknown";

  if (scope === "external" && category !== "navigation") {
    return "unknown";
  }

  return category;
}

function categoryFromApiClassification(value: string): BusinessScenarioCategory {
  switch (value) {
    case "auth":
      return "authentication";
    case "search":
      return "search";
    case "account":
      return "account_management";
    case "transfer":
      return "funds_transfer";
    case "bill_payment":
      return "bill_payment";
    case "loan":
      return "loan_application";
    case "payment":
      return "payment";
    case "cart":
      return "ecommerce_cart";
    case "checkout":
      return "checkout";
    case "admin":
      return "administration";
    case "service_definition":
      return "service_integration";
    case "content":
      return "content_browsing";
    default:
      return "unknown";
  }
}

function categoryFromActionClassification(value: string): BusinessScenarioCategory | undefined {
  switch (value) {
    case "login":
      return "authentication";
    case "logout":
      return "session_management";
    case "signup":
      return "registration";
    case "search":
      return "search";
    case "contact":
      return "contact";
    case "cart":
      return "ecommerce_cart";
    case "checkout":
      return "checkout";
    case "account_overview":
      return "account_overview";
    case "account_opening":
      return "account_opening";
    case "account_management":
      return "account_management";
    case "funds_transfer":
      return "funds_transfer";
    case "bill_payment":
      return "bill_payment";
    case "loan_application":
      return "loan_application";
    case "admin":
      return "administration";
    case "service_definition":
      return "service_integration";
    case "item_creation":
      return "item_creation";
    case "item_removal":
      return "item_removal";
    case "ui_state_management":
      return "ui_state_management";
    case "dynamic_content":
      return "dynamic_content";
    case "modal_dialog":
      return "modal_dialog";
    case "filtering_sorting":
      return "filtering_sorting";
    case "file_upload":
      return "file_upload";
    case "validation_feedback":
      return "validation_feedback";
    case "submit":
      return "form_submission";
    default:
      return undefined;
  }
}

function categorizeByVisibleIntent(
  node: FlowGraphNode,
  options: { allowInputIntent: boolean }
): BusinessScenarioCategory | undefined {
  const isPlainInput =
    typeof node.metadata?.inputType === "string" &&
    !["button", "submit", "reset"].includes(String(node.metadata.inputType));

  if (isPlainInput && !options.allowInputIntent) {
    return undefined;
  }

  const text = [
    node.label,
    node.metadata?.selector,
    node.metadata?.action,
    node.metadata?.name,
    node.metadata?.id
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/\b(log out|logout|sign out|signout)\b/.test(text)) {
    return "session_management";
  }

  if (/\b(log in|login|sign in|signin)\b/.test(text)) {
    return "authentication";
  }

  if (/\b(sign up|signup|register|create account|join (now|today)|join as|join the (program|service|platform|site|community)|membership application)\b/.test(text)) {
    return "registration";
  }

  if (/\b(search|find|autocomplete)\b/.test(text)) {
    return "search";
  }

  if (/\b(delete|remove|discard|clear item)\b/.test(text)) {
    return "item_removal";
  }

  if (/\b(add|create|new|insert)\b.*\b(item|element|row|record|entry|task|ticket|issue)\b|\b(new item|new element|new row|new record|new entry|new task|new ticket|new issue)\b/.test(text)) {
    return "item_creation";
  }

  if (/\b(show|hide|toggle|expand|collapse|open|close|reveal|more|less)\b/.test(text)) {
    return "ui_state_management";
  }

  if (/\b(dynamic|load more|refresh content)\b/.test(text)) {
    return "dynamic_content";
  }

  if (/\b(modal|dialog|popup|pop-up)\b/.test(text)) {
    return "modal_dialog";
  }

  if (/\b(filter|sort)\b/.test(text)) {
    return "filtering_sorting";
  }

  if (/\b(upload|attach file|choose file)\b/.test(text)) {
    return "file_upload";
  }

  if (/\b(validate|check|verify|invalid|required)\b/.test(text)) {
    return "validation_feedback";
  }

  if (/\b(contact|support|request demo|demo|quote|customer care)\b/.test(text)) {
    return "contact";
  }

  if (/\b(accounts? overview|account summary|account activity|account transactions?|account statements?|balances?|statements?\s+for\s+account)\b/.test(text)) {
    return "account_overview";
  }

  if (/\b(open (new )?account|new account|create account)\b/.test(text)) {
    return "account_opening";
  }

  if (/\b(update contact|profile|settings|preferences|user management)\b/.test(text)) {
    return "account_management";
  }

  if (/\b(transfer funds?|funds? transfer|wire transfer|send money|withdraw funds?)\b/.test(text)) {
    return "funds_transfer";
  }

  if (/\b(bill pay|pay bill|payee|make payment)\b/.test(text)) {
    return "bill_payment";
  }

  if (/\b(request loan|apply for loan|loan application|loanprocessor|mortgage|credit application)\b/.test(text)) {
    return "loan_application";
  }

  if (/\b(cart|basket|bag)\b/.test(text)) {
    return "ecommerce_cart";
  }

  if (/\b(checkout|place order)\b/.test(text)) {
    return "checkout";
  }

  if (/\b(payment|pay now|billing)\b/.test(text)) {
    return "payment";
  }

  if (/\b(admin|administration|configure|configuration|initialize|shutdown|clean)\b/.test(text)) {
    return "administration";
  }

  if (/\b(wsdl|wadl|openapi|swagger|api docs?|service definition)\b/.test(text)) {
    return "service_integration";
  }

  return undefined;
}

function isContentPage(page: FlowGraphNode): boolean {
  const text = `${page.label} ${String(page.metadata?.url ?? "")}`.toLowerCase();
  return /\b(docs?|documentation|intro|guide|api|community|learn|video|release|configuration|install|getting-started)\b/.test(
    text
  );
}

function scenarioDefinition(category: BusinessScenarioCategory): {
  name: string;
  description: string;
  priority: BusinessScenarioPriority;
  confidence: number;
  dataDependencies: ScenarioDataDependency[];
  safetyClassification: ScenarioSafetyClassification;
} {
  switch (category) {
    case "authentication":
      return {
        name: "Authenticate user",
        description: "User signs in or establishes an authenticated session.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_credentials"],
        safetyClassification: "safe_non_destructive"
      };
    case "session_management":
      return {
        name: "Manage user session",
        description: "User ends or changes an authenticated session.",
        priority: "critical",
        confidence: 0.68,
        dataDependencies: ["requires_credentials"],
        safetyClassification: "safe_non_destructive"
      };
    case "registration":
      return {
        name: "Register new user",
        description: "User creates a new account or starts a registration flow.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_seeded_data"],
        safetyClassification: "externally_visible"
      };
    case "search":
      return {
        name: "Search site content",
        description: "User searches for content, records, products, or documentation.",
        priority: "high",
        confidence: 0.72,
        dataDependencies: ["requires_seeded_data"],
        safetyClassification: "safe_read_only"
      };
    case "navigation":
      return {
        name: "Navigate between pages",
        description: "User follows links to move through reachable pages.",
        priority: "medium",
        confidence: 0.74,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_read_only"
      };
    case "contact":
      return {
        name: "Contact or request information",
        description: "User contacts the organization, asks for support, or requests a quote/demo.",
        priority: "high",
        confidence: 0.68,
        dataDependencies: ["requires_external_system"],
        safetyClassification: "externally_visible"
      };
    case "ecommerce_cart":
      return {
        name: "Manage shopping cart",
        description: "User adds, views, or modifies cart contents.",
        priority: "high",
        confidence: 0.7,
        dataDependencies: ["requires_seeded_data"],
        safetyClassification: "safe_non_destructive"
      };
    case "checkout":
      return {
        name: "Complete checkout",
        description: "User starts or completes checkout.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_seeded_data", "requires_payment_sandbox"],
        safetyClassification: "potentially_destructive"
      };
    case "payment":
      return {
        name: "Submit payment",
        description: "User enters or submits payment information.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_payment_sandbox"],
        safetyClassification: "unsafe_without_permission"
      };
    case "funds_transfer":
      return {
        name: "Transfer funds",
        description: "User moves money, value, or balance between accounts or destinations.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_credentials", "requires_seeded_data"],
        safetyClassification: "potentially_destructive"
      };
    case "bill_payment":
      return {
        name: "Pay bill",
        description: "User pays or schedules payment to a biller, payee, or external recipient.",
        priority: "critical",
        confidence: 0.7,
        dataDependencies: ["requires_credentials", "requires_seeded_data", "requires_external_system"],
        safetyClassification: "externally_visible"
      };
    case "loan_application":
      return {
        name: "Request loan or credit",
        description: "User applies for or requests a loan, credit, financing, or underwriting decision.",
        priority: "critical",
        confidence: 0.68,
        dataDependencies: ["requires_credentials", "requires_seeded_data", "requires_external_system"],
        safetyClassification: "externally_visible"
      };
    case "account_overview":
      return {
        name: "Review account overview",
        description: "User views account balances, transactions, statements, or account activity.",
        priority: "high",
        confidence: 0.68,
        dataDependencies: ["requires_credentials", "requires_seeded_data"],
        safetyClassification: "safe_read_only"
      };
    case "account_opening":
      return {
        name: "Open account",
        description: "User creates or opens a new account, workspace, subscription, or similar owned resource.",
        priority: "critical",
        confidence: 0.68,
        dataDependencies: ["requires_credentials", "requires_seeded_data"],
        safetyClassification: "potentially_destructive"
      };
    case "account_management":
      return {
        name: "Manage account settings",
        description: "User views or updates account profile, settings, or preferences.",
        priority: "critical",
        confidence: 0.66,
        dataDependencies: ["requires_credentials", "requires_role_based_user"],
        safetyClassification: "potentially_destructive"
      };
    case "administration":
      return {
        name: "Administer application",
        description: "Privileged user configures, initializes, resets, or administers application behavior.",
        priority: "critical",
        confidence: 0.66,
        dataDependencies: ["requires_role_based_user"],
        safetyClassification: "unsafe_without_permission"
      };
    case "service_integration":
      return {
        name: "Use service integration",
        description: "User or system discovers, calls, or configures API and service integration surfaces.",
        priority: "high",
        confidence: 0.64,
        dataDependencies: ["requires_external_system"],
        safetyClassification: "safe_read_only"
      };
    case "content_browsing":
      return {
        name: "Browse content",
        description: "User reads and explores content pages discovered at runtime.",
        priority: "medium",
        confidence: 0.75,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_read_only"
      };
    case "ui_state_management":
      return {
        name: "Change UI state",
        description: "User changes visible page state such as expanding, collapsing, showing, hiding, or toggling content.",
        priority: "medium",
        confidence: 0.7,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "item_creation":
      return {
        name: "Create visible item",
        description: "User adds or creates a visible in-page item, control, row, or temporary object.",
        priority: "medium",
        confidence: 0.72,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "item_removal":
      return {
        name: "Remove visible item",
        description: "User removes a visible in-page item, control, row, or temporary object.",
        priority: "medium",
        confidence: 0.7,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "dynamic_content":
      return {
        name: "Reveal dynamic content",
        description: "User triggers client-side dynamic content to appear, refresh, or change.",
        priority: "medium",
        confidence: 0.68,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "modal_dialog":
      return {
        name: "Use modal dialog",
        description: "User opens, reviews, or closes a modal/dialog interaction.",
        priority: "medium",
        confidence: 0.68,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "filtering_sorting":
      return {
        name: "Filter or sort visible content",
        description: "User filters, sorts, or rearranges visible content.",
        priority: "medium",
        confidence: 0.68,
        dataDependencies: ["requires_seeded_data"],
        safetyClassification: "safe_read_only"
      };
    case "file_upload":
      return {
        name: "Upload file",
        description: "User attaches or uploads a file through a visible file input or upload control.",
        priority: "high",
        confidence: 0.68,
        dataDependencies: ["requires_seeded_data"],
        safetyClassification: "safe_non_destructive"
      };
    case "validation_feedback":
      return {
        name: "Validate input feedback",
        description: "User triggers validation and reviews resulting feedback.",
        priority: "medium",
        confidence: 0.66,
        dataDependencies: ["none_detected"],
        safetyClassification: "safe_non_destructive"
      };
    case "form_submission":
      return {
        name: "Submit business form",
        description: "User fills and submits a visible form with business intent.",
        priority: "critical",
        confidence: 0.66,
        dataDependencies: ["unknown"],
        safetyClassification: "safe_non_destructive"
      };
    default:
      return {
        name: "Unknown user flow",
        description: "Runtime graph contains behavior that did not match deterministic scenario rules.",
        priority: "low",
        confidence: 0.45,
        dataDependencies: ["unknown"],
        safetyClassification: "unsafe_without_permission"
      };
  }
}

function addRelatedPages(seed: ScenarioSeed, pageIds: Set<string> | undefined): void {
  for (const pageId of pageIds ?? []) {
    seed.relatedPageNodeIds.add(pageId);
  }
}

function pageIdsForNode(node: FlowGraphNode, indexes: GraphIndexes): Set<string> | undefined {
  const pageUrl = node.metadata?.pageUrl;

  if (typeof pageUrl !== "string") {
    return undefined;
  }

  const pageId = indexes.pageIdsByUrl.get(pageUrl);
  return pageId ? new Set([pageId]) : undefined;
}

function addRelatedApis(seed: ScenarioSeed, apiIds: Set<string> | undefined): void {
  for (const apiId of apiIds ?? []) {
    seed.relatedApiNodeIds.add(apiId);
  }
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function stringifyMetadata(node: FlowGraphNode): string {
  return JSON.stringify(node.metadata ?? {});
}

function looksLikeSelectorOnly(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.includes(">") ||
    trimmed.includes(":nth-") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(".") ||
    trimmed.startsWith("[")
  );
}

function primaryEvidenceLabel(evidence: string[]): string | undefined {
  for (const item of evidence) {
    const match = item.match(/(?:Action|Form|API) "([^"]+)"/);

    if (match?.[1] && !match[1].startsWith("role=")) {
      return match[1];
    }
  }

  return undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function createScenarioId(category: BusinessScenarioCategory, relatedIds: string[]): string {
  const hash = createHash("sha1")
    .update(`${category}:${relatedIds.join("|")}`)
    .digest("hex")
    .slice(0, 8);

  return `scenario:${category}:${hash}`;
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function priorityRank(priority: BusinessScenarioPriority): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}

function roundConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

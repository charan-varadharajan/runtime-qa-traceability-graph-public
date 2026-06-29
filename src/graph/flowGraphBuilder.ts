/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { createHash } from "node:crypto";
import type {
  ApiClassification,
  BasicActionClassification,
  CapturedNetworkCall,
  CrawlResult,
  DomInventory,
  DomInventoryButton,
  DomInventoryInput,
  DomInventoryLink,
  FlowGraph,
  FlowGraphEdge,
  FlowGraphEdgeType,
  FlowGraphNode,
  FlowGraphNodeType,
  InteractionDiscoveredAction,
  InteractionInventory,
  InteractionNetworkCall,
  InteractionObservation,
  NetworkInventory
} from "../types/index.js";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface BuildFlowGraphOptions {
  crawlResult: CrawlResult;
  domInventory: DomInventory;
  interactionInventory?: InteractionInventory;
  networkInventory: NetworkInventory;
  sources: {
    crawlResultPath: string;
    domInventoryPath: string;
    interactionInventoryPath?: string;
    networkInventoryPath: string;
  };
}

interface GraphDraft {
  nodes: Map<string, FlowGraphNode>;
  edges: Map<string, FlowGraphEdge>;
}

interface PageIndexes {
  pageIdsByUrl: Map<string, string>;
  crawledUrls: Set<string>;
}

export function buildFlowGraph(options: BuildFlowGraphOptions): FlowGraph {
  const startedAt = new Date().toISOString();
  const draft: GraphDraft = {
    nodes: new Map(),
    edges: new Map()
  };
  const indexes = createPageNodes(draft, options.crawlResult);
  const actionIdsByClassification = new Map<BasicActionClassification, string[]>();
  const apiIdsByClassification = new Map<ApiClassification, string[]>();

  createDomNodesAndEdges(draft, options.domInventory, indexes, actionIdsByClassification);
  createInteractionNodesAndEdges(draft, options.interactionInventory, indexes, actionIdsByClassification);
  createApiNodesAndEdges(draft, options.networkInventory, indexes, apiIdsByClassification);
  createServiceDefinitionApiNodes(draft, options.crawlResult, indexes, apiIdsByClassification);
  createCrawlNavigationEdges(draft, options.crawlResult, indexes);
  createHeuristicActionApiEdges(draft, actionIdsByClassification, apiIdsByClassification);

  const completedAt = new Date().toISOString();
  const nodes = sortNodes(Array.from(draft.nodes.values()));
  const edges = sortEdges(Array.from(draft.edges.values()));

  return {
    generatedAt: completedAt,
    sources: options.sources,
    nodes,
    edges,
    summary: {
      pageCount: nodes.filter((node) => node.type === "page").length,
      actionCount: nodes.filter((node) => node.type === "action").length,
      apiCount: nodes.filter((node) => node.type === "api").length,
      formCount: nodes.filter((node) => node.type === "form").length,
      messageCount: nodes.filter((node) => node.type === "message").length,
      inferredEdgeCount: edges.length,
      lowConfidenceEdgeCount: edges.filter((edge) => edge.confidence < LOW_CONFIDENCE_THRESHOLD).length,
      startedAt,
      completedAt
    }
  };
}

function createInteractionNodesAndEdges(
  draft: GraphDraft,
  interactionInventory: InteractionInventory | undefined,
  indexes: PageIndexes,
  actionIdsByClassification: Map<BasicActionClassification, string[]>
): void {
  if (!interactionInventory) {
    return;
  }

  for (const page of interactionInventory.pages) {
    const pageId = indexes.pageIdsByUrl.get(page.url);

    if (!pageId) {
      continue;
    }

    for (const interaction of page.interactions) {
      if (!interaction.clicked) {
        continue;
      }

      const sourceActionId =
        findActionNodeId(draft, page.url, interaction.actionSelector, interaction.actionLabel) ??
        createInteractionActionNode(draft, page.url, {
          label: interaction.actionLabel,
          selector: interaction.actionSelector,
          actionClassification: interaction.actionClassification
        });

      addActionIndex(actionIdsByClassification, interaction.actionClassification, sourceActionId);
      addEdge(draft, {
        from: pageId,
        to: sourceActionId,
        type: "page_has_action",
        confidence: 0.88,
        evidence: [`Safe interaction candidate on ${page.url}`, `Selector: ${interaction.actionSelector}`]
      });

      mergeInteractionMetadata(draft, sourceActionId, interaction);

      for (const addedAction of interaction.addedActions) {
        const addedActionId = createInteractionActionNode(draft, page.url, addedAction, sourceActionId);
        addActionIndex(actionIdsByClassification, addedAction.actionClassification, addedActionId);
        addEdge(draft, {
          from: sourceActionId,
          to: addedActionId,
          type: "action_reveals_action",
          confidence: 0.9,
          evidence: [
            `Clicking "${interaction.actionLabel}" revealed "${addedAction.label}"`,
            `Revealed selector: ${addedAction.selector}`
          ]
        });
      }

      if (
        interaction.addedActions.length > 0 ||
        interaction.removedActions.length > 0 ||
        interaction.addedTexts.length > 0 ||
        interaction.removedTexts.length > 0
      ) {
        const mutationId = createDomMutationNode(draft, page.url, interaction);
        addEdge(draft, {
          from: sourceActionId,
          to: mutationId,
          type: "action_mutates_dom",
          confidence: 0.86,
          evidence: interaction.evidence.slice(0, 4)
        });
      }

      if (interaction.cleanupAction) {
        const cleanupActionId =
          findActionNodeId(
            draft,
            page.url,
            interaction.cleanupAction.actionSelector,
            interaction.cleanupAction.actionLabel
          ) ??
          createInteractionActionNode(draft, page.url, {
            label: interaction.cleanupAction.actionLabel,
            selector: interaction.cleanupAction.actionSelector,
            actionClassification: interaction.cleanupAction.actionClassification
          });
        const removedActionId = findActionNodeId(
          draft,
          page.url,
          interaction.cleanupAction.removedSelector,
          interaction.cleanupAction.actionLabel
        );

        addActionIndex(actionIdsByClassification, interaction.cleanupAction.actionClassification, cleanupActionId);
        addEdge(draft, {
          from: cleanupActionId,
          to: removedActionId ?? sourceActionId,
          type: "action_removes_element",
          confidence: 0.88,
          evidence: interaction.cleanupAction.evidence
        });
      }

      for (const call of interaction.networkCalls) {
        const apiId = createInteractionNetworkNode(draft, call);
        addEdge(draft, {
          from: sourceActionId,
          to: apiId,
          type: "action_triggers_network",
          confidence: 0.78,
          evidence: [
            `Clicking "${interaction.actionLabel}" triggered ${call.method} ${call.requestUrl}`,
            call.statusCode ? `Observed status: ${call.statusCode}` : "Status unavailable"
          ]
        });
      }
    }
  }
}

function createPageNodes(draft: GraphDraft, crawlResult: CrawlResult): PageIndexes {
  const pageIdsByUrl = new Map<string, string>();
  const crawledUrls = new Set<string>();

  for (const page of crawlResult.pages) {
    const pageId = createStableId("page", page.url);
    pageIdsByUrl.set(page.url, pageId);
    crawledUrls.add(page.url);

    addNode(draft, {
      id: pageId,
      type: "page",
      label: page.title || page.url,
      source: "crawl-result",
      confidence: page.errorMessage ? 0.65 : 0.95,
      evidence: [
        `Crawled URL: ${page.url}`,
        page.status ? `HTTP status: ${page.status}` : "HTTP status unavailable"
      ],
      metadata: {
        url: page.url,
        status: page.status,
        discoveredLinks: page.discoveredLinks.length
      }
    });
  }

  return { pageIdsByUrl, crawledUrls };
}

function createDomNodesAndEdges(
  draft: GraphDraft,
  domInventory: DomInventory,
  indexes: PageIndexes,
  actionIdsByClassification: Map<BasicActionClassification, string[]>
): void {
  for (const page of domInventory.pages) {
    const pageId = indexes.pageIdsByUrl.get(page.url);

    if (!pageId) {
      continue;
    }

    page.forms.forEach((form) => {
      const formId = createStableId("form", `${page.url}:form:${form.index}:${form.selector}`);

      addNode(draft, {
        id: formId,
        type: "form",
        label: form.name || form.id || `Form ${form.index + 1}`,
        source: "dom-inventory",
        confidence: 0.9,
        evidence: [`Visible form on ${page.url}`, `Selector: ${form.selector}`],
        metadata: {
          pageUrl: page.url,
          selector: form.selector,
          action: form.action,
          method: form.method,
          actionClassification: form.actionClassification
        }
      });

      addEdge(draft, {
        from: pageId,
        to: formId,
        type: "page_has_action",
        confidence: 0.8,
        evidence: [`Page contains form selector ${form.selector}`]
      });

      for (const input of form.inputs) {
        const inputId = createInputActionNode(draft, page.url, input, "form-input");
        addActionIndex(actionIdsByClassification, input.actionClassification, inputId);
        addEdge(draft, {
          from: formId,
          to: inputId,
          type: "form_has_input",
          confidence: 0.92,
          evidence: [`Form ${form.selector} contains input ${input.selector}`]
        });
      }

      for (const button of form.buttons) {
        const buttonId = createButtonActionNode(draft, page.url, button, "form-button");
        addActionIndex(actionIdsByClassification, button.actionClassification, buttonId);
        addEdge(draft, {
          from: pageId,
          to: buttonId,
          type: "page_has_action",
          confidence: 0.9,
          evidence: [`Visible form button selector ${button.selector}`]
        });
      }
    });

    for (const button of page.buttons) {
      const buttonId = createButtonActionNode(draft, page.url, button, "button");
      addActionIndex(actionIdsByClassification, button.actionClassification, buttonId);
      addEdge(draft, {
        from: pageId,
        to: buttonId,
        type: "page_has_action",
        confidence: 0.9,
        evidence: [`Visible button selector ${button.selector}`]
      });
    }

    for (const link of page.links) {
      const linkId = createLinkActionNode(draft, page.url, link);
      addActionIndex(actionIdsByClassification, link.actionClassification, linkId);
      addEdge(draft, {
        from: pageId,
        to: linkId,
        type: "page_has_action",
        confidence: 0.9,
        evidence: [`Visible link to ${link.href}`]
      });

      const targetPageId = indexes.pageIdsByUrl.get(link.href);

      if (targetPageId) {
        addEdge(draft, {
          from: linkId,
          to: targetPageId,
          type: "action_may_navigate_to_page",
          confidence: 0.82,
          evidence: [`Link href matches crawled page ${link.href}`]
        });
      }
    }

    for (const input of page.inputsOutsideForms) {
      const inputId = createInputActionNode(draft, page.url, input, "input");
      addActionIndex(actionIdsByClassification, input.actionClassification, inputId);
      addEdge(draft, {
        from: pageId,
        to: inputId,
        type: "page_has_action",
        confidence: 0.85,
        evidence: [`Visible input selector ${input.selector}`]
      });
    }

    for (const message of page.importantText.messageCandidates) {
      const messageId = createStableId("message", `${page.url}:${message.kind}:${message.text}`);

      addNode(draft, {
        id: messageId,
        type: "message",
        label: message.text,
        source: "dom-inventory",
        confidence: 0.72,
        evidence: [`${message.kind} message candidate on ${page.url}`, `Selector: ${message.selector}`],
        metadata: {
          pageUrl: page.url,
          kind: message.kind,
          selector: message.selector
        }
      });
    }
  }
}

function createApiNodesAndEdges(
  draft: GraphDraft,
  networkInventory: NetworkInventory,
  indexes: PageIndexes,
  apiIdsByClassification: Map<ApiClassification, string[]>
): void {
  for (const page of networkInventory.pages) {
    const pageId = indexes.pageIdsByUrl.get(page.url);

    if (!pageId) {
      continue;
    }

    for (const call of page.calls) {
      if (!call.likelyApiCall) {
        continue;
      }

      const apiId = createApiNode(draft, call);
      addApiIndex(apiIdsByClassification, call.apiClassification, apiId);
      addEdge(draft, {
        from: pageId,
        to: apiId,
        type: "page_calls_api",
        confidence: 0.88,
        evidence: [
          `${call.method} ${call.requestUrl}`,
          `Indicators: ${call.apiIndicators.join(", ") || "none"}`
        ]
      });
    }
  }
}

function createServiceDefinitionApiNodes(
  draft: GraphDraft,
  crawlResult: CrawlResult,
  indexes: PageIndexes,
  apiIdsByClassification: Map<ApiClassification, string[]>
): void {
  for (const page of crawlResult.pages) {
    if (!isServiceDefinitionUrl(page.url)) {
      continue;
    }

    const pageId = indexes.pageIdsByUrl.get(page.url);
    const apiId = createStableId("api", `service-definition:${page.url}`);

    addNode(draft, {
      id: apiId,
      type: "api",
      label: `Service definition ${formatUrlPath(page.url)}`,
      source: "crawl-result",
      confidence: 0.82,
      evidence: [`Crawled service definition URL: ${page.url}`],
      metadata: {
        requestUrl: page.url,
        method: "GET",
        statusCode: page.status,
        apiClassification: "service_definition",
        apiIndicators: ["service-definition-url"]
      }
    });

    addApiIndex(apiIdsByClassification, "service_definition", apiId);

    if (pageId) {
      addEdge(draft, {
        from: pageId,
        to: apiId,
        type: "page_calls_api",
        confidence: 0.72,
        evidence: [`Crawled page represents a service definition: ${page.url}`]
      });
    }
  }
}

function createCrawlNavigationEdges(
  draft: GraphDraft,
  crawlResult: CrawlResult,
  indexes: PageIndexes
): void {
  for (const page of crawlResult.pages) {
    const fromPageId = indexes.pageIdsByUrl.get(page.url);

    if (!fromPageId) {
      continue;
    }

    for (const discoveredLink of page.discoveredLinks) {
      const toPageId = indexes.pageIdsByUrl.get(discoveredLink);

      if (!toPageId || toPageId === fromPageId) {
        continue;
      }

      addEdge(draft, {
        from: fromPageId,
        to: toPageId,
        type: "page_links_to_page",
        confidence: 0.86,
        evidence: [`Crawler found same-origin link ${discoveredLink}`]
      });
    }
  }
}

function createHeuristicActionApiEdges(
  draft: GraphDraft,
  actionIdsByClassification: Map<BasicActionClassification, string[]>,
  apiIdsByClassification: Map<ApiClassification, string[]>
): void {
  const mappings: Array<{
    action: BasicActionClassification;
    apiClassifications: ApiClassification[];
    confidence: number;
  }> = [
    { action: "login", apiClassifications: ["auth"], confidence: 0.64 },
    { action: "signup", apiClassifications: ["auth"], confidence: 0.62 },
    { action: "search", apiClassifications: ["search", "content"], confidence: 0.62 },
    { action: "cart", apiClassifications: ["cart"], confidence: 0.64 },
    { action: "checkout", apiClassifications: ["checkout"], confidence: 0.64 }
  ];

  for (const mapping of mappings) {
    const actionIds = actionIdsByClassification.get(mapping.action) ?? [];
    const apiIds = mapping.apiClassifications.flatMap(
      (apiClassification) => apiIdsByClassification.get(apiClassification) ?? []
    );

    for (const actionId of actionIds) {
      for (const apiId of apiIds) {
        addEdge(draft, {
          from: actionId,
          to: apiId,
          type: "action_may_trigger_api",
          confidence: mapping.confidence,
          evidence: [
            `Heuristic mapping: ${mapping.action} action may trigger ${mapping.apiClassifications.join(
              "/"
            )} API`
          ]
        });
      }
    }
  }
}

function createButtonActionNode(
  draft: GraphDraft,
  pageUrl: string,
  button: DomInventoryButton,
  sourceKind: string
): string {
  const label = button.text || button.ariaLabel || button.selector;
  const id = createStableId("action", `${pageUrl}:${sourceKind}:${button.selector}:${label}`);

  addNode(draft, {
    id,
    type: "action",
    label,
    source: "dom-inventory",
    confidence: button.disabled ? 0.72 : 0.9,
    evidence: [`Visible ${sourceKind} on ${pageUrl}`, `Selector: ${button.selector}`],
    metadata: {
      pageUrl,
      selector: button.selector,
      role: button.role,
      disabled: button.disabled,
      actionClassification: button.actionClassification
    }
  });

  return id;
}

function createLinkActionNode(draft: GraphDraft, pageUrl: string, link: DomInventoryLink): string {
  const label = link.text || link.href;
  const id = createStableId("action", `${pageUrl}:link:${link.href}`);

  addNode(draft, {
    id,
    type: "action",
    label,
    source: "dom-inventory",
    confidence: link.scope === "internal" ? 0.92 : 0.82,
    evidence: [`Visible ${link.scope} link on ${pageUrl}`, `Href: ${link.href}`],
    metadata: {
      pageUrl,
      selector: link.selector,
      href: link.href,
      scope: link.scope,
      actionClassification: link.actionClassification
    }
  });

  return id;
}

function createInputActionNode(
  draft: GraphDraft,
  pageUrl: string,
  input: DomInventoryInput,
  sourceKind: string
): string {
  const label = input.label || input.placeholder || input.name || input.id || input.selector;
  const id = createStableId("action", `${pageUrl}:${sourceKind}:${input.selector}:${label}`);

  addNode(draft, {
    id,
    type: "action",
    label,
    source: "dom-inventory",
    confidence: 0.86,
    evidence: [`Visible ${sourceKind} on ${pageUrl}`, `Selector: ${input.selector}`],
    metadata: {
      pageUrl,
      selector: input.selector,
      inputType: input.type,
      name: input.name,
      id: input.id,
      required: input.required,
      actionClassification: input.actionClassification
    }
  });

  return id;
}

function createInteractionActionNode(
  draft: GraphDraft,
  pageUrl: string,
  action: Pick<InteractionDiscoveredAction, "label" | "selector" | "role" | "actionClassification">,
  revealedByActionId?: string
): string {
  const id = createStableId("action", `${pageUrl}:interaction:${action.selector}:${action.label}`);

  addNode(draft, {
    id,
    type: "action",
    label: action.label || action.selector,
    source: "interaction-inventory",
    confidence: 0.84,
    evidence: [`Dynamic action observed on ${pageUrl}`, `Selector: ${action.selector}`],
    metadata: {
      pageUrl,
      selector: action.selector,
      role: action.role,
      actionClassification: action.actionClassification,
      dynamic: true,
      revealedByActionId
    }
  });

  return id;
}

function createDomMutationNode(
  draft: GraphDraft,
  pageUrl: string,
  interaction: InteractionObservation
): string {
  const label = `DOM change after ${interaction.actionLabel}`;
  const id = createStableId(
    "message",
    `${pageUrl}:interaction-mutation:${interaction.actionSelector}:${interaction.addedActions
      .map((action) => action.label)
      .join("|")}:${interaction.addedTexts.join("|")}`
  );

  addNode(draft, {
    id,
    type: "message",
    label,
    source: "interaction-inventory",
    confidence: 0.82,
    evidence: interaction.evidence,
    metadata: {
      pageUrl,
      kind: "dom_mutation",
      actionSelector: interaction.actionSelector,
      addedActions: interaction.addedActions,
      removedActions: interaction.removedActions,
      addedTexts: interaction.addedTexts,
      removedTexts: interaction.removedTexts
    }
  });

  return id;
}

function findActionNodeId(
  draft: GraphDraft,
  pageUrl: string,
  selector: string,
  label: string
): string | undefined {
  const normalizedLabel = label.trim().toLowerCase();

  for (const node of draft.nodes.values()) {
    if (node.type !== "action") {
      continue;
    }

    if (node.metadata?.pageUrl !== pageUrl) {
      continue;
    }

    if (node.metadata?.selector === selector) {
      return node.id;
    }

    if (node.label.trim().toLowerCase() === normalizedLabel && normalizedLabel) {
      return node.id;
    }
  }

  return undefined;
}

function mergeInteractionMetadata(
  draft: GraphDraft,
  sourceActionId: string,
  interaction: InteractionObservation
): void {
  const node = draft.nodes.get(sourceActionId);

  if (!node) {
    return;
  }

  const metadata = node.metadata ?? {};
  node.metadata = {
    ...metadata,
    interactionEffects: {
      revealedActions: interaction.addedActions,
      removedActions: interaction.removedActions,
      addedTexts: interaction.addedTexts,
      removedTexts: interaction.removedTexts,
      cleanupAction: interaction.cleanupAction,
      staticHints: interaction.staticHints
    }
  };
  node.evidence = unique([...node.evidence, ...interaction.evidence]);
}

function createApiNode(draft: GraphDraft, call: CapturedNetworkCall): string {
  const id = createStableId("api", `${call.method}:${call.requestUrl}`);
  const label = `${call.method} ${formatUrlPath(call.requestUrl)}`;

  addNode(draft, {
    id,
    type: "api",
    label,
    source: "network-inventory",
    confidence: call.likelyApiCall ? 0.9 : 0.65,
    evidence: [
      `${call.method} ${call.requestUrl}`,
      `Resource type: ${call.resourceType}`,
      `Indicators: ${call.apiIndicators.join(", ")}`
    ],
    metadata: {
      requestUrl: call.requestUrl,
      method: call.method,
      resourceType: call.resourceType,
      statusCode: call.statusCode,
      responseContentType: call.responseContentType,
      apiClassification: call.apiClassification,
      apiIndicators: call.apiIndicators
    }
  });

  return id;
}

function createInteractionNetworkNode(draft: GraphDraft, call: InteractionNetworkCall): string {
  const id = createStableId("api", `interaction:${call.method}:${call.requestUrl}`);
  const label = `${call.method} ${formatUrlPath(call.requestUrl)}`;

  addNode(draft, {
    id,
    type: "api",
    label,
    source: "interaction-inventory",
    confidence: 0.74,
    evidence: [
      `${call.method} ${call.requestUrl}`,
      `Resource type: ${call.resourceType}`,
      call.statusCode ? `Status: ${call.statusCode}` : "Status unavailable"
    ],
    metadata: {
      requestUrl: call.requestUrl,
      method: call.method,
      resourceType: call.resourceType,
      statusCode: call.statusCode,
      apiClassification: "unknown",
      apiIndicators: ["triggered-by-safe-interaction"]
    }
  });

  return id;
}

function addActionIndex(
  index: Map<BasicActionClassification, string[]>,
  classification: BasicActionClassification,
  actionId: string
): void {
  const existing = index.get(classification) ?? [];

  if (!existing.includes(actionId)) {
    existing.push(actionId);
    index.set(classification, existing);
  }
}

function addApiIndex(
  index: Map<ApiClassification, string[]>,
  classification: ApiClassification,
  apiId: string
): void {
  const existing = index.get(classification) ?? [];

  if (!existing.includes(apiId)) {
    existing.push(apiId);
    index.set(classification, existing);
  }
}

function addNode(draft: GraphDraft, node: FlowGraphNode): void {
  if (!draft.nodes.has(node.id)) {
    draft.nodes.set(node.id, node);
  }
}

function addEdge(draft: GraphDraft, edge: FlowGraphEdge): void {
  const key = `${edge.from}:${edge.type}:${edge.to}`;

  if (!draft.edges.has(key)) {
    draft.edges.set(key, edge);
  }
}

function createStableId(type: FlowGraphNodeType, value: string): string {
  const slug = slugify(value).slice(0, 48) || type;
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 8);

  return `${type}:${slug}:${hash}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatUrlPath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function isServiceDefinitionUrl(value: string): boolean {
  const normalized = value.toLowerCase();
  return /\b(wsdl|wadl|openapi|swagger|api-docs?)\b|[?&]_?wadl\b/.test(normalized);
}

function sortNodes(nodes: FlowGraphNode[]): FlowGraphNode[] {
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

function sortEdges(edges: FlowGraphEdge[]): FlowGraphEdge[] {
  return edges.sort((a, b) => {
    const typeComparison = a.type.localeCompare(b.type);

    if (typeComparison !== 0) {
      return typeComparison;
    }

    const fromComparison = a.from.localeCompare(b.from);
    return fromComparison !== 0 ? fromComparison : a.to.localeCompare(b.to);
  });
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

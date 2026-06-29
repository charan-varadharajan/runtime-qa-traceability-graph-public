/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import path from "node:path";
import type {
  BusinessScenarioInventory,
  CapturedNetworkCall,
  FlowGraph,
  FlowGraphNode,
  GeneratedApiTest,
  GeneratedApiTestIndex,
  NetworkInventory
} from "../types/index.js";

export interface GenerateApiSmokeTestsOptions {
  networkInventory: NetworkInventory;
  flowGraph: FlowGraph;
  businessScenarios: BusinessScenarioInventory;
  outputDirectory: string;
  sourceNetworkInventoryPath: string;
  sourceFlowGraphPath: string;
  sourceBusinessScenariosPath: string;
}

export interface GeneratedApiSmokeScript {
  filePath: string;
  content: string;
}

export interface GenerateApiSmokeTestsResult {
  index: GeneratedApiTestIndex;
  scripts: GeneratedApiSmokeScript[];
}

interface ApiSmokeContext {
  call: CapturedNetworkCall;
  apiNode?: FlowGraphNode;
  relatedScenarioIds: string[];
  filePath: string;
  title: string;
  redactedUrl: string;
  executableByDefault: boolean;
  skipReason?: string;
  requiredEnvVars: string[];
  expectedContentType?: string;
  expectsJson: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SENSITIVE_QUERY_KEY_PATTERN = /authorization|cookie|token|password|secret|api[-_]?key|apikey|session/i;
const AUTH_REQUIRED_CLASSIFICATIONS = new Set([
  "account",
  "admin",
  "auth",
  "bill_payment",
  "checkout",
  "loan",
  "payment",
  "transfer"
]);

export function generateApiSmokeTests(
  options: GenerateApiSmokeTestsOptions
): GenerateApiSmokeTestsResult {
  const startedAt = new Date().toISOString();
  const apiNodes = options.flowGraph.nodes.filter((node) => node.type === "api");
  const likelyCalls = uniqueApiCalls(
    options.networkInventory.pages
      .flatMap((page) => page.calls)
      .filter((call) => call.likelyApiCall)
      .filter(isApiSmokeCandidate)
  );
  const scripts: GeneratedApiSmokeScript[] = [];
  const tests: GeneratedApiTest[] = [];

  for (const call of likelyCalls) {
    const apiNode = findApiNode(call, apiNodes);
    const relatedScenarioIds = apiNode
      ? relatedScenariosForApiNode(apiNode.id, options.businessScenarios)
      : [];
    const context = createApiSmokeContext(call, apiNode, relatedScenarioIds, options.outputDirectory);

    scripts.push({
      filePath: context.filePath,
      content: createApiSpecContent(context)
    });

    tests.push({
      apiNodeId: apiNode?.id,
      relatedScenarioIds,
      filePath: context.filePath,
      title: context.title,
      method: call.method.toUpperCase(),
      redactedUrl: context.redactedUrl,
      expectedContentType: context.expectedContentType,
      executableByDefault: context.executableByDefault,
      skipReason: context.skipReason,
      requiredEnvVars: context.requiredEnvVars
    });
  }

  const completedAt = new Date().toISOString();

  return {
    scripts,
    index: {
      sourceNetworkInventoryPath: options.sourceNetworkInventoryPath,
      sourceFlowGraphPath: options.sourceFlowGraphPath,
      sourceBusinessScenariosPath: options.sourceBusinessScenariosPath,
      generatedAt: completedAt,
      outputDirectory: options.outputDirectory,
      tests,
      summary: {
        generatedTestCount: tests.length,
        executableByDefaultCount: tests.filter((test) => test.executableByDefault).length,
        skippedByDefaultCount: tests.filter((test) => !test.executableByDefault).length,
        byMethod: countBy(tests, (test) => test.method),
        byRelatedScenario: countBy(
          tests.flatMap((test) =>
            test.relatedScenarioIds.length > 0 ? test.relatedScenarioIds : ["none"]
          ),
          (scenarioId) => scenarioId
        ),
        startedAt,
        completedAt
      }
    }
  };
}

function createApiSmokeContext(
  call: CapturedNetworkCall,
  apiNode: FlowGraphNode | undefined,
  relatedScenarioIds: string[],
  outputDirectory: string
): ApiSmokeContext {
  const method = call.method.toUpperCase();
  const redactedUrl = redactUrl(call.requestUrl);
  const expectedContentType = normalizedContentType(call.responseContentType);
  const authRequired = isAuthRequired(call);
  const unsafeMethod = !SAFE_METHODS.has(method);
  const skipReason = unsafeMethod
    ? `${method} is not executed by generated API smoke tests because it may mutate server state.`
    : authRequired
      ? "Authentication appears to be required; set RQATG_API_AUTH_HEADER to run this sandbox smoke test."
      : undefined;
  const requiredEnvVars = authRequired ? ["RQATG_API_AUTH_HEADER"] : [];
  const title = `${method} ${formatUrlForTitle(redactedUrl)}`;

  return {
    call,
    apiNode,
    relatedScenarioIds,
    filePath: path.join(outputDirectory, `${slugify(`${method}-${redactedUrl}`)}.spec.ts`),
    title,
    redactedUrl,
    executableByDefault: !skipReason,
    skipReason,
    requiredEnvVars,
    expectedContentType,
    expectsJson: Boolean(expectedContentType?.includes("json"))
  };
}

function createApiSpecContent(context: ApiSmokeContext): string {
  const method = context.call.method.toUpperCase();
  const timeoutMsExpression = "Number(process.env.RQATG_API_RESPONSE_THRESHOLD_MS ?? 5000)";
  const headersBlock = context.requiredEnvVars.includes("RQATG_API_AUTH_HEADER")
    ? [
        "    const headers: Record<string, string> = {};",
        "    if (process.env.RQATG_API_AUTH_HEADER) {",
        "      headers.Authorization = process.env.RQATG_API_AUTH_HEADER;",
        "    }"
      ].join("\n")
    : "    const headers: Record<string, string> = {};";
  const contentTypeAssertion = context.expectedContentType
    ? `    expect(contentType.toLowerCase()).toContain(${JSON.stringify(context.expectedContentType)});`
    : "    // No stable content-type was observed; content-type assertion is intentionally skipped.";
  const jsonAssertion = context.expectsJson
    ? [
        "    let jsonParseError: unknown;",
        "    try {",
        "      await response.json();",
        "    } catch (error) {",
        "      jsonParseError = error;",
        "    }",
        "    expect(jsonParseError).toBeUndefined();"
      ].join("\n")
    : "    // Response was not observed as JSON; JSON parse assertion is intentionally skipped.";
  const skipLine = context.skipReason
    ? `  test.skip(true, ${JSON.stringify(context.skipReason)});`
    : "";

  return `import { test, expect } from "@playwright/test";

test.describe("Generated API smoke tests", () => {
${skipLine}
  test(${JSON.stringify(context.title)}, async ({ request }) => {
    // apiNodeId: ${commentSafe(context.apiNode?.id ?? "unmatched")}
    // relatedScenarioIds: ${commentSafe(context.relatedScenarioIds.join(", ") || "none")}
    // sourceMethod: ${method}
    // sourceUrl: ${commentSafe(context.redactedUrl)}

    const thresholdMs = ${timeoutMsExpression};
${headersBlock}

    const startedAt = Date.now();
    const response = await request.fetch(${JSON.stringify(context.redactedUrl)}, {
      method: ${JSON.stringify(method)},
      headers
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.status(), "API smoke response should not be a server error").toBeLessThan(500);
    expect(elapsedMs, "API smoke response time should stay under configured threshold").toBeLessThan(thresholdMs);

    const contentType = response.headers()["content-type"] ?? "";
${contentTypeAssertion}
${jsonAssertion}
  });
});
`;
}

function uniqueApiCalls(calls: CapturedNetworkCall[]): CapturedNetworkCall[] {
  const seen = new Set<string>();
  const unique: CapturedNetworkCall[] = [];

  for (const call of calls) {
    const key = `${call.method.toUpperCase()} ${call.requestUrl}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(call);
    }
  }

  return unique;
}

function isApiSmokeCandidate(call: CapturedNetworkCall): boolean {
  const url = call.requestUrl.toLowerCase();
  const indicators = call.apiIndicators.join(" ").toLowerCase();

  if (call.apiClassification === "analytics") {
    return false;
  }

  if (
    /\b(analytics|telemetry|beacon|metrics|pixel|tracking|optimizely|googletagmanager|google-analytics|doubleclick|hotjar|segment|sentry)\b/.test(
      `${url} ${indicators}`
    )
  ) {
    return false;
  }

  return true;
}

function findApiNode(call: CapturedNetworkCall, apiNodes: FlowGraphNode[]): FlowGraphNode | undefined {
  const method = call.method.toUpperCase();

  return apiNodes.find(
    (node) =>
      getString(node.metadata?.requestUrl) === call.requestUrl &&
      getString(node.metadata?.method)?.toUpperCase() === method
  );
}

function relatedScenariosForApiNode(apiNodeId: string, businessScenarios: BusinessScenarioInventory): string[] {
  return businessScenarios.scenarios
    .filter((scenario) => scenario.relatedApiNodeIds.includes(apiNodeId))
    .map((scenario) => scenario.scenarioId);
}

function isAuthRequired(call: CapturedNetworkCall): boolean {
  const statusCode = call.statusCode ?? 0;
  const url = call.requestUrl.toLowerCase();

  return (
    statusCode === 401 ||
    statusCode === 403 ||
    AUTH_REQUIRED_CLASSIFICATIONS.has(call.apiClassification) ||
    /\/(account|admin|auth|login|logout|payment|transfer|checkout)\b/.test(url)
  );
}

function normalizedContentType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.split(";")[0]?.trim().toLowerCase() || undefined;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }

    return url.toString();
  } catch {
    return value.replace(/([?&][^=]*(?:token|password|secret|api[-_]?key|session)[^=]*=)[^&]*/gi, "$1REDACTED");
  }
}

function formatUrlForTitle(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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

function commentSafe(value: string): string {
  return value.replace(/\*\//g, "* /").replace(/\r?\n/g, " ");
}

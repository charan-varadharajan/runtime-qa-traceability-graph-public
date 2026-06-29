#!/usr/bin/env node
/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAutomationFeasibility } from "../automation/automationFeasibilityClassifier.js";
import { crawlSite } from "../crawler/siteCrawler.js";
import { extractDomInventory } from "../extractors/domExtractor.js";
import { generateApiSmokeTests } from "../generation/apiSmokeTestGenerator.js";
import { generatePlaywrightScripts } from "../generation/playwrightScriptGenerator.js";
import { buildFlowGraph } from "../graph/flowGraphBuilder.js";
import { discoverInteractions } from "../interactions/interactionDiscovery.js";
import { captureNetworkInventory } from "../network/networkCapture.js";
import { generateCrossOriginDependencies } from "../reporting/crossOriginDependencies.js";
import { buildQATraceability } from "../reporting/qaTraceabilityBuilder.js";
import { inferBusinessScenarios } from "../scenarios/businessScenarioInferer.js";
import { generateManualTestCases } from "../testcases/manualTestCaseGenerator.js";
import type { AnalysisRun } from "../types/index.js";

const OUTPUT_DIR = "output";
const RUN_METADATA_FILE = "run-metadata.json";
const CRAWL_RESULT_FILE = "crawl-result.json";
const DOM_INVENTORY_FILE = "dom-inventory.json";
const INTERACTION_INVENTORY_FILE = "interaction-inventory.json";
const NETWORK_INVENTORY_FILE = "network-inventory.json";
const FLOW_GRAPH_FILE = "flow-graph.json";
const BUSINESS_SCENARIOS_FILE = "business-scenarios.json";
const MANUAL_TEST_CASES_FILE = "manual-test-cases.json";
const AUTOMATION_FEASIBILITY_FILE = "automation-feasibility.json";
const GENERATED_AUTOMATION_INDEX_FILE = "generated-automation-index.json";
const GENERATED_API_TEST_INDEX_FILE = "generated-api-test-index.json";
const QA_TRACEABILITY_FILE = "qa-traceability.json";
const HTML_REPORT_FILE = "report.html";
const CROSS_ORIGIN_DEPENDENCIES_FILE = "cross-origin-dependencies.json";
const GENERATED_UI_TEST_DIR = path.join("generated-tests", "ui");
const GENERATED_API_TEST_DIR = path.join("generated-tests", "api");
const DEFAULT_MAX_PAGES = 20;

interface CliOptions {
  url?: string;
  maxPages: number;
  headed: boolean;
  userName?: string;
  password?: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  return {
    url: parseStringArg(argv, "--url"),
    maxPages: parseMaxPages(parseStringArg(argv, "--maxPages")),
    headed: argv.includes("--headed"),
    userName: parseStringArg(argv, "--userName"),
    password: parseStringArg(argv, "--password")
  };
}

function parseStringArg(argv: string[], flag: string): string | undefined {
  const flagIndex = argv.indexOf(flag);

  if (flagIndex >= 0) {
    return argv[flagIndex + 1];
  }

  const inlineArg = argv.find((arg) => arg.startsWith(`${flag}=`));
  return inlineArg?.slice(`${flag}=`.length);
}

function parseMaxPages(value: string | undefined): number {
  if (!value) {
    return DEFAULT_MAX_PAGES;
  }

  const maxPages = Number(value);

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("--maxPages must be a positive integer.");
  }

  return maxPages;
}

function validateWebsiteUrl(value: string | undefined): URL {
  if (!value) {
    throw new Error("Missing required argument: --url <website-url>");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https.");
  }

  return url;
}

function createAnalysisRun(url: URL): AnalysisRun {
  const now = new Date().toISOString();

  return {
    id: `run-${Date.now()}`,
    targetUrl: url.toString(),
    status: "initialized",
    createdAt: now,
    updatedAt: now,
    artifacts: {
      metadataPath: path.join(OUTPUT_DIR, RUN_METADATA_FILE),
      crawlOutputPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE),
      domInventoryPath: path.join(OUTPUT_DIR, DOM_INVENTORY_FILE),
      interactionInventoryPath: path.join(OUTPUT_DIR, INTERACTION_INVENTORY_FILE),
      networkInventoryPath: path.join(OUTPUT_DIR, NETWORK_INVENTORY_FILE),
      flowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE),
      scenariosPath: path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE),
      manualTestCasesPath: path.join(OUTPUT_DIR, MANUAL_TEST_CASES_FILE),
      automationFeasibilityPath: path.join(OUTPUT_DIR, AUTOMATION_FEASIBILITY_FILE),
      automationScriptsPath: GENERATED_UI_TEST_DIR,
      generatedAutomationIndexPath: path.join(OUTPUT_DIR, GENERATED_AUTOMATION_INDEX_FILE),
      apiSmokeTestsPath: GENERATED_API_TEST_DIR,
      generatedApiTestIndexPath: path.join(OUTPUT_DIR, GENERATED_API_TEST_INDEX_FILE),
      traceabilityPath: path.join(OUTPUT_DIR, QA_TRACEABILITY_FILE),
      htmlReportPath: path.join(OUTPUT_DIR, HTML_REPORT_FILE),
      crossOriginDependenciesPath: path.join(OUTPUT_DIR, CROSS_ORIGIN_DEPENDENCIES_FILE)
    }
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const url = validateWebsiteUrl(options.url);
  const run = createAnalysisRun(url);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeJsonFile(path.join(OUTPUT_DIR, RUN_METADATA_FILE), run);

  console.log(`Analysis run initialized for ${run.targetUrl}`);
  console.log(`Crawling up to ${options.maxPages} same-origin page(s)...`);

  run.status = "crawling";
  run.updatedAt = new Date().toISOString();
  await writeJsonFile(path.join(OUTPUT_DIR, RUN_METADATA_FILE), run);

  try {
    const crawlResult = await crawlSite({
      startUrl: url,
      maxPages: options.maxPages,
      headed: options.headed,
      credentials:
        options.userName && options.password
          ? { userName: options.userName, password: options.password }
          : undefined
    });

    await writeJsonFile(path.join(OUTPUT_DIR, CRAWL_RESULT_FILE), crawlResult);

    const crossOriginDependencies = generateCrossOriginDependencies({
      crawlResult,
      sourceCrawlPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE)
    });

    await writeJsonFile(
      path.join(OUTPUT_DIR, CROSS_ORIGIN_DEPENDENCIES_FILE),
      crossOriginDependencies
    );

    run.status = "extracting";
    run.updatedAt = new Date().toISOString();
    run.crawlSummary = crawlResult.summary;
    run.crossOriginDependencySummary = crossOriginDependencies.summary;
    run.authSession = crawlResult.authSession;
    await writeJsonFile(path.join(OUTPUT_DIR, RUN_METADATA_FILE), run);

    console.log("Extracting visible DOM action inventory...");

    const domInventory = await extractDomInventory({
      crawlResult,
      sourceCrawlPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE),
      headed: options.headed
    });

    await writeJsonFile(path.join(OUTPUT_DIR, DOM_INVENTORY_FILE), domInventory);

    console.log("Discovering safe dynamic interactions...");

    const interactionInventory = await discoverInteractions({
      crawlResult,
      domInventory,
      sourceCrawlPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE),
      sourceDomInventoryPath: path.join(OUTPUT_DIR, DOM_INVENTORY_FILE),
      headed: options.headed
    });

    await writeJsonFile(path.join(OUTPUT_DIR, INTERACTION_INVENTORY_FILE), interactionInventory);

    console.log("Capturing page-load network/API inventory...");

    const networkInventory = await captureNetworkInventory({
      crawlResult,
      sourceCrawlPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE),
      headed: options.headed
    });

    await writeJsonFile(path.join(OUTPUT_DIR, NETWORK_INVENTORY_FILE), networkInventory);

    console.log("Building runtime QA flow graph...");

    const flowGraph = buildFlowGraph({
      crawlResult,
      domInventory,
      interactionInventory,
      networkInventory,
      sources: {
        crawlResultPath: path.join(OUTPUT_DIR, CRAWL_RESULT_FILE),
        domInventoryPath: path.join(OUTPUT_DIR, DOM_INVENTORY_FILE),
        interactionInventoryPath: path.join(OUTPUT_DIR, INTERACTION_INVENTORY_FILE),
        networkInventoryPath: path.join(OUTPUT_DIR, NETWORK_INVENTORY_FILE)
      }
    });

    await writeJsonFile(path.join(OUTPUT_DIR, FLOW_GRAPH_FILE), flowGraph);

    console.log("Inferring business scenarios...");

    const businessScenarios = inferBusinessScenarios({
      flowGraph,
      sourceFlowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE)
    });

    await writeJsonFile(path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE), businessScenarios);

    console.log("Generating manual test cases...");

    const manualTestCases = generateManualTestCases({
      scenarios: businessScenarios,
      flowGraph,
      sourceScenariosPath: path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE)
    });

    await writeJsonFile(path.join(OUTPUT_DIR, MANUAL_TEST_CASES_FILE), manualTestCases);

    console.log("Classifying automation feasibility...");

    const automationFeasibility = classifyAutomationFeasibility({
      manualTestCases,
      businessScenarios,
      flowGraph,
      sourceManualTestCasesPath: path.join(OUTPUT_DIR, MANUAL_TEST_CASES_FILE),
      sourceBusinessScenariosPath: path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE),
      sourceFlowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE)
    });

    await writeJsonFile(path.join(OUTPUT_DIR, AUTOMATION_FEASIBILITY_FILE), automationFeasibility);

    console.log("Generating Playwright UI scripts...");

    const generatedAutomation = generatePlaywrightScripts({
      manualTestCases,
      automationFeasibility,
      flowGraph,
      domInventory,
      outputDirectory: GENERATED_UI_TEST_DIR,
      sourceManualTestCasesPath: path.join(OUTPUT_DIR, MANUAL_TEST_CASES_FILE),
      sourceAutomationFeasibilityPath: path.join(OUTPUT_DIR, AUTOMATION_FEASIBILITY_FILE),
      sourceFlowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE),
      sourceDomInventoryPath: path.join(OUTPUT_DIR, DOM_INVENTORY_FILE)
    });

    await mkdir(GENERATED_UI_TEST_DIR, { recursive: true });
    await clearGeneratedSpecFiles(GENERATED_UI_TEST_DIR);
    await Promise.all(
      generatedAutomation.scripts.map((script) => writeJsonAdjacentTextFile(script.filePath, script.content))
    );
    await writeJsonFile(path.join(OUTPUT_DIR, GENERATED_AUTOMATION_INDEX_FILE), generatedAutomation.index);

    console.log("Generating API smoke tests...");

    const generatedApiTests = generateApiSmokeTests({
      networkInventory,
      flowGraph,
      businessScenarios,
      outputDirectory: GENERATED_API_TEST_DIR,
      sourceNetworkInventoryPath: path.join(OUTPUT_DIR, NETWORK_INVENTORY_FILE),
      sourceFlowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE),
      sourceBusinessScenariosPath: path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE)
    });

    await mkdir(GENERATED_API_TEST_DIR, { recursive: true });
    await clearGeneratedSpecFiles(GENERATED_API_TEST_DIR);
    await Promise.all(
      generatedApiTests.scripts.map((script) => writeJsonAdjacentTextFile(script.filePath, script.content))
    );
    await writeJsonFile(path.join(OUTPUT_DIR, GENERATED_API_TEST_INDEX_FILE), generatedApiTests.index);

    console.log("Building QA traceability document...");

    const qaTraceability = buildQATraceability({
      businessScenarios,
      manualTestCases,
      automationFeasibility,
      generatedAutomation: generatedAutomation.index,
      generatedApiTests: generatedApiTests.index,
      flowGraph,
      sources: {
        businessScenariosPath: path.join(OUTPUT_DIR, BUSINESS_SCENARIOS_FILE),
        manualTestCasesPath: path.join(OUTPUT_DIR, MANUAL_TEST_CASES_FILE),
        automationFeasibilityPath: path.join(OUTPUT_DIR, AUTOMATION_FEASIBILITY_FILE),
        generatedAutomationIndexPath: path.join(OUTPUT_DIR, GENERATED_AUTOMATION_INDEX_FILE),
        generatedApiTestIndexPath: path.join(OUTPUT_DIR, GENERATED_API_TEST_INDEX_FILE),
        flowGraphPath: path.join(OUTPUT_DIR, FLOW_GRAPH_FILE)
      }
    });

    await writeJsonFile(path.join(OUTPUT_DIR, QA_TRACEABILITY_FILE), qaTraceability);

    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    run.crawlSummary = crawlResult.summary;
    run.domSummary = domInventory.summary;
    run.interactionSummary = interactionInventory.summary;
    run.networkSummary = networkInventory.summary;
    run.flowGraphSummary = flowGraph.summary;
    run.businessScenarioSummary = businessScenarios.summary;
    run.manualTestCaseSummary = manualTestCases.summary;
    run.automationFeasibilitySummary = automationFeasibility.summary;
    run.generatedAutomationSummary = generatedAutomation.index.summary;
    run.generatedApiTestSummary = generatedApiTests.index.summary;
    run.qaTraceabilitySummary = qaTraceability.summary;
    run.crossOriginDependencySummary = crossOriginDependencies.summary;
    await writeJsonFile(path.join(OUTPUT_DIR, RUN_METADATA_FILE), run);

    console.log(`Crawled ${crawlResult.summary.crawledPages} page(s).`);
    console.log(`Crawl result written to ${run.artifacts.crawlOutputPath}`);
    console.log(`DOM inventory written to ${run.artifacts.domInventoryPath}`);
    console.log(`Interaction inventory written to ${run.artifacts.interactionInventoryPath}`);
    console.log(`Network inventory written to ${run.artifacts.networkInventoryPath}`);
    console.log(`Flow graph written to ${run.artifacts.flowGraphPath}`);
    console.log(`Business scenarios written to ${run.artifacts.scenariosPath}`);
    console.log(`Manual test cases written to ${run.artifacts.manualTestCasesPath}`);
    console.log(`Automation feasibility written to ${run.artifacts.automationFeasibilityPath}`);
    console.log(`Generated UI tests written to ${run.artifacts.automationScriptsPath}`);
    console.log(`Generated automation index written to ${run.artifacts.generatedAutomationIndexPath}`);
    console.log(`Generated API tests written to ${run.artifacts.apiSmokeTestsPath}`);
    console.log(`Generated API test index written to ${run.artifacts.generatedApiTestIndexPath}`);
    console.log(`QA traceability written to ${run.artifacts.traceabilityPath}`);
    console.log(`Cross-origin dependencies written to ${run.artifacts.crossOriginDependenciesPath}`);
    console.log(`Metadata updated at ${run.artifacts.metadataPath}`);
  } catch (error) {
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    run.errorMessage = error instanceof Error ? error.message : String(error);
    await writeJsonFile(path.join(OUTPUT_DIR, RUN_METADATA_FILE), run);
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonAdjacentTextFile(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value, "utf8");
}

async function clearGeneratedSpecFiles(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
      .map((entry) => unlink(path.join(directoryPath, entry.name)))
  );
}

const executedFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === executedFilePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}

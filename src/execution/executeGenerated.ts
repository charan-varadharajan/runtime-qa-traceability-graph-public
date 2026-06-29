#!/usr/bin/env node
/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBusinessReports } from "../reporting/businessReports.js";
import { generateHtmlReport } from "../reporting/htmlReportGenerator.js";
import type {
  AnalysisRun,
  BusinessValidationDecision,
  ExecutionResultsDocument,
  ExecutionResultsSummary,
  ExecutionScriptResult,
  ExecutionScriptStatus,
  ExecutionTestType,
  QATraceabilityDocument,
  QATraceabilityRecord,
  ScenarioExecutionResult
} from "../types/index.js";

const OUTPUT_DIR = "output";
const QA_TRACEABILITY_PATH = path.join(OUTPUT_DIR, "qa-traceability.json");
const EXECUTION_RESULTS_PATH = path.join(OUTPUT_DIR, "execution-results.json");
const QA_TRACEABILITY_EXECUTED_PATH = path.join(OUTPUT_DIR, "qa-traceability-executed.json");
const RUN_METADATA_PATH = path.join(OUTPUT_DIR, "run-metadata.json");
const HTML_REPORT_PATH = path.join(OUTPUT_DIR, "report.html");
const REQUIREMENTS_COVERAGE_REPORT_PATH = path.join(OUTPUT_DIR, "requirements-coverage.html");
const MANUAL_TEST_REPORT_PATH = path.join(OUTPUT_DIR, "manual-test-report.html");
const AUTOMATION_EXECUTION_REPORT_PATH = path.join(OUTPUT_DIR, "automation-execution-report.html");
const GENERATED_UI_TEST_DIR = path.join("generated-tests", "ui");
const GENERATED_API_TEST_DIR = path.join("generated-tests", "api");
const UI_CONFIG_PATH = "playwright.generated.config.ts";
const API_CONFIG_PATH = "playwright.generated-api.config.ts";

interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
  errors?: PlaywrightError[];
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  file?: string;
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  status?: string;
  expectedStatus?: string;
  projectName?: string;
  results?: PlaywrightTestResult[];
}

interface PlaywrightTestResult {
  status?: string;
  duration?: number;
  error?: PlaywrightError;
  errors?: PlaywrightError[];
  attachments?: PlaywrightAttachment[];
}

interface PlaywrightAttachment {
  name?: string;
  path?: string;
  contentType?: string;
}

interface PlaywrightError {
  message?: string;
  stack?: string;
}

interface PlaywrightRunOutput {
  testType: ExecutionTestType;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ScriptMetadata {
  scenarioId: string;
  testCaseId?: string;
  scriptPath: string;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const traceability = JSON.parse(
    await readFile(QA_TRACEABILITY_PATH, "utf8")
  ) as QATraceabilityDocument;
  const runMetadata = JSON.parse(await readFile(RUN_METADATA_PATH, "utf8")) as AnalysisRun;
  const scriptMetadata = createScriptMetadata(traceability);

  const uiRun = await runPlaywright("ui", UI_CONFIG_PATH, GENERATED_UI_TEST_DIR);
  const apiRun = await runPlaywright("api", API_CONFIG_PATH, GENERATED_API_TEST_DIR);

  const scriptResults = [
    ...parsePlaywrightRun(uiRun, scriptMetadata),
    ...parsePlaywrightRun(apiRun, scriptMetadata)
  ];
  const completedAt = new Date().toISOString();
  const scenarioResults = createScenarioResults(traceability.records, scriptResults);
  const summary = createExecutionSummary(scriptResults, scenarioResults, startedAt, completedAt);
  const executionResults: ExecutionResultsDocument = {
    generatedAt: completedAt,
    sources: {
      qaTraceabilityPath: QA_TRACEABILITY_PATH,
      uiConfigPath: UI_CONFIG_PATH,
      apiConfigPath: API_CONFIG_PATH
    },
    scriptResults,
    scenarioResults,
    summary
  };
  const executedTraceability = applyExecutionResults(traceability, scenarioResults, summary, completedAt);
  const htmlReport = generateHtmlReport({
    traceability: executedTraceability,
    executionResults,
    runMetadata
  });
  const businessReports = generateBusinessReports({
    traceability: executedTraceability,
    executionResults,
    runMetadata
  });

  await writeJsonFile(EXECUTION_RESULTS_PATH, executionResults);
  await writeJsonFile(QA_TRACEABILITY_EXECUTED_PATH, executedTraceability);
  await writeFile(HTML_REPORT_PATH, htmlReport, "utf8");
  await writeFile(REQUIREMENTS_COVERAGE_REPORT_PATH, businessReports.requirementsCoverageHtml, "utf8");
  await writeFile(MANUAL_TEST_REPORT_PATH, businessReports.manualTestReportHtml, "utf8");
  await writeFile(AUTOMATION_EXECUTION_REPORT_PATH, businessReports.automationExecutionReportHtml, "utf8");

  console.log(`Execution results written to ${EXECUTION_RESULTS_PATH}`);
  console.log(`Executed traceability written to ${QA_TRACEABILITY_EXECUTED_PATH}`);
  console.log(`HTML report written to ${HTML_REPORT_PATH}`);
  console.log(`Requirements coverage report written to ${REQUIREMENTS_COVERAGE_REPORT_PATH}`);
  console.log(`Manual test report written to ${MANUAL_TEST_REPORT_PATH}`);
  console.log(`Automation execution report written to ${AUTOMATION_EXECUTION_REPORT_PATH}`);
  console.log(
    `Generated tests: ${summary.totalTests}, passed: ${summary.passed}, failed: ${summary.failed}, skipped: ${summary.skipped}`
  );

  if (scriptResults.some((result) => result.status === "failed")) {
    process.exitCode = 1;
  }
}

async function runPlaywright(
  testType: ExecutionTestType,
  configPath: string,
  testDirectory: string
): Promise<PlaywrightRunOutput> {
  if (!(await hasGeneratedSpecFiles(testDirectory))) {
    return {
      testType,
      exitCode: 0,
      stdout: JSON.stringify({ suites: [] }),
      stderr: ""
    };
  }

  const cliPath = path.join("node_modules", "playwright", "cli.js");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, "test", "-c", configPath, "--reporter=json"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("close", (exitCode) => {
      resolve({
        testType,
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });
  });
}

async function hasGeneratedSpecFiles(directoryPath: string): Promise<boolean> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"));
  } catch {
    return false;
  }
}

function parsePlaywrightRun(
  run: PlaywrightRunOutput,
  scriptMetadata: Map<string, ScriptMetadata>
): ExecutionScriptResult[] {
  const report = parseJsonReport(run.stdout);

  if (!report) {
    return [
      {
        testName: `${run.testType} generated test suite`,
        scenarioId: "unmapped",
        scriptPath: run.testType === "ui" ? UI_CONFIG_PATH : API_CONFIG_PATH,
        status: "failed",
      errorMessage: firstNonEmpty([
        `Playwright JSON reporter output could not be parsed for ${run.testType} tests.`,
        run.stderr.trim(),
        run.stdout.trim()
      ]),
      durationMs: 0,
      testType: run.testType,
      artifacts: []
      }
    ];
  }

  const results = flattenSpecs(report).map((spec) => {
    const scriptPath = normalizePath(spec.file ?? "");
    const metadata = scriptMetadata.get(scriptPath);
    const status = statusForSpec(spec);

    return {
      testName: spec.title,
      scenarioId: metadata?.scenarioId ?? "unmapped",
      testCaseId: metadata?.testCaseId,
      scriptPath: metadata?.scriptPath ?? scriptPath,
      status,
      errorMessage: errorMessageForSpec(spec),
      durationMs: durationForSpec(spec),
      testType: run.testType,
      artifacts: artifactsForSpec(spec)
    };
  });

  if (results.length === 0 && run.exitCode !== 0) {
    return [
      {
        testName: `${run.testType} generated test suite`,
        scenarioId: "unmapped",
        scriptPath: run.testType === "ui" ? UI_CONFIG_PATH : API_CONFIG_PATH,
        status: "failed",
        errorMessage: firstNonEmpty([
          report.errors?.map((error) => error.message).filter(Boolean).join("\n"),
          run.stderr.trim(),
          "Playwright exited without test results."
        ]),
        durationMs: 0,
        testType: run.testType,
        artifacts: []
      }
    ];
  }

  return results;
}

function parseJsonReport(stdout: string): PlaywrightJsonReport | undefined {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as PlaywrightJsonReport;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as PlaywrightJsonReport;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function flattenSpecs(report: PlaywrightJsonReport): PlaywrightSpec[] {
  const specs: PlaywrightSpec[] = [];

  for (const suite of report.suites ?? []) {
    collectSpecs(suite, specs);
  }

  return specs;
}

function collectSpecs(suite: PlaywrightSuite, specs: PlaywrightSpec[]): void {
  for (const spec of suite.specs ?? []) {
    specs.push({
      ...spec,
      file: spec.file ?? suite.file
    });
  }

  for (const child of suite.suites ?? []) {
    collectSpecs(child, specs);
  }
}

function statusForSpec(spec: PlaywrightSpec): ExecutionScriptStatus {
  const tests = spec.tests ?? [];
  const statuses = tests.flatMap((test) =>
    test.results?.length ? test.results.map((result) => result.status ?? test.status ?? "") : [test.status ?? ""]
  );

  if (statuses.some((status) => status === "failed" || status === "timedOut" || status === "interrupted")) {
    return "failed";
  }

  if (statuses.length > 0 && statuses.every((status) => status === "skipped")) {
    return "skipped";
  }

  if (tests.some((test) => test.status === "unexpected")) {
    return "failed";
  }

  return "passed";
}

function errorMessageForSpec(spec: PlaywrightSpec): string | undefined {
  const messages = (spec.tests ?? []).flatMap((test) =>
    (test.results ?? []).flatMap((result) => [
      result.error?.message,
      ...(result.errors ?? []).map((error) => error.message)
    ])
  );

  return firstNonEmpty(messages);
}

function durationForSpec(spec: PlaywrightSpec): number {
  return (spec.tests ?? []).reduce(
    (sum, test) => sum + (test.results ?? []).reduce((inner, result) => inner + (result.duration ?? 0), 0),
    0
  );
}

function artifactsForSpec(spec: PlaywrightSpec): ExecutionScriptResult["artifacts"] {
  const attachments = (spec.tests ?? []).flatMap((test) =>
    (test.results ?? []).flatMap((result) => result.attachments ?? [])
  );

  return attachments.flatMap((attachment) => {
    if (!attachment.path) {
      return [];
    }

    return [
      {
        name: attachment.name ?? path.basename(attachment.path),
        path: normalizePath(path.relative(process.cwd(), attachment.path)),
        contentType: attachment.contentType
      }
    ];
  });
}

function createScriptMetadata(traceability: QATraceabilityDocument): Map<string, ScriptMetadata> {
  const metadata = new Map<string, ScriptMetadata>();

  for (const record of traceability.records) {
    for (const script of record.uiAutomationScripts) {
      const scriptPath = normalizePath(script.filePath);
      const scriptMetadata = {
        scenarioId: record.scenarioId,
        testCaseId: script.testCaseId,
        scriptPath
      };
      metadata.set(scriptPath, scriptMetadata);
      metadata.set(path.basename(scriptPath), scriptMetadata);
    }

    for (const script of record.apiTestScripts) {
      const scriptPath = normalizePath(script.filePath);
      const scriptMetadata = {
        scenarioId: record.scenarioId,
        testCaseId: record.manualTestCases[0]?.testCaseId,
        scriptPath
      };
      metadata.set(scriptPath, scriptMetadata);
      metadata.set(path.basename(scriptPath), scriptMetadata);
    }
  }

  return metadata;
}

function createScenarioResults(
  records: QATraceabilityRecord[],
  scriptResults: ExecutionScriptResult[]
): ScenarioExecutionResult[] {
  return records.map((record) => {
    const linkedScriptPaths = new Set([
      ...record.uiAutomationScripts.map((script) => normalizePath(script.filePath)),
      ...record.apiTestScripts.map((script) => normalizePath(script.filePath))
    ]);
    const linkedResults = scriptResults.filter((result) => linkedScriptPaths.has(normalizePath(result.scriptPath)));
    const decision = decideBusinessValidation(record, linkedResults);

    return {
      scenarioId: record.scenarioId,
      scenarioName: record.scenarioName,
      scenarioPriority: record.scenarioPriority,
      businessValidationDecision: decision.businessValidationDecision,
      decisionReason: decision.decisionReason,
      scriptResults: linkedResults
    };
  });
}

function decideBusinessValidation(
  record: QATraceabilityRecord,
  linkedResults: ExecutionScriptResult[]
): {
  businessValidationDecision: BusinessValidationDecision;
  decisionReason: string;
} {
  if (linkedResults.length === 0) {
    if (record.coverageStatus === "blocked" || record.requiredUserInputs.length > 0) {
      return {
        businessValidationDecision: "blocked",
        decisionReason: "No generated executable test was linked to this scenario and required inputs or blockers remain."
      };
    }

    return {
      businessValidationDecision: "not_executed",
      decisionReason: "No generated test result was linked to this scenario."
    };
  }

  const executableResults = linkedResults.filter((result) => result.status !== "skipped");
  const skippedResults = linkedResults.filter((result) => result.status === "skipped");
  const failedResults = executableResults.filter((result) => result.status === "failed");
  const passedResults = executableResults.filter((result) => result.status === "passed");

  if (executableResults.length === 0) {
    return {
      businessValidationDecision: "blocked",
      decisionReason: "All linked generated tests were skipped; missing data, credentials, or environment setup still blocks validation."
    };
  }

  if (failedResults.length > 0) {
    if (record.scenarioPriority === "critical") {
      return {
        businessValidationDecision: "failed",
        decisionReason: "At least one linked executable test failed for a critical business scenario."
      };
    }

    return {
      businessValidationDecision: "partially_validated",
      decisionReason: "At least one linked executable test failed, but the scenario is not critical; business validation is partial."
    };
  }

  if (
    passedResults.length > 0 &&
    skippedResults.length === 0 &&
    record.coverageStatus === "covered" &&
    record.requiredUserInputs.length === 0
  ) {
    return {
      businessValidationDecision: "passed",
      decisionReason: "All linked executable tests passed and no static blockers remain."
    };
  }

  return {
    businessValidationDecision: "partially_validated",
    decisionReason: "One or more linked executable tests passed, but skipped tests, required inputs, or static limitations remain."
  };
}

function createExecutionSummary(
  scriptResults: ExecutionScriptResult[],
  scenarioResults: ScenarioExecutionResult[],
  startedAt: string,
  completedAt: string
): ExecutionResultsSummary {
  return {
    totalTests: scriptResults.length,
    passed: scriptResults.filter((result) => result.status === "passed").length,
    failed: scriptResults.filter((result) => result.status === "failed").length,
    skipped: scriptResults.filter((result) => result.status === "skipped").length,
    scenarioCount: scenarioResults.length,
    byBusinessValidationDecision: countBy(
      scenarioResults,
      (result) => result.businessValidationDecision
    ),
    startedAt,
    completedAt
  };
}

function applyExecutionResults(
  traceability: QATraceabilityDocument,
  scenarioResults: ScenarioExecutionResult[],
  summary: ExecutionResultsSummary,
  completedAt: string
): QATraceabilityDocument {
  const scenarioResultsById = new Map(scenarioResults.map((result) => [result.scenarioId, result]));

  return {
    ...traceability,
    executedAt: completedAt,
    records: traceability.records.map((record) => {
      const scenarioResult = scenarioResultsById.get(record.scenarioId);

      if (!scenarioResult) {
        return record;
      }

      return {
        ...record,
        businessValidationDecision: scenarioResult.businessValidationDecision,
        decisionReason: scenarioResult.decisionReason,
        executionResults: scenarioResult.scriptResults.map((result) => ({
          testName: result.testName,
          testCaseId: result.testCaseId,
          scriptPath: result.scriptPath,
          status: result.status,
          errorMessage: result.errorMessage,
          durationMs: result.durationMs,
          testType: result.testType,
          artifacts: result.artifacts
        }))
      };
    }),
    summary: {
      ...traceability.summary,
      byBusinessValidationDecision: summary.byBusinessValidationDecision
    },
    executionSummary: summary
  };
}

function countBy<T>(values: T[], keySelector: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = keySelector(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.trim())?.trim();
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const executedFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === executedFilePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}

/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import type {
  AnalysisRun,
  BusinessValidationDecision,
  ExecutionResultsDocument,
  QATraceabilityDocument,
  QATraceabilityRecord,
  TraceabilityAutomationFeasibilityRef
} from "../types/index.js";

export interface GenerateHtmlReportOptions {
  traceability: QATraceabilityDocument;
  executionResults: ExecutionResultsDocument;
  runMetadata: AnalysisRun;
}

export function generateHtmlReport(options: GenerateHtmlReportOptions): string {
  const { traceability, executionResults, runMetadata } = options;
  const records = traceability.records;
  const recommendations = createRecommendations(records);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Runtime QA Traceability Report</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #5d6d7e;
      --line: #d8dee6;
      --panel: #ffffff;
      --surface: #f4f7fa;
      --accent: #1f6f8b;
      --good: #177245;
      --warn: #9a6700;
      --bad: #b42318;
      --blocked: #6b4e16;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background: var(--surface);
      line-height: 1.45;
    }
    header {
      background: #102a43;
      color: #fff;
      padding: 28px 36px;
    }
    header h1 { margin: 0 0 8px; font-size: 30px; }
    header p { margin: 0; color: #d9e2ec; }
    main { padding: 28px 36px 48px; max-width: 1440px; margin: 0 auto; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 0 0 24px;
      padding: 22px;
    }
    h2 { margin: 0 0 16px; font-size: 22px; }
    h3 { margin: 20px 0 10px; font-size: 18px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px;
      background: #fbfdff;
    }
    .metric strong { display: block; font-size: 24px; margin-top: 4px; }
    .metric span { color: var(--muted); font-size: 13px; }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 14px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #eef3f8;
      font-weight: 700;
    }
    code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      background: #eef3f8;
      border-radius: 4px;
      padding: 2px 4px;
    }
    ul { margin: 8px 0 0 20px; padding: 0; }
    li { margin: 4px 0; }
    .tag {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      font-family: "SFMono-Regular", Consolas, monospace;
      background: #eef3f8;
      color: var(--ink);
      white-space: nowrap;
    }
    .passed, .covered { color: var(--good); font-weight: 700; }
    .failed, .unsafe { color: var(--bad); font-weight: 700; }
    .blocked, .not_covered { color: var(--blocked); font-weight: 700; }
    .partially_validated, .partially_covered { color: var(--warn); font-weight: 700; }
    .muted { color: var(--muted); }
    .detail {
      border-top: 1px solid var(--line);
      padding-top: 18px;
      margin-top: 18px;
    }
    .two-col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 18px;
    }
    @media (max-width: 860px) {
      header, main { padding-left: 18px; padding-right: 18px; }
      .two-col { grid-template-columns: 1fr; }
      table { font-size: 13px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Runtime QA Traceability Report</h1>
    <p>${escapeHtml(runMetadata.targetUrl)} | generated ${escapeHtml(new Date().toISOString())}</p>
  </header>
  <main>
    ${renderExecutiveSummary(traceability, executionResults, runMetadata)}
    ${renderCoverageTable(records)}
    ${renderScenarioDetails(records)}
    ${renderApiCoverage(records)}
    ${renderUnsafeBlockedFlows(records)}
    ${renderRecommendations(recommendations)}
  </main>
</body>
</html>
`;
}

function renderExecutiveSummary(
  traceability: QATraceabilityDocument,
  executionResults: ExecutionResultsDocument,
  runMetadata: AnalysisRun
): string {
  const decisionCounts = traceability.summary.byBusinessValidationDecision;

  return `<section>
    <h2>Executive Summary</h2>
    <div class="grid">
      ${metric("Analyzed URL", runMetadata.targetUrl)}
      ${metric("Run timestamp", runMetadata.updatedAt)}
      ${metric("Pages crawled", String(runMetadata.crawlSummary?.crawledPages ?? 0))}
      ${metric("Scenarios found", String(traceability.summary.scenarioCount))}
      ${metric("Manual tests created", String(traceability.summary.manualTestCaseCount))}
      ${metric("UI scripts generated", String(traceability.summary.uiAutomationScriptCount))}
      ${metric("API tests generated", String(traceability.summary.apiTestScriptCount))}
      ${metric("Script tests passed", String(executionResults.summary.passed))}
      ${metric("Script tests failed", String(executionResults.summary.failed))}
      ${metric("Script tests skipped", String(executionResults.summary.skipped))}
      ${metric("Business passed", String(decisionCounts.passed ?? 0))}
      ${metric("Business failed", String(decisionCounts.failed ?? 0))}
      ${metric("Business blocked", String(decisionCounts.blocked ?? 0))}
      ${metric("Business partial", String(decisionCounts.partially_validated ?? 0))}
    </div>
  </section>`;
}

function renderCoverageTable(records: QATraceabilityRecord[]): string {
  const rows = records
    .map(
      (record) => `<tr>
        <td><code>${escapeHtml(record.scenarioId)}</code></td>
        <td>${escapeHtml(record.scenarioName)}</td>
        <td>${tag(record.scenarioPriority)}</td>
        <td class="${escapeClass(record.businessValidationDecision)}">${formatToken(record.businessValidationDecision)}</td>
        <td class="${escapeClass(record.coverageStatus)}">${formatToken(record.coverageStatus)}</td>
        <td>${renderFeasibilitySummary(record.automationFeasibility)}</td>
        <td>${escapeHtml(summarize(record.coverageLimitations, 2))}</td>
      </tr>`
    )
    .join("");

  return `<section>
    <h2>Business Scenario Coverage</h2>
    <table>
      <thead>
        <tr>
          <th>Scenario ID</th>
          <th>Scenario</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Coverage</th>
          <th>Automation Feasibility</th>
          <th>Limitation Summary</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderScenarioDetails(records: QATraceabilityRecord[]): string {
  return `<section>
    <h2>Scenario Details</h2>
    ${records.map(renderScenarioDetail).join("")}
  </section>`;
}

function renderScenarioDetail(record: QATraceabilityRecord): string {
  return `<article class="detail">
    <h3>${escapeHtml(record.scenarioName)}</h3>
    <p>
      <code>${escapeHtml(record.scenarioId)}</code>
      ${tag(record.scenarioCategory)}
      ${tag(record.scenarioPriority)}
      <span class="${escapeClass(record.businessValidationDecision)}">${formatToken(record.businessValidationDecision)}</span>
    </p>
    <div class="two-col">
      <div>
        <h4>Evidence</h4>
        ${list(record.evidence)}
        <h4>Manual Test Cases</h4>
        ${list(record.manualTestCases.map((test) => `${test.testCaseId}: ${test.title}`))}
        <h4>Automation Scripts</h4>
        ${list([
          ...record.uiAutomationScripts.map((script) => `UI: ${script.filePath}`),
          ...record.apiTestScripts.map((script) => `API: ${script.filePath}`)
        ])}
      </div>
      <div>
        <h4>Related APIs</h4>
        ${list(record.relatedApis.map((api) => `${api.method ?? "API"} ${api.redactedUrl ?? api.label}`))}
        <h4>Execution Result</h4>
        ${list(record.executionResults?.map((result) => `${result.status.toUpperCase()}: ${result.testName} (${result.durationMs}ms)`) ?? [])}
        <p class="muted">${escapeHtml(record.decisionReason)}</p>
        <h4>Coverage Limitations</h4>
        ${list(record.coverageLimitations)}
      </div>
    </div>
  </article>`;
}

function renderApiCoverage(records: QATraceabilityRecord[]): string {
  const apiRows = records.flatMap((record) =>
    record.apiTestScripts.map((script) => ({
      scenarioId: record.scenarioId,
      scenarioName: record.scenarioName,
      script
    }))
  );

  const rows = apiRows.length
    ? apiRows
        .map(
          ({ scenarioId, scenarioName, script }) => `<tr>
            <td><code>${escapeHtml(scenarioId)}</code><br>${escapeHtml(scenarioName)}</td>
            <td>${escapeHtml(script.method)}</td>
            <td>${escapeHtml(script.redactedUrl)}</td>
            <td>${escapeHtml(script.filePath)}</td>
            <td>${script.executableByDefault ? "Executable" : `Skipped: ${escapeHtml(script.skipReason ?? "not executable by default")}`}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5">No API smoke tests were generated.</td></tr>`;

  return `<section>
    <h2>API Coverage</h2>
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Script</th>
          <th>Execution Policy</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderUnsafeBlockedFlows(records: QATraceabilityRecord[]): string {
  const filtered = records.filter(
    (record) =>
      record.coverageStatus === "blocked" ||
      record.coverageStatus === "unsafe" ||
      record.businessValidationDecision === "blocked" ||
      record.safetyClassification === "unsafe_without_permission"
  );

  const rows = filtered.length
    ? filtered
        .map(
          (record) => `<tr>
            <td>${escapeHtml(record.scenarioName)}<br><code>${escapeHtml(record.scenarioId)}</code></td>
            <td>${formatToken(record.safetyClassification)}</td>
            <td class="${escapeClass(record.businessValidationDecision)}">${formatToken(record.businessValidationDecision)}</td>
            <td>${escapeHtml(summarize(record.coverageLimitations, 3))}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4">No unsafe or blocked flows were detected.</td></tr>`;

  return `<section>
    <h2>Unsafe and Blocked Flows</h2>
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Safety</th>
          <th>Business Result</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderRecommendations(recommendations: Recommendations): string {
  return `<section>
    <h2>Recommendations</h2>
    <div class="two-col">
      <div>
        <h3>Credentials Needed</h3>
        ${list(recommendations.credentials)}
        <h3>Test Data Needed</h3>
        ${list(recommendations.testData)}
      </div>
      <div>
        <h3>Sandbox Needed</h3>
        ${list(recommendations.sandbox)}
        <h3>Manual Validation Needed</h3>
        ${list(recommendations.manualValidation)}
      </div>
    </div>
  </section>`;
}

interface Recommendations {
  credentials: string[];
  testData: string[];
  sandbox: string[];
  manualValidation: string[];
}

function createRecommendations(records: QATraceabilityRecord[]): Recommendations {
  const recommendations: Recommendations = {
    credentials: [],
    testData: [],
    sandbox: [],
    manualValidation: []
  };

  for (const record of records) {
    for (const input of record.requiredUserInputs) {
      const normalized = input.toLowerCase();
      const entry = `${record.scenarioName}: ${input}`;

      if (normalized.includes("credential") || normalized.includes("username") || normalized.includes("password")) {
        recommendations.credentials.push(entry);
      } else if (normalized.includes("seed") || normalized.includes("data")) {
        recommendations.testData.push(entry);
      } else if (normalized.includes("sandbox") || normalized.includes("pre-production") || normalized.includes("external")) {
        recommendations.sandbox.push(entry);
      }
    }

    if (
      record.coverageLimitations.some((limitation) => /manual|external|unknown|dry-run|not execute/i.test(limitation)) ||
      record.businessValidationDecision === "blocked"
    ) {
      recommendations.manualValidation.push(`${record.scenarioName}: ${record.decisionReason}`);
    }
  }

  return {
    credentials: dedupeOrDefault(recommendations.credentials, "No missing credential inputs were detected."),
    testData: dedupeOrDefault(recommendations.testData, "No missing seeded test data was detected."),
    sandbox: dedupeOrDefault(recommendations.sandbox, "No missing sandbox or external-system setup was detected."),
    manualValidation: dedupeOrDefault(recommendations.manualValidation, "No manual validation follow-up was detected.")
  };
}

function renderFeasibilitySummary(values: TraceabilityAutomationFeasibilityRef[]): string {
  if (values.length === 0) {
    return "No feasibility result";
  }

  return values
    .map((value) => `${formatToken(value.classification)} / ${formatToken(value.safeExecutionMode)}`)
    .join("; ");
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tag(value: string): string {
  return `<span class="tag">${escapeHtml(formatToken(value))}</span>`;
}

function list(values: string[]): string {
  if (values.length === 0) {
    return `<p class="muted">None recorded.</p>`;
  }

  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function summarize(values: string[], limit: number): string {
  if (values.length === 0) {
    return "None recorded.";
  }

  const selected = values.slice(0, limit).join(" ");
  const suffix = values.length > limit ? ` (+${values.length - limit} more)` : "";
  return `${selected}${suffix}`;
}

function formatToken(value: string): string {
  return value.replace(/_/g, " ");
}

function escapeClass(value: BusinessValidationDecision | string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function dedupeOrDefault(values: string[], fallback: string): string[] {
  const unique = Array.from(new Set(values));
  return unique.length ? unique : [fallback];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

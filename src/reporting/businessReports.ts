import type {
  AnalysisRun,
  BusinessValidationDecision,
  ExecutionResultsDocument,
  ExecutionScriptResult,
  QATraceabilityDocument,
  QATraceabilityRecord,
  TraceabilityManualTestCaseRef
} from "../types/index.js";

export interface GenerateBusinessReportsOptions {
  traceability: QATraceabilityDocument;
  executionResults: ExecutionResultsDocument;
  runMetadata: AnalysisRun;
}

export interface BusinessReportFiles {
  requirementsCoverageHtml: string;
  manualTestReportHtml: string;
  automationExecutionReportHtml: string;
}

export function generateBusinessReports(
  options: GenerateBusinessReportsOptions
): BusinessReportFiles {
  return {
    requirementsCoverageHtml: renderRequirementsCoverage(options),
    manualTestReportHtml: renderManualTestReport(options),
    automationExecutionReportHtml: renderAutomationExecutionReport(options)
  };
}

function renderRequirementsCoverage(options: GenerateBusinessReportsOptions): string {
  const { traceability, runMetadata } = options;
  const rows = traceability.records.map((record) => {
    const verdict = requirementVerdict(record);

    return `<tr>
      <td>${statusPill(verdict.status)}</td>
      <td>
        <strong>${escapeHtml(record.scenarioName)}</strong><br>
        <code>${escapeHtml(record.scenarioId)}</code>
      </td>
      <td>${escapeHtml(formatToken(record.scenarioCategory))}</td>
      <td>${escapeHtml(record.scenarioPriority)}</td>
      <td>${percent(record.scenarioConfidence)}</td>
      <td>${escapeHtml(verdict.reason)}</td>
      <td>${list(record.evidence.slice(0, 4))}</td>
    </tr>`;
  }).join("");

  return pageShell({
    title: "Requirements Coverage",
    runMetadata,
    summary: [
      metric("Requirements", String(traceability.records.length)),
      metric("Valid", String(traceability.records.filter((record) => requirementVerdict(record).status === "valid").length)),
      metric("Review", String(traceability.records.filter((record) => requirementVerdict(record).status === "review").length)),
      metric("Invalid", String(traceability.records.filter((record) => requirementVerdict(record).status === "invalid").length))
    ],
    body: `<section>
      <h2>Scenario Requirements</h2>
      <table>
        <thead>
          <tr>
            <th>Validity</th>
            <th>Requirement / Scenario</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Confidence</th>
            <th>Decision Reason</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>${rows || emptyRow(7, "No requirements were inferred.")}</tbody>
      </table>
    </section>`
  });
}

function renderManualTestReport(options: GenerateBusinessReportsOptions): string {
  const { traceability, runMetadata } = options;
  const rows = traceability.records.flatMap((record) =>
    record.manualTestCases.map((testCase) => renderManualTestCaseRow(record, testCase))
  ).join("");

  return pageShell({
    title: "Manual Test Cases",
    runMetadata,
    summary: [
      metric("Scenarios", String(traceability.records.length)),
      metric("Manual Tests", String(traceability.summary.manualTestCaseCount)),
      metric("Automatable Candidates", String(traceability.records.flatMap((record) => record.manualTestCases).filter((test) => test.automatableCandidate).length)),
      metric("Needs Manual Review", String(traceability.records.filter((record) => record.coverageLimitations.length > 0).length))
    ],
    body: `<section>
      <h2>Readable Manual Tests</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Manual Test</th>
            <th>Steps</th>
            <th>Expected Result</th>
            <th>Limitations</th>
          </tr>
        </thead>
        <tbody>${rows || emptyRow(5, "No manual test cases were generated.")}</tbody>
      </table>
    </section>`
  });
}

function renderManualTestCaseRow(
  record: QATraceabilityRecord,
  testCase: TraceabilityManualTestCaseRef
): string {
  return `<tr>
    <td>
      <strong>${escapeHtml(record.scenarioName)}</strong><br>
      <code>${escapeHtml(record.scenarioId)}</code>
    </td>
    <td>
      <strong>${escapeHtml(testCase.title)}</strong><br>
      <code>${escapeHtml(testCase.testCaseId)}</code>
    </td>
    <td>${orderedList(testCase.steps)}</td>
    <td>${escapeHtml(testCase.expectedResult)}</td>
    <td>${list(testCase.coverageLimitations)}</td>
  </tr>`;
}

function renderAutomationExecutionReport(options: GenerateBusinessReportsOptions): string {
  const { traceability, executionResults, runMetadata } = options;
  const scenarioRows = traceability.records.map(renderScenarioExecutionRow).join("");
  const scriptRows = executionResults.scriptResults.map(renderScriptExecutionRow).join("");

  return pageShell({
    title: "Automation Execution",
    runMetadata,
    summary: [
      metric("Passed", String(executionResults.summary.passed), "passed"),
      metric("Failed", String(executionResults.summary.failed), "failed"),
      metric("Skipped", String(executionResults.summary.skipped), "skipped"),
      metric("Business Passed", String(executionResults.summary.byBusinessValidationDecision.passed ?? 0), "passed"),
      metric("Business Failed", String(executionResults.summary.byBusinessValidationDecision.failed ?? 0), "failed"),
      metric("Business Blocked", String(executionResults.summary.byBusinessValidationDecision.blocked ?? 0), "blocked")
    ],
    body: `<section>
      <h2>Business Result</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Scenario</th>
            <th>Coverage</th>
            <th>Reason</th>
            <th>Linked Scripts</th>
          </tr>
        </thead>
        <tbody>${scenarioRows || emptyRow(5, "No scenario execution results were recorded.")}</tbody>
      </table>
    </section>
    <section>
      <h2>Script Result</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Test</th>
            <th>Type</th>
            <th>Duration</th>
            <th>Artifacts</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>${scriptRows || emptyRow(6, "No script results were recorded.")}</tbody>
      </table>
    </section>`
  });
}

function renderScenarioExecutionRow(record: QATraceabilityRecord): string {
  const scripts = [
    ...record.uiAutomationScripts.map((script) => script.filePath),
    ...record.apiTestScripts.map((script) => script.filePath)
  ];

  return `<tr>
    <td>${statusPill(statusFromDecision(record.businessValidationDecision))}</td>
    <td>
      <strong>${escapeHtml(record.scenarioName)}</strong><br>
      <code>${escapeHtml(record.scenarioId)}</code>
    </td>
    <td>${escapeHtml(formatToken(record.coverageStatus))}</td>
    <td>${escapeHtml(record.decisionReason)}</td>
    <td>${list(scripts)}</td>
  </tr>`;
}

function renderScriptExecutionRow(result: ExecutionScriptResult): string {
  return `<tr>
    <td>${statusPill(result.status)}</td>
    <td>
      <strong>${escapeHtml(result.testName)}</strong><br>
      <code>${escapeHtml(result.scriptPath)}</code>
    </td>
    <td>${escapeHtml(result.testType.toUpperCase())}</td>
    <td>${escapeHtml(`${Math.round(result.durationMs)} ms`)}</td>
    <td>${artifactLinks(result)}</td>
    <td>${escapeHtml(result.errorMessage ?? "")}</td>
  </tr>`;
}

function pageShell(options: {
  title: string;
  runMetadata: AnalysisRun;
  summary: string[];
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2933;
      --muted: #607080;
      --line: #d8dee6;
      --surface: #f6f8fb;
      --panel: #ffffff;
      --passed: #146c43;
      --failed: #b42318;
      --blocked: #8a5a00;
      --skipped: #52606d;
      --review: #8a5a00;
      --invalid: #b42318;
      --valid: #146c43;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--ink);
      background: var(--surface);
      line-height: 1.45;
    }
    header {
      background: #243b53;
      color: #fff;
      padding: 24px 32px;
    }
    header h1 { margin: 0 0 6px; font-size: 28px; }
    header p { margin: 0; color: #d9e2ec; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px 32px 48px; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      margin: 0 0 20px;
    }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric strong { display: block; font-size: 26px; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border-bottom: 1px solid var(--line); padding: 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
    code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      background: #eef3f8;
      border-radius: 4px;
      padding: 2px 4px;
    }
    ul, ol { margin: 6px 0 0 20px; padding: 0; }
    li { margin: 3px 0; }
    .pill {
      display: inline-block;
      min-width: 78px;
      text-align: center;
      border-radius: 999px;
      padding: 4px 9px;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .passed, .valid { background: var(--passed); }
    .failed, .invalid { background: var(--failed); }
    .blocked, .review { background: var(--blocked); }
    .skipped, .partial, .not_executed { background: var(--skipped); }
    a { color: #1f6f8b; }
    .metric.passed strong { color: var(--passed); }
    .metric.failed strong { color: var(--failed); }
    .metric.blocked strong { color: var(--blocked); }
    .metric.skipped strong { color: var(--skipped); }
    @media (max-width: 800px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      table { font-size: 13px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.runMetadata.targetUrl)} | ${escapeHtml(options.runMetadata.updatedAt)}</p>
  </header>
  <main>
    <div class="summary">${options.summary.join("")}</div>
    ${options.body}
  </main>
</body>
</html>
`;
}

function requirementVerdict(record: QATraceabilityRecord): { status: "valid" | "review" | "invalid"; reason: string } {
  const evidence = record.evidence.join(" ").toLowerCase();
  const name = record.scenarioName.toLowerCase();

  if (record.scenarioConfidence < 0.6 || record.scenarioCategory === "unknown") {
    return { status: "review", reason: "Low confidence deterministic inference; needs human confirmation." };
  }

  if (
    /\b(skip to|accessibility statement|statement of operations|transfer payment programs|learn more)\b/.test(evidence) &&
    ["payment", "account_overview", "item_creation", "ui_state_management"].includes(record.scenarioCategory)
  ) {
    return {
      status: "invalid",
      reason: "Evidence appears to be informational page text rather than a transactional business flow."
    };
  }

  if (name.includes("via") || record.evidence.length > 0) {
    return { status: "valid", reason: "Runtime evidence supports a recognizable user-facing requirement." };
  }

  return { status: "review", reason: "Scenario is plausible, but evidence should be reviewed." };
}

function artifactLinks(result: ExecutionScriptResult): string {
  const artifacts = result.artifacts ?? [];

  if (artifacts.length === 0) {
    return "None recorded.";
  }

  return `<ul>${artifacts.map((artifact) => {
    const label = artifact.name || artifact.contentType || "artifact";
    return `<li><a href="../${escapeAttribute(artifact.path)}">${escapeHtml(label)}</a></li>`;
  }).join("")}</ul>`;
}

function statusFromDecision(decision: BusinessValidationDecision): "passed" | "failed" | "blocked" | "skipped" | "partial" {
  switch (decision) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "partially_validated":
      return "partial";
    default:
      return "skipped";
  }
}

function statusPill(status: string): string {
  return `<span class="pill ${escapeAttribute(status)}">${escapeHtml(formatToken(status))}</span>`;
}

function metric(label: string, value: string, status?: string): string {
  return `<div class="metric ${status ? escapeAttribute(status) : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function list(values: string[]): string {
  if (values.length === 0) {
    return "None recorded.";
  }

  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function orderedList(values: string[]): string {
  if (values.length === 0) {
    return "None recorded.";
  }

  return `<ol>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ol>`;
}

function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatToken(value: string): string {
  return value.replace(/_/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value.replace(/[^a-zA-Z0-9._/-]+/g, "-"));
}

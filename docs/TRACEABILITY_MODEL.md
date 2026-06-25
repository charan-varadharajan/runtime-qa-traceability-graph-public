# QA Traceability Model

`output/qa-traceability.json` is the core product artifact. It joins runtime-discovered business intent, human-readable test design, generated automation, API smoke coverage, and known limitations into one scenario-centered evidence record.

## Record Grain

The traceability document uses one record per business scenario.

Each record maps:

```text
business scenario -> manual test case -> UI automation script -> API test script -> coverage limitation
```

Every inferred scenario must appear in the document, even when automation was not generated. Missing automation is represented as coverage status and limitation data, not by omitting the scenario.

## Source Artifacts

The traceability document is built from deterministic artifacts:

- `output/business-scenarios.json`
- `output/manual-test-cases.json`
- `output/automation-feasibility.json`
- `output/generated-automation-index.json`
- `output/generated-api-test-index.json`
- `output/flow-graph.json`

The traceability document stores these source paths in `sources` so downstream reports can audit provenance.

## Core Fields

Scenario identity:

- `scenarioId`
- `scenarioName`
- `scenarioCategory`
- `scenarioPriority`
- `scenarioConfidence`
- `requirementSource`
- `evidence`

Test and automation links:

- `manualTestCases`
- `uiAutomationScripts`
- `apiTestScripts`
- `relatedApis`
- `automationFeasibility`

Risk and dependency context:

- `safetyClassification`
- `dataDependencies`
- `coverageLimitations`
- `requiredUserInputs`

Validation state:

- `coverageStatus`
- `businessValidationDecision`
- `decisionReason`

## Coverage Status

`coverageStatus` is a static coverage judgment inferred before execution.

`covered` means the scenario has generated automation and no material static limitation or required user input was detected.

`partially_covered` means at least one UI or API automation artifact exists, but some part of the business validation is gated by credentials, seeded data, dry-run behavior, external systems, generated-script limitations, or partial feasibility.

`not_covered` means the scenario has a manual test but no generated UI or API automation artifact.

`blocked` means automation was blocked by missing or unknown data and no generated script covers the scenario.

`unsafe` means the scenario is unsafe to automate and no generated script covers it.

## Business Validation Decision

`businessValidationDecision` is execution-state data, not generation-state data.

For Step 10, no generated test has been executed as a business validation result, so every record is:

```json
"businessValidationDecision": "not_executed"
```

The execution engine can later update this field to:

- `passed`
- `failed`
- `partially_validated`
- `blocked`

The `decisionReason` explains why the current decision was assigned.

## Execution Ingestion

`npm run execute:generated` runs generated UI and API specs and writes:

- `output/execution-results.json`
- `output/qa-traceability-executed.json`

Script-level results are mapped back to scenarios by generated script path. Each script result records:

- test name
- scenario ID
- manual test case ID when available
- script path
- status: `passed`, `failed`, or `skipped`
- error message when available
- duration
- test type: `ui` or `api`

Business-level results are inferred from linked script results:

- `passed`: all linked executable tests passed and no static blockers remain
- `failed`: at least one linked executable test failed for a critical business scenario
- `partially_validated`: at least one linked test ran, but skips, blockers, limitations, or non-critical failures remain
- `blocked`: linked tests exist but all were skipped, or no executable tests exist because required inputs are missing
- `not_executed`: no generated test result is linked to the scenario

Skipped tests are preserved as evidence. They are not discarded or silently converted into passes.

## Limitations

Limitations are first-class evidence. They are intentionally preserved from manual tests, automation feasibility, generated UI script notes, and generated API test skip reasons.

Examples:

- approved credentials required
- seeded data required
- external system or mock required
- dry-run only behavior
- final destructive action not executed
- unknown data dependency
- generated API test skipped by default

This keeps the artifact honest: generated automation can exist without overstating business coverage.

## Extensibility

The model is scenario-centered and can be extended without breaking the core chain.

Natural extensions include:

- execution results and timestamps
- screenshots, traces, and videos
- defect links
- requirement-management IDs
- risk scores
- owner approvals
- environment metadata
- LLM-assisted scenario refinement
- API contract coverage

The key invariant should remain stable:

```text
Every business scenario has a traceability record, and every generated or missing coverage decision is explainable.
```

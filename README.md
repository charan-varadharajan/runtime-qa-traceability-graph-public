# Runtime QA Traceability Graph

A CLI-first TypeScript tool that will progressively analyze a website URL and produce runtime QA artifacts such as crawl output, DOM/action inventories, network/API inventories, flow graphs, scenarios, test cases, generated Playwright scripts, traceability JSON, and HTML reports.

## License / Usage

This repository is publicly visible as a portfolio and research prototype.

Copyright (c) 2026 Charan Varadharajan. All rights reserved.

You may view, clone, and run this project for evaluation purposes. Reuse, redistribution, commercial use, or derivative work is not permitted without written permission.

The current implementation validates a URL, attempts a best-effort authenticated session through provided credentials or visible registration, crawls same-origin pages, extracts visible DOM/action inventory, captures page-load network/API inventory, builds a runtime QA flow graph, infers business scenarios, generates deterministic manual test cases, classifies automation feasibility, generates Playwright UI test scripts, generates API smoke tests, builds QA traceability JSON, and writes run metadata.

## Install

```bash
npm install
```

## Run

```bash
npm run analyze -- --url https://example.com
```

Optional flags:

```bash
npm run analyze -- --url https://example.com --maxPages 20
npm run analyze -- --url https://example.com --maxPages 20 --headed
npm run analyze -- --url https://example.com --userName test-user --password test-password
```

Authentication behavior:

- If `--userName` and `--password` are provided, the crawler attempts to log in before crawling.
- If credentials are not provided and a visible register/sign-up/create-account entry point is found, the crawler attempts best-effort registration with generated non-production data, then crawls with that session.
- If neither path is available, or session setup fails, the tool falls back to an anonymous public crawl.
- The result is recorded in `run-metadata.json` and `crawl-result.json` under `authSession`.

Cross-origin behavior:

- The crawler uses a same-origin policy by default.
- Cross-origin URLs are not crawled.
- Skipped external dependencies are reported in `output/cross-origin-dependencies.json` and summarized in `output/run-metadata.json`.

The command writes:

```text
output/run-metadata.json
output/crawl-result.json
output/dom-inventory.json
output/network-inventory.json
output/flow-graph.json
output/business-scenarios.json
output/manual-test-cases.json
output/automation-feasibility.json
output/generated-automation-index.json
output/generated-api-test-index.json
output/qa-traceability.json
output/execution-results.json
output/qa-traceability-executed.json
output/report.html
output/cross-origin-dependencies.json
generated-tests/ui/*.spec.ts
generated-tests/api/*.spec.ts
```

## Scripts

- `npm run build` compiles TypeScript to `dist/`.
- `npm run analyze -- --url https://example.com` crawls same-origin pages and writes DOM/action inventory, network/API inventory, a flow graph, inferred business scenarios, manual test cases, automation feasibility classifications, and generated Playwright UI specs.
- `npm run test:generated-ui` runs the generated Playwright UI specs.
- `npm run test:generated-api` runs the generated Playwright API smoke specs.
- `npm run execute:generated` runs generated UI/API specs, writes execution results, and updates traceability with business validation decisions.
- `npm test` currently runs the TypeScript build as a smoke test.

## Current Scope

Implemented now:

- TypeScript project skeleton
- Playwright dependency
- CLI entry point
- URL validation
- Run metadata output
- Same-origin URL crawler
- Best-effort login/registration session setup
- Crawl result output
- Visible DOM/action inventory extraction
- Page-load network/API inventory capture
- Runtime QA flow graph generation
- Deterministic business scenario inference
- Deterministic manual test case generation
- Deterministic automation feasibility classification
- Deterministic Playwright UI script generation
- Deterministic API smoke test generation
- Scenario-centered QA traceability JSON
- Generated test execution result ingestion
- Static HTML business report
- Cross-origin dependency reporting
- Core domain types

Not implemented yet:

- LLM integration
- Database

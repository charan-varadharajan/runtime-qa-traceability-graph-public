/**
 * Runtime QA Traceability Graph
 * Copyright (c) 2026 Charan Varadharajan.
 * All rights reserved.
 */

import type {
  CrawlResult,
  CrossOriginDependency,
  CrossOriginDependencyInventory
} from "../types/index.js";

export interface GenerateCrossOriginDependenciesOptions {
  crawlResult: CrawlResult;
  sourceCrawlPath: string;
}

export function generateCrossOriginDependencies(
  options: GenerateCrossOriginDependenciesOptions
): CrossOriginDependencyInventory {
  const startedAt = new Date().toISOString();
  const dependencies = createDependencies(options.crawlResult);
  const completedAt = new Date().toISOString();

  return {
    sourceCrawlPath: options.sourceCrawlPath,
    generatedAt: completedAt,
    policy: "same_origin_only",
    dependencies,
    summary: {
      totalUrls: dependencies.length,
      uniqueOrigins: new Set(dependencies.map((dependency) => dependency.origin)).size,
      byOrigin: countBy(dependencies, (dependency) => dependency.origin),
      startedAt,
      completedAt
    }
  };
}

function createDependencies(crawlResult: CrawlResult): CrossOriginDependency[] {
  const seen = new Set<string>();
  const dependencies: CrossOriginDependency[] = [];

  for (const skippedUrl of crawlResult.skippedUrls) {
    if (skippedUrl.reason !== "cross-origin") {
      continue;
    }

    const origin = getOrigin(skippedUrl.url);
    const key = `${origin}:${skippedUrl.url}`;

    if (!origin || seen.has(key)) {
      continue;
    }

    seen.add(key);
    dependencies.push({
      origin,
      url: skippedUrl.url,
      reason: "cross-origin",
      handling: "not_crawled",
      recommendation:
        "Not crawled under the default same-origin policy. Run a separate analysis or introduce an explicit origin allowlist before testing this dependency."
    });
  }

  return dependencies.sort((a, b) => {
    const originComparison = a.origin.localeCompare(b.origin);
    return originComparison !== 0 ? originComparison : a.url.localeCompare(b.url);
  });
}

function getOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/**
 * Unified discovery for R2-CONSUMER-JOBS-01..08 (+ compose acquisition status).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_SCHEMA } from "./contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, "..");
export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

export const REPO_PATHS = Object.freeze({
  s137: "experiments/s137-consumer-evidence-jobs",
  job07: "experiments/scale-r2-20260910/consumer_jobs/07",
  job08: "experiments/scale-r2-20260910/consumer_jobs/08",
  compose: "experiments/scale-r2-20260910/consumer_jobs/compose",
});

export const KIT_PATHS = Object.freeze({
  s137: "vendor/s137-consumer-evidence-jobs",
  job07: "vendor/consumer-jobs-07",
  job08: "vendor/consumer-jobs-08",
  compose: "vendor/consumer-jobs-compose",
});

const S137_JOBS = [
  {
    jobId: "R2-CONSUMER-JOBS-01",
    artifactId: "migration-checklist",
    title: "Documentation migration checklist",
    aliases: ["01", "migration", "docs-migration"],
    fixtureDir: "fixtures/synthetic/migration",
    examples: {
      positive: "cases/positive-complete.json",
      partial: "cases/partial-batch-undocumented.json",
      negative: "cases/negative-malformed-inventory.json",
      conflict: "cases/conflict-challenge-resource.json",
    },
    runner: "s137",
  },
  {
    jobId: "R2-CONSUMER-JOBS-02",
    artifactId: "release-brief",
    title: "Release evidence brief",
    aliases: ["02", "release", "brief"],
    fixtureDir: "fixtures/synthetic/release-brief",
    examples: {
      positive: "cases/positive-aligned.json",
      partial: "cases/partial-announced-only.json",
      negative: "cases/negative-draft-only.json",
      conflict: "cases/conflict-sha-mismatch.json",
    },
    runner: "s137",
    preservesS174Regression: true,
  },
  {
    jobId: "R2-CONSUMER-JOBS-03",
    artifactId: "table-reconcile",
    title: "Research table reconciliation",
    aliases: ["03", "reconcile", "table"],
    fixtureDir: "fixtures/synthetic/table-reconcile",
    examples: {
      positive: "cases/positive-agree.json",
      partial: "cases/partial-row-coverage.json",
      negative: "cases/negative-empty.json",
      conflict: "cases/conflict-value.json",
    },
    runner: "s137",
  },
  {
    jobId: "R2-CONSUMER-JOBS-04",
    artifactId: "link-index",
    title: "Link-to-artifact index",
    aliases: ["04", "links", "index"],
    fixtureDir: "fixtures/synthetic/link-index",
    examples: {
      positive: "cases/positive-md",
      partial: "cases/partial-mixed",
      negative: "cases/negative-empty",
      conflict: "cases/conflict-duplicates",
    },
    runner: "s137",
  },
  {
    jobId: "R2-CONSUMER-JOBS-05",
    artifactId: "replay-pack",
    title: "API example replay pack",
    aliases: ["05", "replay", "examples"],
    fixtureDir: "fixtures/synthetic/replay-pack",
    examples: {
      positive: "cases/positive-unpaid-complete",
      partial: "cases/partial-mixed-operations",
      negative: "cases/negative-paid-marker",
      conflict: "cases/conflict-example-mismatch",
    },
    runner: "s137",
  },
  {
    jobId: "R2-CONSUMER-JOBS-06",
    artifactId: "freshness-receipt",
    title: "Dataset freshness receipt",
    aliases: ["06", "freshness", "receipt"],
    fixtureDir: "fixtures/synthetic/freshness",
    examples: {
      positive: "cases/positive-complete.json",
      partial: "cases/partial-missing-source-update.json",
      negative: "cases/negative-missing-times.json",
      conflict: "cases/conflict-two-source-updates.json",
    },
    runner: "s137",
  },
];

const JOB_07 = {
  jobId: "R2-CONSUMER-JOBS-07",
  artifactId: "procurement-brief",
  title: "Evidence-based procurement brief",
  aliases: ["07", "procurement"],
  fixtureDir: "fixtures",
  examples: {
    positive: "positive.json",
    partial: "partial-missing-price.json",
    negative: "negative-malformed.json",
    conflict: "external-cost.json",
  },
  runner: "job07",
};

const JOB_08 = {
  jobId: "R2-CONSUMER-JOBS-08",
  artifactId: "customer-result-package",
  title: "Thin customer result package",
  aliases: ["08", "customer-result", "assemble"],
  fixtureDir: "fixtures",
  examples: {
    positive: "positive-journey.json",
    partial: "partial-missing-heavy.json",
    negative: "negative-unknown-recipe.json",
  },
  runner: "job08",
};

const COMPOSE = {
  jobId: "R2-CONSUMER-COMPOSE-ACQUIRE",
  artifactId: "acquisition-status",
  title: "Buyer acquisition status (compose)",
  aliases: ["acquire", "acquisition", "compose-status"],
  fixtureDir: "fixtures",
  examples: {
    positive: "partial-journey.json",
    partial: "partial-journey.json",
    negative: "rejected-package.json",
  },
  runner: "compose",
  note: "Partial packageStatus is acquisition-ok; does not invent Heavy passes.",
};

export function resolveLayout(options = {}) {
  if (options.layout === "kit" || options.kitRoot) {
    return {
      kind: "kit",
      root: options.kitRoot || options.root || PACKAGE_ROOT,
      paths: KIT_PATHS,
    };
  }
  return {
    kind: "repo",
    root: options.root || REPO_ROOT,
    paths: REPO_PATHS,
  };
}

export function abs(layout, key, ...parts) {
  return join(layout.root, layout.paths[key], ...parts);
}

export function buildCatalog(options = {}) {
  const layout = resolveLayout(options);
  const jobs = [...S137_JOBS, JOB_07, JOB_08, COMPOSE].map((job) => {
    const rootKey =
      job.runner === "s137"
        ? "s137"
        : job.runner === "job07"
          ? "job07"
          : job.runner === "job08"
            ? "job08"
            : "compose";
    const moduleRoot = abs(layout, rootKey);
    const cli =
      job.runner === "s137"
        ? join(moduleRoot, "scripts", "cli.mjs")
        : join(moduleRoot, "src", "cli.mjs");
    return {
      ...job,
      moduleRoot,
      fixtureRoot: join(moduleRoot, job.fixtureDir),
      cli,
      coverage: {
        positive: true,
        partialOrNegative: true,
        repeatInput: true,
        cli: true,
        directImport: true,
      },
    };
  });
  return {
    schema: CATALOG_SCHEMA,
    layout: layout.kind,
    offline: true,
    payment: { attempted: false },
    jobs,
    summary: {
      jobCount: jobs.length,
      evidenceJobs: 6,
      botJobs: 2,
      composeJobs: 1,
    },
  };
}

export function findJob(token, options = {}) {
  const catalog = buildCatalog(options);
  const t = String(token || "").trim().toLowerCase();
  if (!t) return null;
  for (const job of catalog.jobs) {
    if (job.jobId.toLowerCase() === t) return job;
    if (job.artifactId.toLowerCase() === t) return job;
    if ((job.aliases || []).some((a) => String(a).toLowerCase() === t)) return job;
  }
  const m = /^(?:r2-consumer-jobs-)?0?([1-8])$/.exec(t);
  if (m) {
    const id = `R2-CONSUMER-JOBS-${m[1].padStart(2, "0")}`;
    return catalog.jobs.find((j) => j.jobId === id) || null;
  }
  return null;
}

export { S137_JOBS, JOB_07, JOB_08, COMPOSE };

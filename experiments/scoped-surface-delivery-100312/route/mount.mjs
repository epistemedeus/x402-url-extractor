import fs from "node:fs";
import express from "express";

import { runScan } from "../src/adapter.mjs";
import { budgetFromLimits } from "../src/budget.mjs";
import { ensurePublicScanner } from "../src/hydrate.mjs";
import { openJournal } from "../src/journal.mjs";
import { viewStoredReport } from "../src/local-report.mjs";
import { proposePrice } from "../src/price.mjs";
import { PUBLIC_LIMITS } from "../src/pins.mjs";
import { createRetention } from "../src/regression.mjs";
import { rerun } from "../src/retest.mjs";
import { authorityMatches } from "../src/scanner-pin.mjs";

const BLOCKED = new Set(["accepted", "paymentReceipt", "txHash", "grant", "ownerId", "paid", "reward", "command", "shell"]);

function envelope(body, status = 200) {
  return {
    status,
    body: {
      charged: false,
      paymentSent: false,
      paymentPerformed: false,
      publishedPrice: false,
      skuAdded: false,
      http200IsWork: false,
      recognizedRevenueAtomic: "0",
      cash: "unknown",
      tokens: "unknown",
      profit: "unknown",
      universalGuarantee: false,
      blanketSafetyScore: null,
      ...body,
    },
  };
}

function blocked(value) {
  return value && typeof value === "object" && Object.keys(value).some((key) => BLOCKED.has(key));
}

function limitResponse(reason, extra = {}, status = 403) {
  const packed = envelope({
    retained: false,
    authorized: false,
    scanPerformed: false,
    authority: "none",
    reason,
    exitCode: 65,
    limits: PUBLIC_LIMITS,
    ...extra,
  }, status);
  return packed;
}

export function mountScopedSurfaceDelivery(app, options = {}) {
  const skillguardRoot = typeof options.skillguardRoot === "string" ? options.skillguardRoot : null;
  const scannerReady = Boolean(skillguardRoot);
  const scan = (request, scanOptions = {}) => runScan(request, {
    skillguardRoot,
    budget: scanOptions.budget || null,
    childScript: scanOptions.childScript,
  });
  scan.skillguardRoot = skillguardRoot;

  let journal = null;
  if (typeof options.journalDir === "string" && options.journalDir.length > 0) {
    try {
      journal = openJournal(options.journalDir);
    } catch {
      journal = null;
    }
  }
  const authorityFile = typeof options.authorityFile === "string" && authorityMatches(options.authorityFile)
    ? options.authorityFile
    : null;
  const retention = journal && authorityFile
    ? createRetention({
      journal,
      authorityFile,
      clock: options.clock || (() => new Date().toISOString()),
      scan,
      skillguardRoot,
    })
    : null;
  const retentionReason = !journal
    ? "retention_not_enrolled"
    : (!authorityFile ? "retention_authority_unavailable" : null);

  function requireScanner(res) {
    if (scannerReady && fs.existsSync(skillguardRoot)) return true;
    const packed = limitResponse("scanner_not_hydrated", {
      fetchedOnRequest: false,
      limits: [
        "The public scanner artifact is not on this host.",
        "This route did not fetch or install source.",
        ...PUBLIC_LIMITS,
      ],
    }, 503);
    res.status(packed.status).json(packed.body);
    return false;
  }

  app.post("/commerce/scoped-surface-scan", async (req, res) => {
    if (!requireScanner(res)) return undefined;
    if (blocked(req.body)) {
      const packed = envelope({ scanPerformed: false, authority: "none", exitCode: 64, inputError: { errors: ["payment_or_label_is_not_a_grant"] }, universalGuarantee: false, blanketSafetyScore: null }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const budget = budgetFromLimits(req.body?.limits);
    const report = await scan(req.body, { budget });
    let priorContinuation = null;
    if (journal && report.scanPerformed === true) {
      try {
        priorContinuation = journal.rememberPrior({
          taskId: req.body.taskId,
          callerId: req.body.callerId,
          contextId: req.body.contextId,
          concern: req.body.concern,
          files: req.body.files,
          ...(req.body.limits ? { limits: req.body.limits } : {}),
        });
      } catch {
        priorContinuation = null;
      }
    }
    const packed = envelope({ report, priorContinuation, priorBound: Boolean(priorContinuation) });
    return res.status(report.exitCode === 64 ? 400 : packed.status).json(packed.body);
  });

  app.post("/commerce/scoped-surface-retest", async (req, res) => {
    if (!requireScanner(res)) return undefined;
    if (req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
      const packed = limitResponse("malformed_retention", { inputError: { errors: ["malformed"] } }, 400);
      return res.status(packed.status).json(packed.body);
    }
    if (blocked(req.body) || blocked(req.body.request) || blocked(req.body.original) || blocked(req.body.previous)) {
      const packed = envelope({ authority: "none", exitCode: 64, inputError: { errors: ["payment_or_label_is_not_a_grant"] } }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const budget = budgetFromLimits(req.body.request?.limits || req.body.original?.limits);
    const result = await rerun({
      previous: req.body.previous,
      original: req.body.original,
      request: req.body.request,
      prior: req.body.prior,
    }, { skillguardRoot, budget, journal });
    const packed = envelope({ retest: result });
    return res.status(result.exitCode === 64 ? 400 : 200).json(packed.body);
  });

  app.post("/commerce/scoped-surface-retain", async (req, res) => {
    if (req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
      const packed = limitResponse("malformed_retention", {}, 400);
      return res.status(packed.status).json(packed.body);
    }
    if (!retention) {
      const packed = limitResponse(retentionReason || "retention_not_enrolled");
      return res.status(packed.status).json(packed.body);
    }
    if (blocked(req.body) || blocked(req.body.request) || blocked(req.body.original) || blocked(req.body.previous)) {
      const packed = envelope({ retained: false, authority: "none", exitCode: 64, reason: "payment_or_label_is_not_a_grant" }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const result = await retention.retain({
      previous: req.body.previous,
      original: req.body.original,
      request: req.body.request,
      share: req.body.share,
      budget: budgetFromLimits(req.body.request?.limits || req.body.original?.limits),
    });
    const status = result.retained ? 200 : (result.exitCode === 64 ? 400 : 403);
    return res.status(status).json(envelope(result).body);
  });

  app.get("/commerce/scoped-surface-regression/:id", async (req, res) => {
    if (typeof req.query.ownerContinuation === "string") {
      const packed = limitResponse("credential_in_url", {}, 400);
      return res.status(packed.status).json(packed.body);
    }
    if (!retention) {
      const packed = limitResponse(retentionReason || "retention_not_enrolled");
      return res.status(packed.status).json(packed.body);
    }
    const result = await retention.read(req.params.id, {
      contextId: typeof req.query.context === "string" ? req.query.context : null,
    });
    return res.status(result.authorized ? 200 : 403).json(envelope(result).body);
  });

  app.post("/commerce/scoped-surface-regression/:id", async (req, res) => {
    if (typeof req.query.ownerContinuation === "string") {
      const packed = limitResponse("credential_in_url", {}, 400);
      return res.status(packed.status).json(packed.body);
    }
    if (req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
      const packed = limitResponse("malformed_retention", {}, 400);
      return res.status(packed.status).json(packed.body);
    }
    if (!retention) {
      const packed = limitResponse(retentionReason || "retention_not_enrolled");
      return res.status(packed.status).json(packed.body);
    }
    const action = req.body.action;
    const outcome = action === "revoke"
      ? retention.revoke({ id: req.params.id, ownerContinuation: req.body.ownerContinuation })
      : action === "correct"
        ? retention.correct({
          id: req.params.id,
          ownerContinuation: req.body.ownerContinuation,
          statement: req.body.statement,
          expiresAt: req.body.expiresAt,
        })
        : { corrected: false, revoked: false, reason: "unknown_action", authority: "none" };
    const ok = outcome.revoked === true || outcome.corrected === true;
    return res.status(ok ? 200 : 403).json(envelope(outcome).body);
  });

  app.post("/commerce/scoped-surface-local-report", (req, res) => {
    if (!requireScanner(res)) return undefined;
    const viewed = viewStoredReport(req.body?.report, skillguardRoot);
    return res.status(200).json(envelope({ report: viewed, scanPerformed: false }).body);
  });

  app.get("/commerce/scoped-surface-price", (req, res) => {
    const proposal = proposePrice({
      internalToken: options.internalToken || null,
      taskId: "scoped-surface-scan",
      measurement: options.measurement || null,
    });
    return res.status(200).json(envelope({ proposal }).body);
  });

  return { retention, scan, journal, scannerReady, retentionEnrolled: Boolean(retention), retentionReason };
}

export async function createIsolatedApp(options = {}) {
  let skillguardRoot = options.skillguardRoot || null;
  if (!skillguardRoot && options.hydratePublic !== false) {
    try {
      skillguardRoot = (await ensurePublicScanner()).skillguardRoot;
    } catch {
      skillguardRoot = null;
    }
  }
  const app = express();
  app.use(express.json({ limit: "300kb" }));
  const mounted = mountScopedSurfaceDelivery(app, {
    skillguardRoot,
    authorityFile: options.authorityFile || null,
    journalDir: options.journalDir || null,
    clock: options.clock,
    internalToken: options.internalToken || null,
    measurement: options.measurement || null,
  });
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && Object.hasOwn(error, "body")) {
      const packed = limitResponse("malformed_retention", { parseError: true }, 400);
      res.status(packed.status).json(packed.body);
      return;
    }
    next(error);
  });
  return { app, ...mounted, skillguardRoot, authorityFile: options.authorityFile || null };
}

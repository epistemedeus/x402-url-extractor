import express from "express";

import { runScan } from "../src/adapter.mjs";
import { ensurePins } from "../src/hydrate.mjs";
import { viewStoredReport } from "../src/local-report.mjs";
import { proposePrice } from "../src/price.mjs";
import { createRetention } from "../src/regression.mjs";
import { rerun } from "../src/retest.mjs";

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
      ...body,
    },
  };
}

function blocked(value) {
  return value && typeof value === "object" && Object.keys(value).some((key) => BLOCKED.has(key));
}

export function mountScopedSurfaceDelivery(app, options) {
  const scan = (request) => runScan(request, { skillguardRoot: options.skillguardRoot });
  scan.skillguardRoot = options.skillguardRoot;
  const retention = createRetention({
    journalDir: options.journalDir,
    authorityFile: options.authorityFile,
    clock: options.clock || (() => new Date().toISOString()),
    scan,
  });

  app.post("/commerce/scoped-surface-scan", async (req, res) => {
    if (blocked(req.body)) {
      const packed = envelope({ scanPerformed: false, authority: "none", exitCode: 64, inputError: { errors: ["payment_or_label_is_not_a_grant"] }, universalGuarantee: false, blanketSafetyScore: null }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const report = await scan(req.body);
    const packed = envelope({ report });
    return res.status(report.exitCode === 64 ? 400 : packed.status).json(packed.body);
  });

  app.post("/commerce/scoped-surface-retest", async (req, res) => {
    if (blocked(req.body) || blocked(req.body?.request) || blocked(req.body?.previous)) {
      const packed = envelope({ authority: "none", exitCode: 64, inputError: { errors: ["payment_or_label_is_not_a_grant"] } }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const result = await rerun(req.body?.previous, req.body?.request, { skillguardRoot: options.skillguardRoot });
    const packed = envelope({ retest: result });
    return res.status(result.exitCode === 64 ? 400 : 200).json(packed.body);
  });

  app.post("/commerce/scoped-surface-retain", async (req, res) => {
    if (blocked(req.body) || blocked(req.body?.request)) {
      const packed = envelope({ retained: false, authority: "none", exitCode: 64, reason: "payment_or_label_is_not_a_grant" }, 400);
      return res.status(packed.status).json(packed.body);
    }
    const result = await retention.retain({
      previous: req.body?.previous,
      request: req.body?.request,
      share: req.body?.share,
    });
    const status = result.retained ? 200 : 403;
    return res.status(status).json(envelope(result).body);
  });

  app.get("/commerce/scoped-surface-regression/:id", async (req, res) => {
    const result = await retention.read(req.params.id, {
      contextId: typeof req.query.context === "string" ? req.query.context : null,
    });
    return res.status(result.authorized ? 200 : 403).json(envelope(result).body);
  });

  app.post("/commerce/scoped-surface-local-report", (req, res) => {
    const viewed = viewStoredReport(req.body?.report, options.skillguardRoot);
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

  return { retention, scan };
}

export async function createIsolatedApp(options = {}) {
  const pins = options.skillguardRoot ? options : { ...options, ...(await ensurePins()) };
  const app = express();
  app.use(express.json({ limit: "300kb" }));
  const mounted = mountScopedSurfaceDelivery(app, {
    skillguardRoot: pins.skillguardRoot,
    authorityFile: pins.authorityFile,
    journalDir: options.journalDir,
    clock: options.clock,
    internalToken: options.internalToken || null,
    measurement: options.measurement || null,
  });
  return { app, ...mounted, ...pins };
}

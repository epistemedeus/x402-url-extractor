// Read-only machine projection for the N5 merchant composition head.
// Compares installed runtime facts with the prepared source pin.
// Does not deploy, mutate Railway, or invent coverage from absence.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECTION_SCHEMA = "samedaydesk.merchant-composition-projection.v1";
export const PROJECTION_KIND = "merchant_composition_prepared_vs_installed";

// Installed observation from Pilot STATE (dated). Re-read before any effect.
export const INSTALLED = Object.freeze({
  commit: "360fa586",
  railwayService: "9f5ed48b",
  runtimeVersion: "1.23.55",
  mppAtInstall: "off",
  note: "Railway preflight facts are dated; re-read before any effect.",
});

// Prepared Bot-authored composition head (keep as pushed; suite pending Console route).
export const PREPARED = Object.freeze({
  branch: "codex/n5-merchant-baseline-reliability-20261105",
  commit: "f23acb762a2b9c2e5c37f50930343a3c49bfa3c0",
  tree: "6889e0f7a19b55faff5ebaf50de6c32af04c43eb",
  parentReliability: "7475eaad",
  compositionBase: "75d1a89c",
  compositionTree: "b3bdcd2a",
  runtimeVersion: "1.23.55",
  configuredMppWalletEnrichCovered: true,
  suiteStatus: "pending_console_model_free_vm",
});

export const CLAIM_PATHS = Object.freeze([
  "wallet-enrich.mjs",
  "wallet-enrich-contract.http.test.mjs",
  "package.json",
  "server.json",
  "plugins/samedaydesk-x402/plugin.json",
]);

const DECISIONS = new Set([
  "blocked_suite",
  "ready_remote_suite",
  "do_not_deploy",
  "re_read_railway_before_effect",
]);

function sha256File(root, rel) {
  const bytes = readFileSync(path.join(root, rel));
  return {
    path: rel,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function loadClaimFiles(root = path.dirname(fileURLToPath(import.meta.url))) {
  // Caller passes repo root. Defaulting to this file's directory is wrong for
  // nested docs/, so require an explicit root in production callers.
  if (root.includes("docs/reviews/n5-merchant-composition-projection-20261105")) {
    throw new Error("projection_root_must_be_repo");
  }
  return CLAIM_PATHS.map((rel) => sha256File(root, rel));
}

export function projectMerchantComposition({
  installed = INSTALLED,
  prepared = PREPARED,
  claimFiles = null,
  suiteReceived = false,
  railwayReread = false,
} = {}) {
  if (!installed?.commit || !prepared?.commit) {
    throw new Error("projection_pins_required");
  }
  if (prepared.runtimeVersion !== installed.runtimeVersion) {
    throw new Error("projection_runtime_version_drift");
  }

  const gaps = [];
  if (installed.commit !== prepared.commit) {
    gaps.push({
      code: "source_ahead_of_install",
      installed: installed.commit,
      prepared: prepared.commit,
    });
  }
  if (prepared.configuredMppWalletEnrichCovered !== true) {
    gaps.push({ code: "configured_mpp_wallet_enrich_uncovered" });
  }
  if (prepared.suiteStatus === "pending_console_model_free_vm" && !suiteReceived) {
    gaps.push({ code: "suite_pending_console_route" });
  }
  if (!railwayReread) {
    gaps.push({
      code: "railway_preflight_dated",
      detail: installed.note,
    });
  }
  if (installed.mppAtInstall === "off" && prepared.configuredMppWalletEnrichCovered === true) {
    gaps.push({
      code: "install_mpp_off_prepared_covers_configured",
      detail: "source covers configured MPP schema parity; install observation remains MPP off",
    });
  }

  let decision = "do_not_deploy";
  if (!suiteReceived) decision = "blocked_suite";
  else if (!railwayReread) decision = "re_read_railway_before_effect";
  else decision = "ready_remote_suite";
  if (!DECISIONS.has(decision)) throw new Error("projection_decision_invalid");

  return Object.freeze({
    schema: PROJECTION_SCHEMA,
    kind: PROJECTION_KIND,
    decision,
    installed: Object.freeze({ ...installed }),
    prepared: Object.freeze({ ...prepared }),
    claimFiles: claimFiles == null ? null : Object.freeze(claimFiles.map((row) => Object.freeze({ ...row }))),
    gaps: Object.freeze(gaps.map((g) => Object.freeze({ ...g }))),
    authority: Object.freeze({
      deploy: "root",
      humanPages: "operator",
      money: "root",
      ordinaryMachineCorrection: "team_after_independent_receiving",
    }),
    recognizedRevenueAtomic: "0",
  });
}

export function assertProjectionHonest(projection) {
  if (projection?.schema !== PROJECTION_SCHEMA) throw new Error("projection_schema");
  if (projection.recognizedRevenueAtomic !== "0") throw new Error("projection_revenue_invented");
  if (projection.decision === "do_not_deploy" || projection.decision === "blocked_suite") {
    return;
  }
  if (projection.gaps.some((g) => g.code === "suite_pending_console_route")) {
    throw new Error("projection_suite_gap_with_ready_decision");
  }
}

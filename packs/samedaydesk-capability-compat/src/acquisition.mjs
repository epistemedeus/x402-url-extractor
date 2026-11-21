import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIN } from "./map.mjs";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const referencePath = join(fixturesDir, "hosted-acquisition-reference.json");

export function loadHostedAcquisitionReference() {
  return JSON.parse(readFileSync(referencePath, "utf8"));
}

function step(name, started, extra = {}) {
  return {
    name,
    wallMs: Number((performance.now() - started).toFixed(3)),
    ...extra,
  };
}

export function compareInstalledVsHosted({ installedTarballPath = null, packDirectory = null } = {}) {
  const started = performance.now();
  const steps = [];
  const hosted = loadHostedAcquisitionReference();

  const hostedStarted = performance.now();
  const hostedArtifacts = hosted.artifacts || [];
  const hostedBytes = hostedArtifacts.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  steps.push(step("load-hosted-reference", hostedStarted, {
    path: "fixtures/hosted-acquisition-reference.json",
    artifactCount: hostedArtifacts.length,
    bytes: hostedBytes,
    neoSha: hosted.neomorphicSha,
    liveClaimed: false,
    network: false,
  }));

  const installedStarted = performance.now();
  let installedBytes = null;
  let installedPath = installedTarballPath;
  if (!installedPath && packDirectory) {
    installedPath = join(packDirectory, "samedaydesk-capability-compat-0.1.0.tgz");
  }
  if (installedPath) {
    try {
      installedBytes = statSync(installedPath).size;
    } catch {
      installedBytes = null;
    }
  }
  steps.push(step("measure-installed-tarball", installedStarted, {
    path: installedPath,
    bytes: installedBytes,
    present: installedBytes !== null,
  }));

  return {
    usefulResult: "comparison-recorded",
    charged: false,
    liveClaimed: false,
    network: false,
    documentedHostedEntry: PIN.documentedHostedEntry,
    documentedHostedEntryLive: PIN.documentedHostedEntryLive,
    hosted: {
      repo: "epistemedeus/neomorphic-io",
      sha: hosted.neomorphicSha,
      bytes: hostedBytes,
      artifacts: hostedArtifacts,
      note: hosted.note,
    },
    installed: {
      path: installedPath,
      bytes: installedBytes,
    },
    steps,
    wallMs: Number((performance.now() - started).toFixed(3)),
    bytes: {
      hosted: hostedBytes,
      installed: installedBytes,
    },
  };
}

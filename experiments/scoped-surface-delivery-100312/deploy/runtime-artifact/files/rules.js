// One catalog for rule id, severity, label, and correction text.
// The published schema and validateReport both read this table.

export const RULE_CATALOG = [
  {
    id: "env-dump",
    severities: ["warn", "danger"],
    label: "Full-environment serialization near a network call (review where it goes; `JSON.stringify(process.env)` etc.)",
    correction: "Remove full-environment serialization from the network path, or remove the network call. Then re-scan this target.",
  },
  {
    id: "env-exfil",
    severities: ["danger"],
    label: "Secret sent to a suspicious destination (sensitive env var + a known exfil host)",
    correction: "Remove the sensitive environment name from any file that also names a known exfil host. Then re-scan this target.",
  },
  {
    id: "exfil-host",
    severities: ["danger"],
    label: "Network call to a known exfiltration service (webhook.site / pastebin / ngrok / telegram bot)",
    correction: "Remove the network call that targets a known exfil host. Then re-scan this target.",
  },
  {
    id: "obfuscation",
    severities: ["danger"],
    label: "Obfuscated remote code execution (eval(atob(...)), base64 -d | sh, powershell -enc)",
    correction: "Remove decoded or encoded command execution from this file. Then re-scan this target.",
  },
  {
    id: "shell-pipe",
    severities: ["warn"],
    label: "Pipe-to-shell (`curl … | bash`) — runs remote code; fine for official installers, risky from unknown hosts",
    correction: "Replace the pipe-to-shell with a reviewed installer, or delete it. Then re-scan this target.",
  },
  {
    id: "forced-artifact",
    severities: ["danger"],
    label: "Honeypot pattern: build step that generates/commits an encrypted artifact",
    correction: "Remove the honeypot build step from this file. Then re-scan this target.",
  },
  {
    id: "secret-literal",
    severities: ["danger"],
    label: "Hardcoded credential / private key committed in the repo",
    correction: "Rotate the credential and delete the literal from this file. Then re-scan this target.",
  },
  {
    id: "prompt-injection",
    severities: ["warn", "danger"],
    label: "Prompt-injection / data-exfil instruction in text (high risk in SKILL.md / tool descriptions; in changelogs/READMEs it may just be docs discussing it)",
    correction: "Remove text that overrides earlier operator instructions or tells the agent to hide its actions. Then re-scan this target.",
  },
  {
    id: "dangerous-perms",
    severities: ["warn"],
    label: "Auto-approve-all / sandbox-disabling / skip-permissions configuration",
    correction: "Remove auto-approve-all, sandbox bypass, or skip-permissions settings. Then re-scan this target.",
  },
  {
    id: "install-hook",
    severities: ["warn"],
    label: "Install-time script hook (pre/postinstall) — runs code on `npm install`",
    correction: "Remove the install-time script hook, or move it to a manual documented step. Then re-scan this target.",
  },
  {
    id: "committed-binary",
    severities: ["danger"],
    label: "Committed executable binary (a compiled artifact that the build may run)",
    correction: "Remove the committed executable from the tree. Then re-scan this target.",
  },
  {
    id: "symlink-escape",
    severities: ["warn"],
    label: "Symlink resolves outside the scan root and was not read",
    correction: "Remove the symlink that resolves outside the scanned tree. The scanner does not read that target. Then re-scan.",
  },
];

export function ruleById(id) {
  return RULE_CATALOG.find((rule) => rule.id === id) || null;
}

export function labelFor(id) {
  const rule = ruleById(id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule.label;
}

export function correctionFor(id) {
  const rule = ruleById(id);
  if (!rule) return null;
  return rule.correction;
}

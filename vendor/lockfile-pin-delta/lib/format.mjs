function shortIntegrity(value) {
  if (!value) return "(missing)";
  if (value.length <= 28) return value;
  return `${value.slice(0, 20)}...`;
}

function pinLine(pin) {
  const name = pin.name || pin.id;
  const version = pin.version || "(no version)";
  const resolved = pin.resolved || "(no resolved)";
  return `\`${name}@${version}\` at \`${pin.id}\` integrity ${shortIntegrity(pin.integrity)} resolved ${resolved}`;
}

export function toMarkdown(report) {
  const lines = [
    "# Lockfile pin delta",
    "",
    `Status: **${report.status}**`,
    "",
    `Lockfile versions: before ${report.lockfileVersion.before}, after ${report.lockfileVersion.after}.`,
    `Maps: before ${report.mapSource.before}, after ${report.mapSource.after}.`,
    `Pins: before ${report.counts.beforePins}, after ${report.counts.afterPins}.`,
    `Added ${report.counts.added}, removed ${report.counts.removed}, changed ${report.counts.changed}.`,
    `Unchanged packages omitted (${report.counts.unchanged}).`,
    "",
  ];

  if (report.caller?.sampleLabel) {
    lines.push(`Caller label: ${report.caller.sampleLabel} (not a customer sale).`, "");
  }

  if (report.changed.length) {
    lines.push("## Changed", "");
    for (const item of report.changed) {
      lines.push(`- \`${item.name}\` at \`${item.id}\``);
      if (item.changeKinds.includes("version")) {
        lines.push(`  - version: ${item.before.version} -> ${item.after.version}`);
      }
      if (item.changeKinds.includes("integrity")) {
        lines.push(
          `  - integrity: ${shortIntegrity(item.before.integrity)} -> ${shortIntegrity(item.after.integrity)}`,
        );
      }
      if (item.changeKinds.includes("name")) {
        lines.push(`  - name: ${item.before.name} -> ${item.after.name}`);
      }
      if (item.changeKinds.includes("resolved")) {
        lines.push(`  - resolved: ${item.before.resolved} -> ${item.after.resolved}`);
        if (item.before.gitCommit || item.after.gitCommit) {
          lines.push(`  - gitCommit: ${item.before.gitCommit} -> ${item.after.gitCommit}`);
        }
      }
      lines.push(`  - termsHash: ${item.before.termsHash} -> ${item.after.termsHash}`);
    }
    lines.push("");
  }

  if (report.added.length) {
    lines.push("## Added", "");
    for (const pin of report.added) lines.push(`- ${pinLine(pin)}`);
    lines.push("");
  }

  if (report.removed.length) {
    lines.push("## Removed", "");
    for (const pin of report.removed) lines.push(`- ${pinLine(pin)}`);
    lines.push("");
  }

  if (report.gaps.length) {
    lines.push("## Gaps", "");
    for (const gap of report.gaps) lines.push(`- ${gap}`);
    lines.push("");
  }

  lines.push(
    "Offline lockfile JSON parse only. Not an npm install, audit, purchase, or settlement.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

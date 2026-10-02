export function readNdjson(text) {
  const rows = [];
  let truncated = 0;
  const lines = String(text ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      truncated += 1;
      rows.push({
        schema: "samedaydesk.useful-economics.observation.v1",
        eventId: `truncated-${truncated}`,
        operationId: "truncated-record",
        stage: "task_discovery",
        sourceClass: "unknown",
        authority: "unknown",
        truncated: true,
        incomplete: true,
        useful: "unknown",
      });
    }
  }
  return { rows, truncated };
}

export function readJson(text) {
  try {
    return { value: JSON.parse(text), truncated: false };
  } catch {
    return { value: null, truncated: true };
  }
}

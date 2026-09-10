#!/usr/bin/env node
import { parseCli, usage } from "./lib/args.mjs";
import { writeJsonFile } from "./lib/io.mjs";
import { packetToStdout, refuseOverwritePrior, runCommand } from "./lib/pipeline.mjs";

const parsed = parseCli(process.argv.slice(2));

if (parsed.help && parsed.ok) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

if (!parsed.ok) {
  if (parsed.error) process.stderr.write(`${parsed.error}\n`);
  if (parsed.help) process.stderr.write(`\n${usage()}\n`);
  process.exit(parsed.exitCode ?? 2);
}

const blocked = refuseOverwritePrior(parsed.input);
if (blocked) {
  process.stderr.write(`${blocked.message}\n`);
  const packet = await runCommand(parsed.command, { ...parsed.input, outPath: null });
  packet.ok = false;
  packet.error = { code: blocked.code, message: blocked.message };
  process.stdout.write(packetToStdout(packet, { compact: parsed.input.compact }));
  process.exit(1);
}

const packet = await runCommand(parsed.command, parsed.input);

const missing = (packet.summary?.unknownReasons || []).filter((row) =>
  String(row).startsWith("missing_module:"),
);
if (missing.length > 0) {
  process.stderr.write(
    `s127 upgrade-impact: ${missing.length} src module(s) missing; stages marked unknown. See packet.pipeline.modules\n`,
  );
}

if (parsed.input.outPath) {
  packet.persisted = { ok: true, path: parsed.input.outPath, bytes: null };
  const written = writeJsonFile(parsed.input.outPath, packet, { compact: parsed.input.compact });
  packet.persisted.bytes = written.bytes;
}

process.stdout.write(packetToStdout(packet, { compact: parsed.input.compact }));
process.exit(packet.ok ? 0 : 1);

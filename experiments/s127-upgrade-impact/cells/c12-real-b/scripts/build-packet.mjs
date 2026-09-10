import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCaseBPacket } from "../lib/packet.mjs";
import { CELL_ROOT } from "../lib/paths.mjs";

const packet = buildCaseBPacket();
const out = join(CELL_ROOT, "packet.v1.json");
mkdirSync(CELL_ROOT, { recursive: true });
writeFileSync(out, JSON.stringify(packet, null, 2) + "\n");
process.stdout.write(`${out}\nnextAction=${packet.summary.nextAction}\n`);

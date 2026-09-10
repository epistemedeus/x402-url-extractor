#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCaseCPacket } from "../lib/packet.mjs";
import { CELL_ROOT } from "../lib/paths.mjs";

const packet = buildCaseCPacket();
const out = join(CELL_ROOT, "packet.v1.json");
writeFileSync(out, JSON.stringify(packet, null, 2) + "\n");
process.stdout.write(
  `wrote ${out}\nnextAction=${packet.summary.nextAction} dualCjsEsm=${packet.packaging?.dualCjsEsmGained}\n`,
);

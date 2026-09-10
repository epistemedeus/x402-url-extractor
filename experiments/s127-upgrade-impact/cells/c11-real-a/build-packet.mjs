#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { buildPacket, FROZEN_CLOCK } from "./lib/packet.mjs";
import { PATHS } from "./lib/paths.mjs";

const clock = process.env.CLOCK || FROZEN_CLOCK;
const packet = buildPacket({ clock, createdAt: clock });
writeFileSync(PATHS.packetOut, JSON.stringify(packet, null, 2) + "\n");
process.stdout.write(
  `wrote ${PATHS.packetOut}\nnextAction=${packet.summary.nextAction} actionable=${packet.summary.actionableChanges.join(",")}\n`,
);

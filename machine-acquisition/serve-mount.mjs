#!/usr/bin/env node
import express from "express";

import { acquisitionIndexSkill, mountMachineAcquisition } from "../machine-acquisition.mjs";
import { mountWellKnownSkills } from "../well-known-skills.mjs";

const port = Number(process.env.PORT || "0");
const publicUrl = process.env.PUBLIC_URL || "https://agents.samedaydesk.com";
const recipient = process.env.PAY_TO || "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const app = express();
app.disable("x-powered-by");
mountMachineAcquisition(app, { publicUrl });
mountWellKnownSkills(app, {
  publicUrl,
  extraIndexSkills: [acquisitionIndexSkill({ recipient })],
});
const server = app.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`machine-acquisition-mount ${address.port}\n`);
});

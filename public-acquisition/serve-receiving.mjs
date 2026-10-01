#!/usr/bin/env node
import express from "express";

import { mountPublicAcquisition } from "./engine.mjs";

const port = Number(process.env.PORT || "0");
const app = express();
app.disable("x-powered-by");
const server = app.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const publicUrl = process.env.PUBLIC_URL || `http://127.0.0.1:${address.port}`;
  mountPublicAcquisition(app, { publicUrl });
  process.stdout.write(`public-acquisition-mount ${address.port}\n`);
});

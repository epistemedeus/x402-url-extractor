import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = resolve(LIB_DIR, "..");
export const PACK_ROOT = resolve(CELL_ROOT, "../..");
export const PACK_REL = "experiments/s127-upgrade-impact";
export const CELL_REL = "cells/c21-golden-e2e";
export const CLOCK_PATH = join(CELL_ROOT, "CLOCK.txt");
export const GOLDEN_PACKET_PATH = join(CELL_ROOT, "expected/packet.json");
export const GOLDEN_ASSERTIONS_PATH = join(CELL_ROOT, "expected/assertions.json");
export const CASE_PATH = join(CELL_ROOT, "expected/case.json");

export function posixRel(from, to) {
  return relative(from, to).split(sep).join("/");
}

export function packRel(absPath) {
  return posixRel(PACK_ROOT, absPath);
}

export function cellRel(absPath) {
  return posixRel(CELL_ROOT, absPath);
}

export function resolvePackRel(relPath) {
  if (!relPath) return null;
  if (relPath.startsWith("/")) return relPath;
  return join(PACK_ROOT, relPath);
}

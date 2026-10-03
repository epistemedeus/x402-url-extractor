#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { inventoryReleasePrep, proveMasterAdjacency, seedAbsentAuthority, seedSellerBump, seedWrongAssetSet } from './release-prep.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const seeds = new Set(['wrong-asset-set', 'seller-bump', 'absent-authority']);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error('missing_option_value:' + name);
  return value;
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

let seed = null;
let out = null;
try {
  seed = option('--seed');
  out = option('--out');
} catch (error) {
  fail(error.message);
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--seed' || args[i] === '--out') { i += 1; continue; }
  fail('unknown_argument:' + args[i]);
}
if (seed && !seeds.has(seed)) fail('unknown_seed:' + seed);

const report = seed === 'wrong-asset-set' ? seedWrongAssetSet(root)
  : seed === 'seller-bump' ? seedSellerBump(root)
  : seed === 'absent-authority' ? seedAbsentAuthority()
  : { ...inventoryReleasePrep(root), adjacency: proveMasterAdjacency(root) };

if (!seed) report.ok = report.ok === true && report.adjacency?.ok === true;
if (out) writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');

if (seed) {
  const unchanged = seed === 'seller-bump' ? report.sellerUnchanged === true
    : seed === 'wrong-asset-set' ? report.manifestUnchanged === true
    : report.wrote === false;
  if (report.rejected !== true || report.wrote !== false || !unchanged) process.exit(1);
  if (seed === 'wrong-asset-set' && report.reason !== 'wrong_asset_set') process.exit(1);
  if (seed === 'seller-bump' && report.reason !== 'frozen_seller_bump_rejected') process.exit(1);
  if (seed === 'absent-authority' && report.reason !== 'repair_authority_absent') process.exit(1);
  process.exit(2);
}
process.exit(report.ok ? 0 : 1);

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  CLAIM_ASSETS, CLAIM_FILES, COLD_COMMANDS, SELLER,
  inventoryReleasePrep, judgeAssetSet, judgeSellerBump, loadClaimAssets, proveMasterAdjacency,
} from './release-prep.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const cli = path.join(import.meta.dirname, 'release-prep-check.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
}

test('inventory holds the 11-file 5-asset claim, six cold commands, and seller 0.4.1', () => {
  const report = inventoryReleasePrep(root);
  assert.equal(report.ok, true, JSON.stringify(report.problems));
  assert.equal(report.files.length, 11);
  assert.equal(CLAIM_FILES.length, 11);
  assert.equal(report.assets.length, 5);
  assert.equal(CLAIM_ASSETS.length, 5);
  assert.equal(report.coldCommands.length, 6);
  assert.deepEqual(report.coldCommands, COLD_COMMANDS);
  assert.equal(report.seller.version, '0.4.1');
  assert.equal(report.seller.bytes, 40891);
  assert.equal(report.seller.sha256, SELLER.sha256);
  assert.equal(report.seller.sealed.sealed, true);
  assert.equal(report.auditPriceAtomic, '10000');
  assert.equal(report.auditRoute, '/commerce/seller-integrity-audit');
  assert.equal(report.manifestAssets, 21);
  assert.equal(report.authority.reason, 'repair_authority_absent');
  assert.equal(report.authority.acceptanceReason, 'acceptance_authority_unavailable');
  assert.equal(report.authority.authorized, false);
  assert.equal(report.authority.paymentPerformed, false);
  assert.equal(report.authority.verifyCalls, 0);
  assert.equal(report.authority.settleCalls, 0);
  assert.equal(report.deployed, false);
  assert.equal(report.productionHosted, false);
});

test('wrong asset set is rejected and the manifest is not written', () => {
  const held = judgeAssetSet(loadClaimAssets(root));
  assert.equal(held.rejected, false);
  assert.equal(held.reason, 'claim_assets_held');
  const mismatch = loadClaimAssets(root).map((asset, index) => index === 3 ? { ...asset, sha256: '0'.repeat(64) } : asset);
  assert.equal(judgeAssetSet(mismatch).reason, 'wrong_asset_set');
  assert.equal(judgeAssetSet(loadClaimAssets(root).slice(1)).reason, 'wrong_asset_set');
  const seeded = runCli(['--seed', 'wrong-asset-set']);
  assert.equal(seeded.status, 2, seeded.stderr || seeded.stdout);
  const body = JSON.parse(seeded.stdout);
  assert.equal(body.reason, 'wrong_asset_set');
  assert.equal(body.rejected, true);
  assert.equal(body.wrote, false);
  assert.equal(body.manifestUnchanged, true);
  assert.equal(body.problems.some(problem => problem.code === 'count' || problem.code === 'unexpected_path'), true);
});

test('frozen seller bump attempt is rejected and the sealed archive stays 0.4.1', () => {
  const held = judgeSellerBump({
    version: '0.4.1', bytes: 40891, sha256: SELLER.sha256, sku: SELLER.sku, priceAtomic: '10000',
  });
  assert.equal(held.rejected, false);
  assert.equal(held.wrote, false);
  const sku = judgeSellerBump({
    version: '0.4.1', bytes: 40891, sha256: SELLER.sha256, sku: 'seller-repair-external-consumer-0.4.2', priceAtomic: '10000',
  });
  assert.equal(sku.reason, 'frozen_seller_bump_rejected');
  assert.equal(sku.violations.includes('sku'), true);
  const seeded = runCli(['--seed', 'seller-bump']);
  assert.equal(seeded.status, 2, seeded.stderr || seeded.stdout);
  const body = JSON.parse(seeded.stdout);
  assert.equal(body.reason, 'frozen_seller_bump_rejected');
  assert.equal(body.wrote, false);
  assert.equal(body.sellerUnchanged, true);
  assert.equal(body.sellerVersion, '0.4.1');
  assert.equal(body.paymentPerformed, false);
  assert.equal(body.violations.includes('seller_version'), true);
  assert.equal(body.violations.includes('price'), true);
  assert.equal(body.violations.includes('sku'), true);
});

test('absent repair authority is rejected by the real acceptance gate', () => {
  const seeded = runCli(['--seed', 'absent-authority']);
  assert.equal(seeded.status, 2, seeded.stderr || seeded.stdout);
  const body = JSON.parse(seeded.stdout);
  assert.equal(body.reason, 'repair_authority_absent');
  assert.equal(body.acceptanceReason, 'acceptance_authority_unavailable');
  assert.equal(body.authorized, false);
  assert.equal(body.paymentPerformed, false);
  assert.equal(body.implementationAuthorized, false);
  assert.equal(body.verifyCalls, 0);
  assert.equal(body.settleCalls, 0);
  assert.equal(body.wrote, false);
});

test('claim patch applies on current master and leaves seller 0.4.1 unchanged', { timeout: 60000 }, () => {
  const adjacency = proveMasterAdjacency(root);
  assert.equal(adjacency.ok, true, JSON.stringify(adjacency.problems));
  assert.equal(adjacency.master, '015f07d5a75d02a4e74709b17b2b1176501e92a5');
  assert.equal(adjacency.liveMaster, adjacency.master);
  assert.equal(adjacency.sellerUnchanged, true);
  assert.equal(adjacency.sellerAfter.sha256, SELLER.sha256);
  assert.equal(adjacency.sellerAfter.bytes, 40891);
  assert.equal(adjacency.masterAssets, 17);
  assert.equal(adjacency.integratedAssets, 21);
  assert.equal(adjacency.masterColdCommands, 5);
  assert.equal(adjacency.integratedColdCommands, 6);
  assert.equal(adjacency.claimPaths.length, 16);
  assert.equal(adjacency.deployed, false);
});

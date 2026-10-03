import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AUDIT_PRICE, AUDIT_ROUTE, checkAcceptance } from '../../../task-linked-delivery/experiments/scoped-repair-commerce-100348/src/authority.mjs';

export const SOURCE_SHA = '64ba4887916a159edb7a06daef045e505683dd77';
export const MASTER_SHA = '015f07d5a75d02a4e74709b17b2b1176501e92a5';
export const PATCH_SHA256 = '8210e2ad2dd831fd7c827f33f862d1cd10363a6c26d50edc5bb98b996984d8b6';
export const PATCH_REL = 'docs/reviews/sol398-scoped-repair/CURRENT-MASTER-INTEGRATION.patch';

// Seller contract surface stays on the sealed 0.4.1 archive and the existing
// $0.01 seller-integrity audit. Release-prep must not advance either one.
export const SELLER = {
  id: 'seller-repair-external-consumer',
  version: '0.4.1',
  sku: 'seller-repair-external-consumer',
  filename: 'seller-repair-external-consumer-0.4.1.tar.gz',
  relativePath: 'public-acquisition/bytes/seller-repair-external-consumer/0.4.1/seller-repair-external-consumer-0.4.1.tar.gz',
  bytes: 40891,
  sha256: '64dbe1ee7f69dd40ebf71741eed92f1f3f893c44af8eadf18b71c0fac82227b8',
  auditPriceAtomic: '10000',
  auditRoute: '/commerce/seller-integrity-audit',
};

export const CLAIM_FILES = [
  { path: 'commerce-events.mjs', bytes: 168717, sha256: '68a345384aeacd3b7ff5ca3aab0fd335b1b71ad57b6f10bb1b922abfc9a53a57' },
  { path: 'server.js', bytes: 249077, sha256: '723d8fde99cd21fdcecc2920aa0ad2284e6b7c2e0dda2db83bc194878a514dd7' },
  { path: 'useful-result-reuse/store.mjs', bytes: 4642, sha256: '791b9096dc37892c61581c95441df767a093c906f42d2e8a403fc43f55d7ea8c' },
  { path: 'experiments/seller-repair-service-100266/src/classify.mjs', bytes: 4337, sha256: 'ca6e23df0b43f114f641acba27b064e49c896583d474ac0898d115239c0e13f3' },
  { path: 'experiments/seller-repair-service-100266/bin/pack-consumer.mjs', bytes: 7402, sha256: '8e58896bc3c8cffef285c6513c5722a4490f7edf4c519f891a34523083c705c2' },
  { path: 'experiments/seller-repair-service-100266/bin/pack-consumer-030.mjs', bytes: 10628, sha256: '1a72b1c0ddda99f36a5684723a6f8e46993ebb6e2342b4fb93ae5902656c1a9b' },
  { path: 'experiments/seller-repair-service-100266/bin/pack-consumer-040.mjs', bytes: 11710, sha256: 'b855281e6d868d5af3cc1f82fa54005d8ee7ea23810961222e2031ecaefe24ca' },
  { path: 'experiments/seller-repair-service-100266/bin/pack-consumer-041.mjs', bytes: 11785, sha256: 'e4a4be83706ae6584fd44df6793219bd033c205d655418ffb7a2e6aa4f0a9f95' },
  { path: 'public-acquisition/manifest.json', bytes: 21421, sha256: '493f94c4a36ae1708fa4ae741bd8c1789110815cb36801540e18507165560f7c' },
  { path: 'public-acquisition/cold-commands.json', bytes: 9128, sha256: '05b986688811daefed6f60baac6fb50a50c16c8c38f6a620d2cf96fc12f90793' },
  { path: 'public-acquisition/engine.test.mjs', bytes: 20371, sha256: '27bbf73ca260f65f9c2337907d16e06d99a3f9db830a4a79bdebe54892b511b7' },
];

export const CLAIM_ASSETS = [
  { path: 'public-acquisition/bytes/scoped-repair-commerce-100348/0.1.2/LICENSE', bytes: 1068, sha256: 'c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c', version: '0.1.2' },
  { path: 'public-acquisition/bytes/scoped-repair-commerce-100348/0.1.2/SOURCE-NOTICE.txt', bytes: 525, sha256: 'a394bc61d96049ce3faed08a0c248b0de05d05bbb4af10d07ab836c6766bedd3', version: '0.1.2' },
  { path: 'public-acquisition/bytes/scoped-repair-commerce-100348/0.1.2/provenance.json', bytes: 8453, sha256: '7febcb560b80a9cdd02a59b419707fe9f4a9a9a2030c8b130da4e399a33c3ca8', version: '0.1.2' },
  { path: 'public-acquisition/bytes/scoped-repair-commerce-100348/0.1.2/scoped-repair-commerce-100348-0.1.2.tar.gz', bytes: 37921, sha256: 'f95db152722ac820d57975cdab9b2bb486888f2faf023dc271b82da5eba84656', version: '0.1.2' },
  { path: 'public-acquisition/inventories/scoped-repair-commerce-100348-0.1.2.json', bytes: 2804, sha256: 'e26fd4e8bdbdd3d9d77ac8cb09db4b01df5c991bb7e609fbf2eeff75b9ad3d77', version: '0.1.2' },
];

export const COLD_COMMANDS = [
  { id: 'composition-route-knowledge', version: '0.1.0', filename: 'composition-route-knowledge-0.1.0.tgz' },
  { id: 'retained-task', version: '0.1.0', filename: 'retained-task-0.1.0.tar.gz' },
  { id: 'l09-next-action', version: '0.1.0', filename: 'l09-next-action-0.1.0.tar.gz' },
  { id: 'seller-repair-external-consumer', version: '0.2.0', filename: 'seller-repair-external-consumer-0.2.0.tar.gz' },
  { id: 'seller-repair-external-consumer', version: '0.4.1', filename: 'seller-repair-external-consumer-0.4.1.tar.gz' },
  { id: 'scoped-repair-commerce-100348', version: '0.1.2', filename: 'scoped-repair-commerce-100348-0.1.2.tar.gz' },
];

if (CLAIM_FILES.length !== 11) throw new Error('claim_file_count');
if (CLAIM_ASSETS.length !== 5) throw new Error('claim_asset_count');
if (COLD_COMMANDS.length !== 6) throw new Error('cold_command_count');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const claimPaths = () => [...CLAIM_FILES, ...CLAIM_ASSETS].map(item => item.path).sort();

function git(cwd, args, timeout = 60000) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4194304 });
}

export function loadClaimAssets(root) {
  return CLAIM_ASSETS.map(pin => {
    const bytes = readFileSync(path.join(root, pin.path));
    return { path: pin.path, bytes: bytes.length, sha256: sha256(bytes), version: pin.version };
  });
}

export function judgeAssetSet(assets) {
  const problems = [];
  if (!Array.isArray(assets)) return { rejected: true, reason: 'wrong_asset_set', problems: [{ code: 'not_an_array' }], wrote: false };
  if (assets.length !== CLAIM_ASSETS.length) problems.push({ code: 'count', expected: CLAIM_ASSETS.length, got: assets.length });
  const seen = new Set();
  for (const asset of assets) {
    const assetPath = typeof asset?.path === 'string' ? asset.path : '';
    if (!assetPath || assetPath.includes('seller-repair-external-consumer') || assetPath.includes('/0.4.2/')) {
      problems.push({ code: 'unexpected_path', path: assetPath || null });
      continue;
    }
    if (asset.version && asset.version !== '0.1.2') problems.push({ code: 'version', path: assetPath, version: asset.version });
    const pin = CLAIM_ASSETS.find(item => item.path === assetPath);
    if (!pin) problems.push({ code: 'unexpected_path', path: assetPath });
    else {
      seen.add(pin.path);
      if (asset.bytes !== pin.bytes || asset.sha256 !== pin.sha256) problems.push({ code: 'mismatch', path: assetPath });
    }
  }
  for (const pin of CLAIM_ASSETS) if (!seen.has(pin.path)) problems.push({ code: 'missing', path: pin.path });
  return { rejected: problems.length > 0, reason: problems.length ? 'wrong_asset_set' : 'claim_assets_held', problems, wrote: false, count: CLAIM_ASSETS.length };
}

export function judgeSellerBump(proposal) {
  const violations = [];
  if (proposal?.version !== SELLER.version) violations.push('seller_version');
  if (proposal?.bytes !== SELLER.bytes) violations.push('seller_bytes');
  if (proposal?.sha256 !== SELLER.sha256) violations.push('seller_sha256');
  if (proposal?.sku !== SELLER.sku) violations.push('sku');
  if (proposal?.priceAtomic !== SELLER.auditPriceAtomic) violations.push('price');
  if (proposal?.auditRoute && proposal.auditRoute !== SELLER.auditRoute) violations.push('audit_route');
  const rejected = violations.length > 0;
  return {
    rejected, reason: rejected ? 'frozen_seller_bump_rejected' : 'seller_0_4_1_held', violations, wrote: false,
    sellerVersion: SELLER.version, deployed: false, paymentPerformed: false,
  };
}

export function passingSellerPacket() {
  return {
    acceptance: { kind: 'seller' },
    observed: { independent: true, useful: true },
    binding: { task: { id: 'release-prep-task', callerId: 'caller-a' } },
  };
}

export function acceptCommand() {
  return { taskId: 'release-prep-task', callerId: 'caller-a', decision: 'accepted' };
}

// Absent repair authority must die in the real acceptance gate. This release
// prep never mints a key, never calls verify, and never calls settle.
export function judgeRepairAuthority(packet, command, authority = {}) {
  const publicKey = authority?.publicKey || null;
  if (publicKey) {
    return {
      rejected: true, reason: 'release_prep_does_not_grant_repair', acceptanceReason: null,
      authorized: false, paymentPerformed: false, implementationAuthorized: false, verifyCalls: 0, settleCalls: 0, wrote: false,
    };
  }
  const acceptance = checkAcceptance(packet, command, { publicKey: null, currentOffer: authority?.currentOffer, now: authority?.now });
  const held = acceptance.reason === 'acceptance_authority_unavailable' && acceptance.authorized === false && acceptance.paymentPerformed === false;
  return {
    rejected: true,
    reason: held ? 'repair_authority_absent' : 'repair_authority_gate_drift',
    acceptanceReason: acceptance.reason,
    authorized: false,
    paymentPerformed: false,
    implementationAuthorized: false,
    verifyCalls: 0,
    settleCalls: 0,
    wrote: false,
  };
}

export function seedWrongAssetSet(root) {
  const manifestPath = path.join(root, 'public-acquisition/manifest.json');
  const before = sha256(readFileSync(manifestPath));
  const proposed = [...loadClaimAssets(root), {
    path: 'public-acquisition/bytes/seller-repair-external-consumer/0.4.2/seller-repair-external-consumer-0.4.2.tar.gz',
    bytes: 12, sha256: '0'.repeat(64), version: '0.4.2',
  }];
  const judgment = judgeAssetSet(proposed);
  return { ...judgment, seed: 'wrong-asset-set', manifestUnchanged: sha256(readFileSync(manifestPath)) === before };
}

export function seedSellerBump(root) {
  const sellerPath = path.join(root, SELLER.relativePath);
  const before = sha256(readFileSync(sellerPath));
  const judgment = judgeSellerBump({
    version: '0.4.2', bytes: SELLER.bytes, sha256: SELLER.sha256,
    sku: 'seller-repair-external-consumer-0.4.2', priceAtomic: '20000', auditRoute: SELLER.auditRoute,
  });
  const after = sha256(readFileSync(sellerPath));
  return { ...judgment, seed: 'seller-bump', sellerUnchanged: before === SELLER.sha256 && after === before };
}

export function seedAbsentAuthority() {
  return { ...judgeRepairAuthority(passingSellerPacket(), acceptCommand(), { publicKey: null, repairAuthority: null }), seed: 'absent-authority' };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
}

export function inventoryReleasePrep(root) {
  const problems = [];
  const files = CLAIM_FILES.map(pin => {
    const bytes = readFileSync(path.join(root, pin.path));
    const got = { path: pin.path, bytes: bytes.length, sha256: sha256(bytes) };
    if (got.bytes !== pin.bytes || got.sha256 !== pin.sha256) problems.push({ code: 'claim_file', path: pin.path });
    return got;
  });
  const assets = loadClaimAssets(root);
  const assetJudgment = judgeAssetSet(assets);
  if (assetJudgment.rejected) problems.push({ code: 'claim_assets', problems: assetJudgment.problems });
  const sellerFile = readFileSync(path.join(root, SELLER.relativePath));
  const sellerProposal = {
    version: SELLER.version, bytes: sellerFile.length, sha256: sha256(sellerFile),
    sku: SELLER.sku, priceAtomic: AUDIT_PRICE, auditRoute: AUDIT_ROUTE,
  };
  const sellerJudgment = judgeSellerBump(sellerProposal);
  if (sellerJudgment.rejected) problems.push({ code: 'seller_freeze', violations: sellerJudgment.violations });
  if (AUDIT_PRICE !== SELLER.auditPriceAtomic || AUDIT_ROUTE !== SELLER.auditRoute) problems.push({ code: 'payment_surface' });
  const manifest = readJson(root, 'public-acquisition/manifest.json');
  const sellerArchives = manifest.assets.filter(asset => asset.id === SELLER.id && asset.role === 'archive' && asset.version === SELLER.version);
  const sellerVersions = [...new Set(manifest.assets.filter(asset => asset.id === SELLER.id).map(asset => asset.version))].sort();
  if (sellerArchives.length !== 1 || sellerArchives[0].bytes !== SELLER.bytes || sellerArchives[0].sha256 !== SELLER.sha256) problems.push({ code: 'seller_manifest' });
  if (sellerVersions.join(',') !== '0.2.0,0.4.1') problems.push({ code: 'seller_versions', sellerVersions });
  if (manifest.assets.some(asset => asset.version === '0.4.2')) problems.push({ code: 'seller_bump_in_manifest' });
  if (manifest.assets.filter(asset => asset.id === 'scoped-repair-commerce-100348').length !== 4) problems.push({ code: 'client_asset_count' });
  if (manifest.assets.length !== 21) problems.push({ code: 'manifest_asset_count', got: manifest.assets.length });
  if (manifest.productionHosted !== false || manifest.hostedAcquisitionVerified !== false || manifest.paidLaunch !== false) problems.push({ code: 'publication_flags' });
  const coldDocument = readJson(root, 'public-acquisition/cold-commands.json');
  const coldCommands = coldDocument.commands.map(command => ({ id: command.id, version: command.version, filename: command.filename }));
  if (JSON.stringify(coldCommands) !== JSON.stringify(COLD_COMMANDS)) problems.push({ code: 'cold_commands' });
  const patchFile = readFileSync(path.join(root, PATCH_REL));
  if (sha256(patchFile) !== PATCH_SHA256) problems.push({ code: 'patch_sha256' });
  for (const args of [['diff', '--name-only', SOURCE_SHA, '--', ...claimPaths()], ['diff', '--cached', '--name-only', '--', ...claimPaths()]]) {
    const dirty = git(root, args);
    if (dirty.status !== 0 || dirty.stdout.trim()) problems.push({ code: 'claim_path_changed_since_pin', args: args.slice(0, 2), detail: (dirty.stdout || dirty.stderr || '').trim() });
  }
  const authority = judgeRepairAuthority(passingSellerPacket(), acceptCommand(), {});
  if (authority.reason !== 'repair_authority_absent') problems.push({ code: 'authority_gate', reason: authority.reason, acceptanceReason: authority.acceptanceReason });
  const packed = spawnSync(process.execPath, ['experiments/seller-repair-service-100266/bin/pack-consumer-041.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  let sealed = null;
  if (packed.status !== 0) problems.push({ code: 'seller_seal_command', detail: (packed.stderr || packed.stdout || '').slice(0, 400) });
  else {
    sealed = JSON.parse(packed.stdout);
    if (sealed.version !== '0.4.1' || sealed.sealed !== true || sealed.bytes !== SELLER.bytes || sealed.sha256 !== SELLER.sha256) problems.push({ code: 'seller_seal_result' });
  }
  return {
    ok: problems.length === 0,
    schema: 'sol398.release-prep.v1',
    sourcePin: SOURCE_SHA,
    masterPin: MASTER_SHA,
    files, assets, coldCommands,
    manifestAssets: manifest.assets.length,
    clientAssets: 4,
    seller: { ...sellerProposal, sealed },
    auditPriceAtomic: AUDIT_PRICE,
    auditRoute: AUDIT_ROUTE,
    patchSha256: sha256(patchFile),
    authority,
    problems,
    productionHosted: false,
    deployed: false,
    paymentPerformed: false,
    verifyCalls: 0,
    settleCalls: 0,
  };
}

export function proveMasterAdjacency(root, { master = MASTER_SHA } = {}) {
  const problems = [];
  const origin = git(root, ['rev-parse', 'refs/remotes/origin/master']);
  const originMaster = (origin.stdout || '').trim();
  if (origin.status !== 0 || originMaster !== master) problems.push({ code: 'fetched_master', originMaster, pinned: master });
  const live = git(root, ['ls-remote', 'origin', 'refs/heads/master'], 30000);
  const liveMaster = live.status === 0 ? (live.stdout || '').split(/\s+/)[0] : '';
  if (live.status !== 0) problems.push({ code: 'live_master_unverified', detail: (live.stderr || '').trim().slice(0, 300) });
  else if (liveMaster !== master) problems.push({ code: 'master_moved', liveMaster, pinned: master });
  const scratch = mkdtempSync(path.join(tmpdir(), 'sol398-master-'));
  const worktree = path.join(scratch, 'wt');
  let sellerBefore = null;
  let sellerAfter = null;
  let claimNames = [];
  let masterAssets = null;
  let masterCold = null;
  let integratedAssets = null;
  let integratedCold = null;
  try {
    const added = git(root, ['worktree', 'add', '--detach', worktree, master]);
    if (added.status !== 0) {
      problems.push({ code: 'worktree_add', detail: (added.stderr || added.stdout || '').trim().slice(0, 400) });
    } else {
      const sellerBytes = readFileSync(path.join(worktree, SELLER.relativePath));
      sellerBefore = { bytes: sellerBytes.length, sha256: sha256(sellerBytes) };
      if (sellerBefore.bytes !== SELLER.bytes || sellerBefore.sha256 !== SELLER.sha256) problems.push({ code: 'master_seller_drift', ...sellerBefore });
      const masterManifest = readJson(worktree, 'public-acquisition/manifest.json');
      const masterCommands = readJson(worktree, 'public-acquisition/cold-commands.json');
      masterAssets = masterManifest.assets.length;
      masterCold = masterCommands.commands.length;
      if (masterManifest.assets.some(asset => asset.id === 'scoped-repair-commerce-100348')) problems.push({ code: 'master_already_has_client' });
      const check = git(worktree, ['apply', '--check', path.join(root, PATCH_REL)]);
      if (check.status !== 0) problems.push({ code: 'patch_check', detail: (check.stderr || check.stdout || '').trim().slice(0, 400) });
      else {
        const applied = git(worktree, ['apply', path.join(root, PATCH_REL)]);
        if (applied.status !== 0) problems.push({ code: 'patch_apply', detail: (applied.stderr || '').trim().slice(0, 400) });
        const afterBytes = readFileSync(path.join(worktree, SELLER.relativePath));
        sellerAfter = { bytes: afterBytes.length, sha256: sha256(afterBytes) };
        if (sellerAfter.sha256 !== SELLER.sha256 || sellerAfter.bytes !== SELLER.bytes) problems.push({ code: 'seller_changed_by_patch', ...sellerAfter });
        if (existsSync(path.join(worktree, 'public-acquisition/bytes/seller-repair-external-consumer/0.4.2'))) problems.push({ code: 'seller_bump_tree' });
        const status = git(worktree, ['status', '--porcelain', '--untracked-files=all']);
        claimNames = (status.stdout || '').split('\n').filter(Boolean).map(line => line.slice(3)).sort();
        const expected = claimPaths();
        if (JSON.stringify(claimNames) !== JSON.stringify(expected)) problems.push({ code: 'claim_path_set', got: claimNames, expected });
        const integratedManifest = readJson(worktree, 'public-acquisition/manifest.json');
        const integratedCommands = readJson(worktree, 'public-acquisition/cold-commands.json');
        integratedAssets = integratedManifest.assets.length;
        integratedCold = integratedCommands.commands.length;
        const addedAssets = integratedManifest.assets.filter(asset => !masterManifest.assets.some(prior => prior.relativePath === asset.relativePath));
        if (addedAssets.length !== 4 || addedAssets.some(asset => asset.id !== 'scoped-repair-commerce-100348' || asset.version !== '0.1.2')) problems.push({ code: 'added_assets', added: addedAssets.map(asset => asset.relativePath) });
        const addedCommands = integratedCommands.commands.filter(command => !masterCommands.commands.some(prior => prior.id === command.id && prior.version === command.version));
        if (addedCommands.length !== 1 || addedCommands[0].id !== 'scoped-repair-commerce-100348' || addedCommands[0].version !== '0.1.2') problems.push({ code: 'added_cold_command' });
        const integratedSellerVersions = [...new Set(integratedManifest.assets.filter(asset => asset.id === SELLER.id).map(asset => asset.version))].sort();
        if (integratedSellerVersions.join(',') !== '0.2.0,0.4.1') problems.push({ code: 'integrated_seller_versions', integratedSellerVersions });
      }
    }
  } finally {
    git(root, ['worktree', 'remove', '--force', worktree]);
    rmSync(scratch, { recursive: true, force: true });
  }
  return {
    ok: problems.length === 0, schema: 'sol398.master-adjacency.v1', master, originMaster, liveMaster: liveMaster || null,
    sellerBefore, sellerAfter, sellerUnchanged: sellerBefore?.sha256 === SELLER.sha256 && sellerAfter?.sha256 === SELLER.sha256,
    masterAssets, integratedAssets, masterColdCommands: masterCold, integratedColdCommands: integratedCold,
    claimPaths: claimNames, problems, deployed: false,
  };
}

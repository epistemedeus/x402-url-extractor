import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node summarize.mjs receipt.json witnesses.json');
const bytes = readFileSync(input);
const report = JSON.parse(bytes);
const witnesses = report.checks.filter(c => !c.passed).map(c => {
  const w = c.witness || {};
  let observed;
  if (c.id.startsWith('F5')) {
    observed = { flag: w.flag, perturbation: w.perturbation, omittedFile: w.omittedFile,
      ready: w.ready, error: w.startupError?.split('\n').find(line => /^\w*Error:/.test(line)) };
  } else if (c.id.startsWith('F6')) {
    const result = w.syntheticPaid || w.result?.retainedBody;
    observed = { raw: w.raw, parsedValues: w.parsedValues, unpaidStatus: w.unpaidStatus ?? w.preflight?.httpStatus,
      httpStatus: result?.httpStatus, charged: result?.charged, analysis: result?.analysis,
      fieldChangeCount: result?.fieldChanges?.length, unchanged: result?.counts?.unchanged,
      maintainedClientOutcome: w.result?.outcome, maintainedClientOutputValid: w.result?.outputValid,
      syntheticSignerCallbackCount: w.syntheticSignerCallbackCount,
      exactBodyPreserved: w.transmitted?.every(r => r.rawBytePreserved) };
  } else if (c.id.includes('purchase-evidence')) {
    observed = { method: w.operation?.method, path: w.operation?.path, receipt: w.operation?.receipt, replay: w.operation?.replay };
  } else if (c.id.includes('deployment')) {
    observed = { signedRoutePresent: w.signedRoutePresent, validAtWallClock: w.validAtWallClock,
      verificationTime: w.verificationTime, expiresAt: w.expiresAt,
      incumbentDecision: w.incumbent?.decision, vendorError: w.vendor?.error };
  } else if (c.id.includes('mcp')) {
    observed = { invalid: w.invalid, schemaAccepts: w.schemaAccepts, directHttpStatus: w.directHttpStatus,
      sdkError: w.call?.code, sdkErrorMessage: w.call?.message, rawMcp: w.rawMcp };
  } else observed = w;
  return { id: c.id, assertion: c.error?.split('\n')[0], observed };
});
writeFileSync(output, JSON.stringify({
  schema: 'cw42.minimal-failing-witnesses.v1', sourceHead: report.sourceHead,
  sourceDigest: report.sourceDigest, harnessHead: report.harnessHead, harnessDigest: report.harnessDigest,
  receiptSha256: createHash('sha256').update(bytes).digest('hex'),
  startedAt: report.startedAt, finishedAt: report.finishedAt, boundaries: report.boundaries,
  sourceUnchanged: report.sourceUnchanged, remainingOwnedChildren: report.remainingOwnedChildren,
  passed: report.passed, failed: report.failed, witnesses,
}, null, 2) + '\n');

import { executeCallerRequest, resolveLater } from '../../../../experiments/seller-repair-service-100266/commercial/caller-request.mjs';
import { allowance, streamJson, writeJson } from './bounds.mjs';

const budget = allowance();
try {
  const command = await streamJson(process.stdin, budget);
  const result = command.prior ? await resolveLater(command.prior, command.input) : await executeCallerRequest(command.input);
  const r = result.receipt;
  const receipt = r ? Object.fromEntries(['classification','observation','retest','resources','expected','missingField','target402'].filter(k => r[k] !== undefined).map(k => [k,r[k]])) : null;
  await writeJson({ executed: result.executed, reason: result.reason, receipt,
    artifact: result.artifact || null, predicateApplies: result.predicateApplies ?? null, predicateReason: result.predicateReason || null }, process.stdout, budget);
} catch (error) {
  process.stdout.write(JSON.stringify({ executed: false, reason: /^[a-z_]{1,80}$/.test(error.code || '') ? error.code : 'seller_execution_failed' }) + '\n');
  process.exitCode = 2;
}

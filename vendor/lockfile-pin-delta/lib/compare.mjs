import { createHashTermsAdapter, pinChangeKinds, pinFieldsEqual } from "./hash-terms.mjs";
import { parseLockfileText } from "./parse-lockfile.mjs";

function publicPin(pin) {
  return {
    id: pin.id,
    name: pin.name,
    version: pin.version,
    integrity: pin.integrity,
    resolved: pin.resolved ?? null,
    gitCommit: pin.gitCommit ?? null,
    termsHash: pin.termsHash,
    missingIntegrity: pin.missingIntegrity,
  };
}

export function comparePinMaps(beforeExtract, afterExtract) {
  const before = new Map(beforeExtract.pins.map((p) => [p.id, p]));
  const after = new Map(afterExtract.pins.map((p) => [p.id, p]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  const missingIds = new Set();
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    if ((b && b.missingIntegrity) || (a && a.missingIntegrity)) missingIds.add(id);
    if (!b && a) {
      added.push(publicPin(a));
      continue;
    }
    if (b && !a) {
      removed.push(publicPin(b));
      continue;
    }
    if (pinFieldsEqual(b, a)) {
      unchanged += 1;
      continue;
    }
    changed.push({
      id,
      name: a.name || b.name,
      before: publicPin(b),
      after: publicPin(a),
      changeKinds: pinChangeKinds(b, a),
    });
  }

  const missingIntegrity = missingIds.size;
  const hasDelta = added.length + removed.length + changed.length > 0;
  const status = missingIntegrity > 0 ? "partial" : hasDelta ? "actionable" : "informational";

  return {
    schema: "samedaydesk.lockfile-pin-delta.v1",
    appId: "lockfile-pin-delta",
    ok: true,
    status,
    purchaseAuthority: false,
    paidValueClaim: false,
    settlement: "nonsettling-prototype",
    equality: "pin-fields",
    lockfileVersion: {
      before: beforeExtract.lockfileVersion,
      after: afterExtract.lockfileVersion,
    },
    mapSource: {
      before: beforeExtract.mapSource,
      after: afterExtract.mapSource,
    },
    counts: {
      beforePins: beforeExtract.pins.length,
      afterPins: afterExtract.pins.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
      missingIntegrity,
    },
    added,
    removed,
    changed,
    gaps:
      missingIntegrity > 0
        ? ["one or more pins lack integrity; treat this delta as partial"]
        : [],
  };
}

export function compareLockfileTexts(beforeText, afterText, options = {}) {
  const adapter = createHashTermsAdapter(options.hashPinTerms);
  const before = parseLockfileText(beforeText, {
    label: options.beforeLabel || "before",
    hashPinTerms: adapter.hashPinTerms,
  });
  const after = parseLockfileText(afterText, {
    label: options.afterLabel || "after",
    hashPinTerms: adapter.hashPinTerms,
  });
  return comparePinMaps(before, after);
}

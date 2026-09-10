import {
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  FREE_ALTERNATIVE_STATE,
  INPUT_SCHEMA,
  PRICE_SOURCE,
} from "./constants.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function briefError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function requireNonEmptyString(value, label, { max = 2000 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} exceeds max length ${max}`);
  }
  return value.trim();
}

function assertNoForbidden(record, label) {
  if (!isPlainObject(record)) return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw briefError(
        ERROR_CODES.FORBIDDEN_CLAIM,
        `${label} declares forbidden field ${key}`,
        { field: key },
      );
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (isPlainObject(v)) assertNoForbidden(v, `${label}.${k}`);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (isPlainObject(item)) assertNoForbidden(item, `${label}.${k}[${i}]`);
      });
    }
  }
}

function normalizeStringList(value, label, { maxItem = 200, maxLen = 64 } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an array when present`);
  }
  if (value.length > maxLen) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} exceeds max length ${maxLen}`);
  }
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    out.push(requireNonEmptyString(value[i], `${label}[${i}]`, { max: maxItem }));
  }
  return [...new Set(out)];
}

/**
 * Normalize task needs: musts / capability ids / outcome strings.
 * Does not invent missing needs.
 */
export function validateTaskNeeds(raw, label = "taskNeeds") {
  if (!isPlainObject(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const musts = normalizeStringList(raw.musts, `${label}.musts`);
  const capabilityIds = normalizeStringList(raw.capabilityIds, `${label}.capabilityIds`);
  const outcomes = normalizeStringList(raw.outcomes, `${label}.outcomes`);

  // Convenience: allow musts to carry capability / outcome strings when arrays are empty.
  const effectiveMusts =
    musts.length > 0 ? musts : [...capabilityIds, ...outcomes].length > 0 ? [...capabilityIds, ...outcomes] : [];

  if (effectiveMusts.length === 0 && capabilityIds.length === 0 && outcomes.length === 0) {
    throw briefError(
      ERROR_CODES.MISSING_REQUIREMENT,
      `${label} needs at least one musts[], capabilityIds[], or outcomes[] entry`,
    );
  }

  return {
    musts: effectiveMusts,
    capabilityIds,
    outcomes,
    notes:
      raw.notes == null
        ? null
        : requireNonEmptyString(String(raw.notes), `${label}.notes`, { max: 1000 }),
  };
}

function normalizeFreeBaseline(raw, label) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an object when present`);
  }
  assertNoForbidden(raw, label);
  const stateRaw = requireNonEmptyString(
    raw.freeAlternativeState ?? raw.state,
    `${label}.freeAlternativeState`,
    { max: 40 },
  ).toLowerCase();
  const allowed = Object.values(FREE_ALTERNATIVE_STATE);
  if (!allowed.includes(stateRaw)) {
    throw briefError(
      ERROR_CODES.INVALID_INPUT,
      `${label}.freeAlternativeState must be one of ${allowed.join(",")}`,
      { state: stateRaw },
    );
  }
  const basisId = requireNonEmptyString(
    raw.freeAlternativeBasisId ?? raw.basisId,
    `${label}.freeAlternativeBasisId`,
    { max: 120 },
  ).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,119}$/.test(basisId)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label}.freeAlternativeBasisId is invalid`);
  }
  return {
    freeAlternativeState: stateRaw,
    freeAlternativeBasisId: basisId,
  };
}

function normalizePrice(raw, label) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an object when present`);
  }
  assertNoForbidden(raw, label);
  const amountAtomic = raw.amountAtomic;
  if (amountAtomic == null || amountAtomic === "") {
    return { amountAtomic: null, currency: null, present: false };
  }
  const amount = String(amountAtomic);
  if (!/^\d+$/.test(amount)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label}.amountAtomic must be non-negative integer string`);
  }
  const currency =
    raw.currency == null
      ? "USDC"
      : requireNonEmptyString(String(raw.currency), `${label}.currency`, { max: 16 });
  return { amountAtomic: amount, currency, present: true };
}

function normalizeExternalCosts(raw, label) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an array when present`);
  }
  return raw.map((item, i) => {
    if (!isPlainObject(item)) {
      throw briefError(ERROR_CODES.INVALID_INPUT, `${label}[${i}] must be an object`);
    }
    assertNoForbidden(item, `${label}[${i}]`);
    return {
      label: requireNonEmptyString(item.label, `${label}[${i}].label`, { max: 200 }),
      amountAtomic:
        item.amountAtomic == null
          ? null
          : (() => {
              const a = String(item.amountAtomic);
              if (!/^\d+$/.test(a)) {
                throw briefError(
                  ERROR_CODES.INVALID_INPUT,
                  `${label}[${i}].amountAtomic must be non-negative integer string`,
                );
              }
              return a;
            })(),
      note:
        item.note == null
          ? null
          : requireNonEmptyString(String(item.note), `${label}[${i}].note`, { max: 500 }),
    };
  });
}

function normalizeEvidenceRefs(raw, label) {
  return normalizeStringList(raw, label, { maxItem: 300, maxLen: 32 });
}

/**
 * Validate one caller-supplied service contract (fixture / dry-run only).
 */
export function validateServiceContract(raw, index = 0) {
  const label = `serviceContracts[${index}]`;
  if (!isPlainObject(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const contractId = requireNonEmptyString(raw.contractId ?? raw.id, `${label}.contractId`, {
    max: 128,
  });
  const title =
    raw.title == null && raw.label == null
      ? contractId
      : requireNonEmptyString(String(raw.title ?? raw.label), `${label}.title`, { max: 240 });

  const capabilityIds = normalizeStringList(raw.capabilityIds, `${label}.capabilityIds`);
  const outcomes = normalizeStringList(raw.outcomes, `${label}.outcomes`);
  const coveredMusts = normalizeStringList(raw.coveredMusts, `${label}.coveredMusts`);

  const price = normalizePrice(raw.price, `${label}.price`);
  const externalCosts = normalizeExternalCosts(raw.externalCosts, `${label}.externalCosts`);
  const hasExternalCostFlag = raw.hasExternalCost === true;

  let priceSource = null;
  if (raw.priceSource != null) {
    priceSource = requireNonEmptyString(String(raw.priceSource), `${label}.priceSource`, {
      max: 120,
    });
  }
  const stale = raw.stale === true;

  const freeBaseline = normalizeFreeBaseline(
    raw.freeBaseline ?? raw.freeAlternative,
    `${label}.freeBaseline`,
  );

  const evidenceRefs = normalizeEvidenceRefs(raw.evidenceRefs, `${label}.evidenceRefs`);

  return {
    contractId,
    title,
    capabilityIds,
    outcomes,
    coveredMusts,
    price,
    externalCosts,
    hasExternalCostFlag,
    priceSource,
    stale,
    freeBaseline,
    evidenceRefs,
  };
}

/**
 * Optional top-level freeBaselines[] keyed by contractId or basisId.
 */
export function validateFreeBaselines(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, "freeBaselines must be an array when present");
  }
  return raw.map((item, i) => {
    const label = `freeBaselines[${i}]`;
    if (!isPlainObject(item)) {
      throw briefError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
    }
    assertNoForbidden(item, label);
    const baseline = normalizeFreeBaseline(item, label);
    const appliesToContractId =
      item.appliesToContractId == null
        ? null
        : requireNonEmptyString(String(item.appliesToContractId), `${label}.appliesToContractId`, {
            max: 128,
          });
    return { ...baseline, appliesToContractId };
  });
}

/**
 * Validate full procurement input. Returns normalized shallow structure.
 */
export function validateProcurementInput(raw) {
  if (!isPlainObject(raw)) {
    throw briefError(ERROR_CODES.INVALID_INPUT, "procurement input must be an object");
  }
  assertNoForbidden(raw, "input");

  if (raw.schema != null && raw.schema !== INPUT_SCHEMA) {
    throw briefError(
      ERROR_CODES.INVALID_INPUT,
      `input.schema must be ${INPUT_SCHEMA} when present`,
    );
  }

  const taskId = requireNonEmptyString(raw.taskId, "taskId", { max: 128 });
  const taskNeeds = validateTaskNeeds(raw.taskNeeds ?? raw.needs, "taskNeeds");

  if (!Array.isArray(raw.serviceContracts)) {
    throw briefError(ERROR_CODES.MISSING_REQUIREMENT, "serviceContracts[] is required");
  }
  if (raw.serviceContracts.length < 1) {
    throw briefError(ERROR_CODES.MISSING_REQUIREMENT, "at least one serviceContracts[] entry is required");
  }

  const serviceContracts = raw.serviceContracts.map((c, i) => validateServiceContract(c, i));
  const freeBaselines = validateFreeBaselines(raw.freeBaselines);

  // Attach top-level free baselines to contracts missing per-contract baseline.
  for (const fb of freeBaselines) {
    if (!fb.appliesToContractId) continue;
    const target = serviceContracts.find((c) => c.contractId === fb.appliesToContractId);
    if (target && !target.freeBaseline) {
      target.freeBaseline = {
        freeAlternativeState: fb.freeAlternativeState,
        freeAlternativeBasisId: fb.freeAlternativeBasisId,
      };
    }
  }

  return {
    schema: INPUT_SCHEMA,
    taskId,
    title:
      raw.title == null
        ? null
        : requireNonEmptyString(String(raw.title), "title", { max: 240 }),
    taskNeeds,
    serviceContracts,
    freeBaselines,
    demo: raw.demo === true,
    sourceLabel:
      raw.sourceLabel == null
        ? null
        : requireNonEmptyString(String(raw.sourceLabel), "sourceLabel", { max: 240 }),
  };
}

export { PRICE_SOURCE };

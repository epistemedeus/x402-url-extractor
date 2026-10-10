import { parseAtomicAmount, parseCount } from "./counts.mjs";
import { assessValue } from "./value-schema.mjs";

const QUERY_METHODS = new Set(["GET", "HEAD", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const BODY_TYPES = new Set(["json", "form-data", "text"]);

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isRetainedProjection(item) {
  return isPlainObject(item)
    && typeof item.resource === "string"
    && !Array.isArray(item.accepts)
    && !isPlainObject(item.extensions)
    && ("hasInput" in item || "inputRequired" in item || "hasOutputSchema" in item);
}

function unknownApplication(gaps, bodyType = null) {
  return {
    applicationConstructible: "unknown",
    fieldsAvailable: "unknown",
    valueSchemaValid: "unknown",
    constructed: null,
    gaps,
    bodyType,
    schemaDialect: null,
    schemaDialectAssumed: false,
    validator: null,
  };
}

function fromValue(result, gaps, bodyType = null) {
  return {
    applicationConstructible: result.applicationConstructible,
    fieldsAvailable: result.fieldsAvailable,
    valueSchemaValid: result.valueSchemaValid,
    constructed: result.constructed,
    gaps: gaps.concat(result.gaps),
    bodyType,
    schemaDialect: result.dialect,
    schemaDialectAssumed: result.dialectAssumed === true,
    validator: result.validator,
  };
}

function inputSchemaError(schema) {
  if (schema === undefined || schema === null) return null;
  if (!isPlainObject(schema)) return "schema-not-object";
  const input = schema.properties ? schema.properties.input : undefined;
  if (input !== undefined && !isPlainObject(input)) return "input-not-object";
  if (!isPlainObject(input)) return null;
  if (input.type !== undefined && input.type !== "object") return "input-type-invalid";
  if (Array.isArray(input.required)) {
    if (!isPlainObject(input.properties)) return "input-properties-missing";
    for (const key of input.required) {
      if (!Object.prototype.hasOwnProperty.call(input.properties, key)) return "required-key-absent";
    }
  }
  const body = isPlainObject(input.properties) ? input.properties.body : undefined;
  if (isPlainObject(body) && Array.isArray(body.required)) {
    if (!isPlainObject(body.properties)) return "body-properties-missing";
    for (const key of body.required) {
      if (!Object.prototype.hasOwnProperty.call(body.properties, key)) return "body-required-key-absent";
    }
  }
  const query = isPlainObject(input.properties) ? input.properties.queryParams : undefined;
  if (isPlainObject(query) && Array.isArray(query.required)) {
    if (!isPlainObject(query.properties)) return "query-properties-missing";
    for (const key of query.required) {
      if (!Object.prototype.hasOwnProperty.call(query.properties, key)) return "query-required-key-absent";
    }
  }
  return null;
}

function assessQuery(inputInfo, inputProps, dialect) {
  const querySchema = inputProps && isPlainObject(inputProps.queryParams) ? inputProps.queryParams : null;
  const example = inputInfo && isPlainObject(inputInfo.queryParams) ? inputInfo.queryParams : null;
  if (!querySchema && !example) return unknownApplication(["query-schema-and-example-absent"]);
  if (!querySchema) return unknownApplication(["query-example-without-required-schema"]);
  const assessed = fromValue(assessValue(querySchema, example, { dialect }), []);
  assessed.constructedQuery = assessed.constructed;
  return assessed;
}

function assessBody(inputInfo, inputProps, dialect) {
  const bodyType = inputInfo && typeof inputInfo.bodyType === "string" ? inputInfo.bodyType : null;
  const bodySchema = inputProps && isPlainObject(inputProps.body) ? inputProps.body : null;
  const example = inputInfo && isPlainObject(inputInfo.body) ? inputInfo.body : null;
  const gaps = [];
  if (!BODY_TYPES.has(bodyType)) gaps.push("body-type-absent");
  if (!bodySchema) return unknownApplication(gaps.concat(["body-schema-absent"]), bodyType);
  if (!Array.isArray(bodySchema.required)) {
    return unknownApplication(gaps.concat(["body-required-list-absent"]), bodyType);
  }
  if (!BODY_TYPES.has(bodyType)) {
    return {
      applicationConstructible: false,
      fieldsAvailable: false,
      valueSchemaValid: false,
      constructed: null,
      gaps,
      bodyType,
      schemaDialect: null,
      schemaDialectAssumed: false,
      validator: null,
    };
  }
  const assessed = fromValue(assessValue(bodySchema, example, { dialect }), gaps, bodyType);
  assessed.constructedBody = assessed.applicationConstructible === true ? assessed.constructed : null;
  if (assessed.applicationConstructible !== true) assessed.constructed = null;
  return assessed;
}

function assessOutput(info, schema) {
  const outputSchema = isPlainObject(schema) && isPlainObject(schema.properties)
    ? schema.properties.output
    : undefined;
  const schemaPresent = isPlainObject(outputSchema);
  const examplePresent = isPlainObject(info) && isPlainObject(info.output) && info.output.example !== undefined;
  return {
    schemaPresent,
    examplePresent,
    schemaRetained: schemaPresent,
    missing: !schemaPresent && !examplePresent,
    executable: false,
  };
}

function assessProjection(item) {
  const reportedSchema = item.hasOutputSchema === true ? true : item.hasOutputSchema === false ? false : "unknown";
  const reportedExample = item.hasOutputExample === true ? true : item.hasOutputExample === false ? false : "unknown";
  return {
    retention: "projection",
    schemaState: "not-retained",
    schemaError: null,
    method: typeof item.method === "string" ? item.method : null,
    bodyType: null,
    applicationConstructible: "unknown",
    fieldsAvailable: "unknown",
    valueSchemaValid: "unknown",
    constructed: null,
    gaps: ["application-body-not-retained"],
    envelopeKeys: Array.isArray(item.inputRequired) ? item.inputRequired.slice() : [],
    output: {
      sourceReportedSchema: reportedSchema,
      sourceReportedExample: reportedExample,
      schemaPresent: false,
      examplePresent: false,
      schemaRetained: false,
      missing: reportedSchema === false && reportedExample === false,
      executable: false,
    },
    priorConstructibleFlag: item.constructible === true ? true : item.constructible === false ? false : "absent",
    priorFlagAdopted: false,
  };
}

export function assessInput(item) {
  if (!isPlainObject(item)) {
    return {
      retention: "invalid",
      schemaState: "invalid",
      schemaError: "resource-not-object",
      method: null,
      bodyType: null,
      applicationConstructible: false,
      fieldsAvailable: false,
      valueSchemaValid: "refused",
      constructed: null,
      gaps: ["resource-not-object"],
      envelopeKeys: [],
      output: {
        schemaPresent: false,
        examplePresent: false,
        schemaRetained: false,
        missing: true,
        executable: false,
      },
      priorConstructibleFlag: "absent",
      priorFlagAdopted: false,
    };
  }
  if (isRetainedProjection(item)) return assessProjection(item);

  const bazaar = isPlainObject(item.extensions) && isPlainObject(item.extensions.bazaar)
    ? item.extensions.bazaar
    : null;
  const info = bazaar && isPlainObject(bazaar.info) ? bazaar.info : null;
  const inputInfo = info && isPlainObject(info.input) ? info.input : null;
  const schema = bazaar ? bazaar.schema : undefined;
  const schemaError = inputSchemaError(schema);
  const method = (inputInfo && typeof inputInfo.method === "string" && inputInfo.method)
    || (typeof item.method === "string" ? item.method : null);
  const inputProps = isPlainObject(schema)
    && isPlainObject(schema.properties)
    && isPlainObject(schema.properties.input)
    && isPlainObject(schema.properties.input.properties)
    ? schema.properties.input.properties
    : null;

  if (schemaError) {
    return {
      retention: "full",
      schemaState: "invalid",
      schemaError,
      method,
      bodyType: inputInfo && inputInfo.bodyType ? inputInfo.bodyType : null,
      applicationConstructible: false,
      fieldsAvailable: false,
      valueSchemaValid: "refused",
      constructed: null,
      gaps: [schemaError],
      envelopeKeys: [],
      output: assessOutput(info, isPlainObject(schema) ? schema : null),
      priorConstructibleFlag: "absent",
      priorFlagAdopted: false,
    };
  }

  const dialect = isPlainObject(schema) && typeof schema.$schema === "string" ? schema.$schema : null;
  let application;
  if (QUERY_METHODS.has(method)) application = assessQuery(inputInfo, inputProps, dialect);
  else if (BODY_METHODS.has(method)) application = assessBody(inputInfo, inputProps, dialect);
  else application = unknownApplication(["method-absent"]);

  return {
    retention: "full",
    schemaState: schema === undefined || schema === null ? "absent" : "present",
    schemaError: null,
    method,
    bodyType: application.bodyType || null,
    applicationConstructible: application.applicationConstructible,
    fieldsAvailable: application.fieldsAvailable,
    valueSchemaValid: application.valueSchemaValid,
    constructed: application.constructed,
    constructedQuery: application.constructedQuery || null,
    constructedBody: application.constructedBody || null,
    schemaDialect: application.schemaDialect,
    schemaDialectAssumed: application.schemaDialectAssumed,
    validator: application.validator,
    gaps: application.gaps,
    envelopeKeys: [],
    output: assessOutput(info, isPlainObject(schema) ? schema : null),
    priorConstructibleFlag: "absent",
    priorFlagAdopted: false,
  };
}

function identityField(value) {
  if (typeof value !== "string") return { state: "absent", value: null };
  if (value.trim() === "") return { state: "invalid", value: null };
  return { state: "present", value };
}

function identityKey(row) {
  return [row.scheme, row.network, row.asset, row.payTo, row.amount, row.declaredSymbol].join("|");
}

function declaredSymbol(accept) {
  const extra = isPlainObject(accept.extra) ? accept.extra : null;
  if (!extra || (extra.name !== "USD" && extra.name !== "USDC")) return null;
  return extra.name;
}

function quotedMoney(accept, symbol) {
  const extra = isPlainObject(accept.extra) ? accept.extra : null;
  if (!extra || !Object.prototype.hasOwnProperty.call(extra, "quotedAmount")) {
    return { state: "absent", value: null };
  }
  if (symbol !== "USD" && symbol !== "USDC") return { state: "invalid", value: null };
  if (typeof extra.quotedAmount !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(extra.quotedAmount)) {
    return { state: "invalid", value: null };
  }
  return { state: "declared", value: extra.quotedAmount };
}

function parseIdentity(accept) {
  const row = isPlainObject(accept) ? accept : {};
  const scheme = identityField(row.scheme);
  const network = identityField(row.network);
  const asset = identityField(row.asset);
  const payTo = identityField(row.payTo);
  const amountAbsent = row.amount === undefined || row.amount === null;
  const amount = amountAbsent ? { state: "absent", value: null } : parseAtomicAmount(row.amount);
  const symbol = declaredSymbol(row);
  const quoted = quotedMoney(row, symbol);
  const suppliedBlank = [row.scheme, row.network, row.asset, row.payTo, row.amount]
    .some((value) => value === "" || (typeof value === "string" && value.trim() === ""));
  const invalid = suppliedBlank
    || scheme.state === "invalid"
    || network.state === "invalid"
    || asset.state === "invalid"
    || payTo.state === "invalid"
    || (!amountAbsent && amount.state !== "exact");
  return {
    state: invalid ? "invalid" : "valid",
    scheme: scheme.value,
    network: network.value,
    asset: asset.value,
    amount: amount.state === "exact" ? amount.value : null,
    payTo: payTo.value,
    units: "source-atomic",
    amountUnit: "atomic",
    amountUnitClass: "atomic",
    declaredSymbol: symbol,
    moneyAmount: quoted.state === "declared" ? quoted.value : null,
    moneyUnit: quoted.state === "declared" ? symbol : null,
    moneyState: quoted.state,
  };
}

export function assessPayment(item) {
  if (!isPlainObject(item) || isRetainedProjection(item)) {
    const projection = isPlainObject(item) && isRetainedProjection(item);
    return {
      complete: false,
      state: projection ? "incomplete" : "unknown",
      acceptCount: projection ? countOrLabel(item.acceptCount) : "unknown",
      amount: projection ? atomicOrNull(item.amount) : null,
      network: projection && typeof item.network === "string" ? item.network : null,
      asset: null,
      assetPresent: projection
        ? item.assetPresent === true ? true : item.assetPresent === false ? false : "unknown"
        : "unknown",
      scheme: null,
      payTo: null,
      units: "source-atomic",
      amountUnit: "atomic",
      amountUnitClass: "atomic",
      declaredSymbol: null,
      moneyAmount: null,
      moneyUnit: null,
      moneyState: "absent",
      identities: [],
      collapsed: false,
    };
  }
  if (!Array.isArray(item.accepts)) {
    return {
      complete: false,
      state: "unknown",
      acceptCount: "unknown",
      amount: null,
      network: null,
      asset: null,
      assetPresent: "unknown",
      scheme: null,
      payTo: null,
      units: "source-atomic",
      amountUnit: "atomic",
      amountUnitClass: "atomic",
      declaredSymbol: null,
      moneyAmount: null,
      moneyUnit: null,
      moneyState: "absent",
      identities: [],
      collapsed: false,
    };
  }
  const identities = item.accepts.map(parseIdentity);
  if (identities.length === 0) {
    return {
      complete: false,
      state: "absent",
      acceptCount: 0,
      amount: null,
      network: null,
      asset: null,
      assetPresent: false,
      scheme: null,
      payTo: null,
      units: "source-atomic",
      amountUnit: "atomic",
      amountUnitClass: "atomic",
      declaredSymbol: null,
      moneyAmount: null,
      moneyUnit: null,
      moneyState: "absent",
      identities,
      collapsed: false,
    };
  }
  if (identities.some((row) => row.state === "invalid")) {
    const firstInvalid = identities[0];
    return {
      complete: false,
      state: "invalid",
      acceptCount: identities.length,
      amount: firstInvalid.amount,
      network: firstInvalid.network,
      asset: firstInvalid.asset,
      assetPresent: identities.some((row) => row.asset !== null),
      scheme: firstInvalid.scheme,
      payTo: firstInvalid.payTo,
      units: "source-atomic",
      amountUnit: "atomic",
      amountUnitClass: "atomic",
      declaredSymbol: identities[0].declaredSymbol,
      moneyAmount: null,
      moneyUnit: null,
      moneyState: identities.some((row) => row.moneyState === "invalid") ? "invalid" : identities[0].moneyState,
      identities,
      collapsed: false,
    };
  }
  const distinct = new Set(identities.map(identityKey));
  const networks = new Set(identities.map((row) => `${row.network}|${row.asset}`));
  let state = "single";
  if (distinct.size > 1 && networks.size > 1) state = "multiple";
  else if (distinct.size > 1) state = "contradictory";
  const first = identities[0];
  const complete = state === "single"
    && first.scheme !== null
    && first.network !== null
    && first.asset !== null
    && first.amount !== null
    && first.payTo !== null;
  return {
    complete,
    state: complete ? state : state === "single" ? "incomplete" : state,
    acceptCount: identities.length,
    amount: first.amount,
    network: first.network,
    asset: first.asset,
    assetPresent: identities.some((row) => row.asset !== null),
    scheme: first.scheme,
    payTo: first.payTo,
    units: "source-atomic",
    amountUnit: "atomic",
    amountUnitClass: "atomic",
    declaredSymbol: identities.every((row) => row.declaredSymbol === first.declaredSymbol) ? first.declaredSymbol : null,
    moneyAmount: complete && first.moneyState === "declared" ? first.moneyAmount : null,
    moneyUnit: complete && first.moneyState === "declared" ? first.moneyUnit : null,
    moneyState: identities.some((row) => row.moneyState === "invalid")
      ? "invalid"
      : first.moneyState,
    identities,
    collapsed: false,
  };
}

function countOrLabel(value) {
  if (value === undefined || value === null) return "unknown";
  const parsed = parseCount(value);
  return parsed.state === "measured" ? parsed.value : "invalid";
}

function atomicOrNull(value) {
  if (value === undefined || value === null) return null;
  const parsed = parseAtomicAmount(value);
  return parsed.state === "exact" ? parsed.value : null;
}

export function reportedCalls(item) {
  const meaning = "source-reported calls are separate from query visibility";
  if (!isPlainObject(item) || !isPlainObject(item.quality) || !("l30DaysTotalCalls" in item.quality)) {
    return { state: "unknown", value: null, meaning };
  }
  const parsed = parseCount(item.quality.l30DaysTotalCalls);
  if (parsed.state === "measured") return { state: "measured", value: String(parsed.value), meaning };
  if (parsed.state === "unknown") return { state: "unknown", value: null, meaning };
  return { state: "invalid", value: null, meaning };
}

export function requestConstructible(input, payment) {
  return input.applicationConstructible === true && payment.complete === true && payment.state === "single";
}

export function sourceClock(lastUpdated, observedAt, staleAfterMs) {
  if (typeof lastUpdated !== "string" || lastUpdated.length === 0) {
    return { lastUpdated: null, freshness: "unknown", reason: "source-clock-missing", ageMs: null };
  }
  const sourceMs = Date.parse(lastUpdated);
  if (Number.isNaN(sourceMs)) {
    return { lastUpdated, freshness: "unknown", reason: "source-clock-invalid", ageMs: null };
  }
  if (typeof observedAt !== "string" || observedAt.length === 0) {
    return { lastUpdated, freshness: "unknown", reason: "observation-clock-missing", ageMs: null };
  }
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) {
    return { lastUpdated, freshness: "unknown", reason: "observation-clock-invalid", ageMs: null };
  }
  const ageMs = observedMs - sourceMs;
  if (typeof staleAfterMs === "number") {
    if (ageMs > staleAfterMs) {
      return { lastUpdated, freshness: "stale", reason: "older-than-caller-window", ageMs };
    }
    if (ageMs >= 0) return { lastUpdated, freshness: "within-window", reason: null, ageMs };
    return { lastUpdated, freshness: "source-clock-after-observation", reason: null, ageMs };
  }
  return { lastUpdated, freshness: "known", reason: null, ageMs };
}

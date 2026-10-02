import { applyOverlay, outputMatches } from "./paths.mjs";
import { declaredRequiredPaths } from "./declaration.mjs";

export function reproductionCommand() {
  return "node experiments/seller-repair-service-100266/bin/seller-repair.mjs reproduce --case experiments/seller-repair-service-100266/cases/retained-case.json";
}

export function repairInstructions(patch) {
  const instructions = Array.isArray(patch?.instructions) ? patch.instructions.filter((item) => typeof item === "string") : [];
  return {
    kind: patch?.kind || "response_overlay",
    instructions,
    responseOverlay: patch?.responseOverlay && typeof patch.responseOverlay === "object" ? patch.responseOverlay : null,
    dropsRequiredPaths: Array.isArray(patch?.dropRequiredPaths) ? patch.dropRequiredPaths : [],
    schemaMutationApplied: false,
    sellerRuntimeVerified: false,
  };
}

export function projectRepairedBody(body, patch) {
  if (!patch || patch.kind === "incorrect") return body && typeof body === "object" ? structuredClone(body) : body;
  if (patch.kind === "incomplete") return applyOverlay(body, patch.responseOverlay || {});
  return applyOverlay(body, patch.responseOverlay || {});
}

export function projectRepairedDeclaration(document, route, method, patch) {
  if (!document || patch?.kind !== "incorrect") return declaredRequiredPaths(document, route, method);
  const copy = structuredClone(document);
  const operation = copy.paths?.[route]?.[method.toLowerCase()];
  const schema = operation?.responses?.["200"]?.content?.["application/json"]?.schema;
  const result = schema?.properties?.result;
  if (result && Array.isArray(patch.dropRequiredPaths)) {
    const drop = new Set(patch.dropRequiredPaths.map((path) => path.split(".").pop()));
    result.required = (result.required || []).filter((key) => !drop.has(key));
  }
  return declaredRequiredPaths(copy, route, method);
}

export function judgeRepair({ patch, beforeBody, document, route, method, expected, retestObserved }) {
  const instructions = repairInstructions(patch);
  if (!patch) return { useful: false, reason: "repair_not_supplied", instructions, independent: true };
  if (patch.kind === "incorrect") {
    const declaration = projectRepairedDeclaration(document, route, method, patch);
    const matched = outputMatches(retestObserved, expected);
    return {
      useful: false,
      reason: "declaration_edit_is_not_useful_output",
      outputMatched: matched,
      declarationRequiredPaths: declaration.requiredPaths,
      instructions,
      independent: true,
      http200IsSuccess: false,
    };
  }
  const projected = projectRepairedBody(beforeBody, patch);
  const projectedPaths = retestObserved?.paths || [];
  const matched = outputMatches(retestObserved, expected);
  const projectionAgrees = expected.paths.every((path) => {
    const live = retestObserved?.values?.[path];
    const wanted = path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), projected);
    return live === wanted && projectedPaths.includes(path);
  });
  if (!matched || !projectionAgrees) {
    return {
      useful: false,
      reason: patch.kind === "incomplete" ? "repair_incomplete" : "repair_not_useful",
      instructions,
      independent: true,
      http200IsSuccess: false,
    };
  }
  return {
    useful: true,
    reason: "retest_matched",
    instructions,
    independent: true,
    http200IsSuccess: false,
  };
}

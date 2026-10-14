import { requireThat } from "./boundary.mjs";

/** A amend whose CapturePort / FundingAuthority this consumer was checked against. Not joined. */
export const RAIL_INTERFACE_COMMIT = "f89939a09feaf6b710d04abf8109c4a0b790f05c";

export const COMMERCE_PIN = Object.freeze({
  kind: "commerce_payments",
  repository: "https://github.com/base/commerce-payments",
  tag: "v1.1.0",
  commit: "6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9",
  abiSha256: "4eadfac88b44c0ff00c9274f98821031f6600145e57800d8ced405f2452c03d5",
});

/**
 * Shape of CommercePaymentsRail at the A amend, without constructing it.
 * readback/capture are CapturePort. readProof/stage/authorityId are the rail's funding surface.
 * Real chain join stays pending-join for A3/B3.
 */
export function assertPendingJoinPort(port) {
  requireThat(port && typeof port.readback === "function" && typeof port.capture === "function", "port_shape");
  requireThat(typeof port.readProof === "function" && typeof port.stage === "function", "port_shape");
  requireThat(port.protocol?.kind === "commerce_payments", "port_shape");
  requireThat(port.protocol?.commit === COMMERCE_PIN.commit, "port_shape");
  requireThat(port.protocol?.abiSha256 === COMMERCE_PIN.abiSha256, "port_shape");
  requireThat(port.qualification !== "local_chain" && port.qualification !== "production", "port_shape");
  requireThat(!("authorityId" in port) || port.authorityId === null || typeof port.authorityId === "string", "port_shape");
}

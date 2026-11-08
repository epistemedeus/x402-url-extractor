import { z } from "zod";

// Preserve the merchant's integer contract. Zod 4's .int() also adds a
// safe-integer range, while the existing JSON schemas set ranges separately.
export function merchantInteger() {
  return z.number().refine(Number.isInteger, "Expected integer, received float");
}

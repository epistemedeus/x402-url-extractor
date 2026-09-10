import { gamma } from "type-kit";
import type { Beta } from "type-kit";

export function run(value: string): string {
  return gamma(value);
}

export type CallerBeta = Beta;

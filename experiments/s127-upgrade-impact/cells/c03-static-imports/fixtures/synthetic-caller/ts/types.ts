import type { Alpha } from "example-dep";
import { type Beta, gamma } from "example-dep";
import { delta } from "example-dep";
export type { Alpha };
export function use(x: Alpha): Alpha {
  return x;
}
export { gamma, delta };

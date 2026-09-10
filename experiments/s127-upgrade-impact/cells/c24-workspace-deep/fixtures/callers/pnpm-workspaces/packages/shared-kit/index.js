import { coreTag } from "shared-kit-core";

export function format(value) {
  return String(value);
}

export function localOnly() {
  return `workspace:${coreTag()}`;
}

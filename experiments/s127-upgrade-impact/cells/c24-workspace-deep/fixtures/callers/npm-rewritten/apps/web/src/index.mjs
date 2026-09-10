import { format, localOnly } from "shared-kit";

export function run(value) {
  return format(localOnly() + value);
}

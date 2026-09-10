export function alpha(value) {
  return value;
}

export function beta(value, extra) {
  return extra === undefined ? value : [value, extra];
}

export function gamma(value) {
  return value;
}

export function formatName(value) {
  return String(value);
}

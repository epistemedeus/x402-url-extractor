export function greet(name, punct = "!") {
  return `hello ${name}${punct}`;
}

export function farewell(name) {
  return `goodbye ${name}`;
}

export const VERSION = "2.0.0";

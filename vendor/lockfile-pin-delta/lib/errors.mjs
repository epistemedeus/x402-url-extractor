export class CliRefuse extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "CliRefuse";
    this.code = code;
    this.detail = detail;
    this.exitCode = 2;
  }
}

export function cliRefuse(code, message, detail) {
  return new CliRefuse(code, message, detail);
}

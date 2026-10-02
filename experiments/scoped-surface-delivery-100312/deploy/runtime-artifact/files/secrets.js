// Fixture-secret classification for secret-literal.
// S22 is the only fixture class: one exact sentinel, and only inside a path
// segment named s22-fixture. A real secret is still secret-literal, including
// when it sits in s22-fixture, fixtures/, or a test file. There is no exemption
// for every test, every fixture directory, or every secret-shaped string.

import path from "node:path";

export const S22_FIXTURE_SEGMENT = "s22-fixture";
export const S22_FIXTURE_SECRET = "sk-ant-S22FIXTURESENTINEL000000000000";

const SECRET_LITERAL = /(sk-ant-[a-zA-Z0-9_\-]{24,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|xox[baprs]-[0-9]{8,}-[0-9a-zA-Z]{8,})/g;

export function isS22FixturePath(file) {
  const normalized = String(file || "").split(path.sep).join("/");
  return normalized.split("/").includes(S22_FIXTURE_SEGMENT);
}

export function classifySecretText(text, file = "") {
  const source = String(text || "");
  const s22File = isS22FixturePath(file);
  let sawFixture = false;
  for (const match of source.matchAll(SECRET_LITERAL)) {
    const token = match[0];
    if (s22File && token === S22_FIXTURE_SECRET) {
      sawFixture = true;
      continue;
    }
    return { class: "real-secret", id: null, token };
  }
  if (sawFixture) return { class: "fixture-secret", id: "S22", token: S22_FIXTURE_SECRET };
  return { class: "none", id: null, token: null };
}

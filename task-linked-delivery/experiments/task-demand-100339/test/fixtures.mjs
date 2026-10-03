import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixturePath = fileURLToPath(new URL('../fixtures/questions.json', import.meta.url));
export function fixture() { return JSON.parse(readFileSync(fixturePath)); }
export function questionA() { return fixture().question; }
export function questionB() { return JSON.parse(readFileSync(new URL('../fixtures/question-negative.json', import.meta.url))); }
export function plane(bundle, name) { return bundle.sources.find(s => s.plane === name); }

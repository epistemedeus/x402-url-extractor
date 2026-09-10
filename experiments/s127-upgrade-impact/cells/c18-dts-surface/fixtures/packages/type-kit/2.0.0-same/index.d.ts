export type Alpha = {
  id: string;
};

export interface Beta {
  n: number;
}

export declare function gamma(value: string): string;

export type Kept = true;

export type Delta = {
  unused: true;
};

export { type Relayed } from "./extra";

declare const quoted: "export type NotFromString = 1";

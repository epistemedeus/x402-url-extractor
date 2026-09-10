export type Local = 1;
declare module "other-package" {
  export function leaked(): void;
  export type LeakedType = 1;
}
declare global {
  interface GlobalLeak {
    x: 1;
  }
}

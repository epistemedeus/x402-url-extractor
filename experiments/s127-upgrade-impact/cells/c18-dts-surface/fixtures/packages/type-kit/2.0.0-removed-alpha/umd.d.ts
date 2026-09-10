declare function TypeKit(value: string): string;
declare namespace TypeKit {
  type Options = { flag?: boolean };
  function helper(value: string): string;
}
export = TypeKit;
export as namespace TypeKit;

// export type NotFromComment = 1;
/* export interface NotFromBlock {} */
export type Real = string;
declare const quoted: "export type NotFromString = 1";
declare const tmpl: `export function notFromTemplate(): void`;
/**
 * export declare function notFromJsdoc(): void;
 */
export interface AlsoReal {
  n: number;
}

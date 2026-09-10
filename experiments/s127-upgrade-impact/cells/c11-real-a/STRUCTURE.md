# Case A structure (distinct from case B)

Use this sheet so case B does not duplicate the same shape.

| Axis | Case A (`c11-real-a`) |
| --- | --- |
| Package | `path-to-regexp` (pillarjs) |
| License | MIT |
| Runtime deps | none |
| Old → new | `6.3.0` → `8.4.2` |
| Domain | Express-style path compiler (`/user/:id` → RegExp / reverse compile) |
| Module format | CJS `__esModule` named-function bag on `dist/index.js` |
| Export style | `exports.<name> = <name>` (TypeScript CJS emit) |
| Change kinds | removed named functions + JS-evident arity/return-shape |
| Used removed symbol | `tokensToFunction` |
| Unused removed symbol | `regexpToFunction` (imported, no value-position use) |
| Used signature change | `pathToRegexp` (3-arg out-param `RegExp` → `{ regexp, keys }`) |
| Not claimed | rename `tokensToFunction` → `stringify` |

Case B should pick a different domain **and** a different module/export
shape (for example: default-export function, ESM-only, YAML `safeLoad`
alias bag, UUID helper set, cookie parse/serialize, class constructor).

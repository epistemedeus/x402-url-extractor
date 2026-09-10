# Official-code quotes (path-to-regexp)

All paths under `fixtures/real-a/extracted/`. Captured from npm tarballs.
Not changelog paraphrases.

## 6.3.0 `package/dist/index.js`

Export bag (line 3):

```
exports.pathToRegexp = exports.tokensToRegexp = exports.regexpToFunction = exports.match = exports.tokensToFunction = exports.compile = exports.parse = void 0;
```

Public assignment of the used symbol:

```
exports.tokensToFunction = tokensToFunction;
```

Public assignment of the unused removed symbol:

```
exports.regexpToFunction = regexpToFunction;
```

Used surviving function, old arity + return (out-parameter `keys`):

```
function pathToRegexp(path, keys, options) {
    if (path instanceof RegExp)
        return regexpToRegexp(path, keys);
    if (Array.isArray(path))
        return arrayToRegexp(path, keys, options);
    return stringToRegexp(path, keys, options);
}
exports.pathToRegexp = pathToRegexp;
```

Old README (public token helpers):

```
Path-To-RegExp exposes the two functions used internally that accept an array of tokens:

- `tokensToRegexp(tokens, keys?, options?)` Transform an array of tokens into a matching regular expression.
- `tokensToFunction(tokens)` Transform an array of tokens into a path generator function.
```

## 8.4.2 `package/dist/index.js`

Export bag:

```
exports.parse = parse;
exports.compile = compile;
exports.match = match;
exports.pathToRegexp = pathToRegexp;
exports.stringify = stringify;
```

plus `exports.TokenData` / `exports.PathError`.

No `exports.tokensToFunction`, `exports.regexpToFunction`, or
`exports.tokensToRegexp`.

Internal leftover (not exported):

```
function tokensToFunction(tokens, delimiter, encode) {
```

New `pathToRegexp` arity + return:

```
function pathToRegexp(path, options = {}) {
```

```
return { regexp: new RegExp(pattern, sensitive ? "" : "i"), keys };
```

8.4.2 `Readme.md` documents `match`, `pathToRegexp`, `compile`, `parse`,
`stringify` and does not mention `tokensToFunction`.

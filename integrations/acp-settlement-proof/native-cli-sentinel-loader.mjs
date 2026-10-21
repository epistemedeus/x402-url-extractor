// TEST ONLY: intercept the native CLI credential module before evaluation.
export async function resolve(specifier, context, next) {
  if (specifier === 'cross-keychain') return { url: new URL('./native-cli-sentinel-keychain.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}

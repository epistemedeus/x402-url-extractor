export async function resolve(specifier, context, nextResolve) {
  if (specifier === "pg") return nextResolve(process.env.AE20_D_PG_URL, context);
  return nextResolve(specifier, context);
}

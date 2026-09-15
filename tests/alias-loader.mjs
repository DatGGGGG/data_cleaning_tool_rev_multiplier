const projectRoot = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const projectPath = specifier.slice(2);
    return nextResolve(new URL(`${projectPath}.ts`, projectRoot).href, context);
  }

  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }

  return nextResolve(specifier, context);
}

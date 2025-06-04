import * as esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["index.ts"],
    bundle: true,
    outfile: "dist/bundle.js",
    platform: "node",
    format: "esm",
    sourcemap: true,
    target: "es2022",
    external: ["gill"],
    resolveExtensions: [".ts", ".js", ".json"],
  })
  .catch(() => process.exit(1));

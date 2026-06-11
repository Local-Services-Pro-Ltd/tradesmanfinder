// Placeholder for the build-generated index.html bundle.
//
// script/build.ts OVERWRITES this file between the Vite client build and
// the esbuild server bundle, inlining dist/public/index.html as a string
// constant. We keep this committed placeholder so:
//   - vitest can import the module without running a full build
//   - TypeScript compiles without the file existing transiently
//   - the build step is a simple overwrite, not a file-existence dance
//
// The placeholder body is a minimal-but-valid HTML5 document with a
// </head> marker so injection code can locate the insertion point in
// dev or test environments where this file hasn't been overwritten.
//
// IMPORTANT for committers: like api/index.js, do NOT commit the
// build-generated form. After `npm run build`, run
//   git checkout -- server/generated/index-html.ts
// to restore this placeholder before staging.
export const BUNDLED_INDEX_HTML: string =
  "<!doctype html><html><head><title>TradesmanFinder</title></head><body><div id=\"root\"></div></body></html>";

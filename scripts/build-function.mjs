import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Bundle the Vercel serverless function.
 *
 * Vercel transpiles function sources file by file rather than bundling them.
 * This codebase is written for a bundler — `tsconfig.base.json` sets
 * `moduleResolution: "Bundler"`, so relative imports carry no file extension
 * — and Node's ESM loader does not add one. A file-by-file build therefore
 * produces a module graph that cannot resolve itself at runtime. Bundling
 * resolves every one of those specifiers here, at build time.
 *
 * ESM, not CommonJS: `storage/index.ts` picks its adapter with a top-level
 * `await` and `app.ts` reads `import.meta.url`. Neither survives a CommonJS
 * output format, and the `.mjs` extension states the format regardless of
 * what the nearest `package.json` says.
 *
 * npm packages are bundled in too, rather than left external. pnpm gives
 * each workspace package its own isolated `node_modules`, so the API's
 * dependencies are under `apps/api/node_modules` and not at the repo root —
 * where this bundle is emitted, and where Node would look for them. Leaving
 * them external produces a bundle that cannot find Express at all. Bundling
 * them sidesteps runtime resolution entirely, which also means the deployed
 * function does not depend on how the platform traces or hoists a pnpm
 * workspace.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Most of the dependency tree is CommonJS (Express and multer among them),
 * and CommonJS in an ESM bundle still expects `require`, `__filename` and
 * `__dirname` to exist. ESM defines none of them, so they are recreated
 * here.
 *
 * `require` is the load-bearing one: it is what a bundled CommonJS module
 * reaches for when it loads something conditionally at runtime. The two path
 * globals resolve to this bundle's own location rather than to each original
 * package's directory, which is only correct for code that uses them to find
 * *the application*, not to find files shipped alongside itself. Nothing on
 * the request path here does the latter — verified by running the bundle
 * under plain `node` and exercising the API.
 */
const NODE_GLOBALS_BANNER = [
  "import { createRequire as __valyticaCreateRequire } from 'node:module';",
  "import { fileURLToPath as __valyticaFileURLToPath } from 'node:url';",
  "import { dirname as __valyticaDirname } from 'node:path';",
  'const require = __valyticaCreateRequire(import.meta.url);',
  'const __filename = __valyticaFileURLToPath(import.meta.url);',
  'const __dirname = __valyticaDirname(__filename);',
].join('\n');

await build({
  entryPoints: [path.join(root, 'apps/api/src/vercel.ts')],
  outfile: path.join(root, 'api/index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  banner: { js: NODE_GLOBALS_BANNER },
});

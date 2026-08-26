import { build } from 'esbuild';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Produce a Vercel deployment via the Build Output API.
 *
 * Two constraints force this rather than the simpler `api/` directory
 * convention, and they compound.
 *
 * First, the function has to be bundled. Vercel transpiles function sources
 * file by file rather than bundling them, and this codebase is written for a
 * bundler: `tsconfig.base.json` sets `moduleResolution: "Bundler"`, so
 * relative imports carry no file extension and Node's ESM loader will not
 * add one. A file-by-file build of `apps/api` produces a module graph that
 * cannot resolve itself at runtime.
 *
 * Second, a bundle is a build artifact, and Vercel validates the `functions`
 * patterns in `vercel.json` against the cloned repository *before* running
 * the build command. A function that the build produces therefore does not
 * exist yet at the moment it is looked for, and the deploy fails with
 * "doesn't match any Serverless Functions".
 *
 * The Build Output API resolves both: this script writes the finished
 * deployment — static files, the bundled function, and the routing between
 * them — into `.vercel/output`, and Vercel deploys that directly. Nothing is
 * inferred from the repository layout, so nothing has to exist before the
 * build in order to be found after it.
 *
 * Layout produced (Build Output API v3):
 *
 *   .vercel/output/config.json            routing
 *   .vercel/output/static/                the web build, served from the edge
 *   .vercel/output/functions/api.func/    the bundled Express app
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, '.vercel/output');
const staticDir = path.join(outputDir, 'static');
const functionDir = path.join(outputDir, 'functions/api.func');

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
 * under plain `node` and exercising the API through it.
 */
const NODE_GLOBALS_BANNER = [
  "import { createRequire as __realyticaCreateRequire } from 'node:module';",
  "import { fileURLToPath as __realyticaFileURLToPath } from 'node:url';",
  "import { dirname as __realyticaDirname } from 'node:path';",
  'const require = __realyticaCreateRequire(import.meta.url);',
  'const __filename = __realyticaFileURLToPath(import.meta.url);',
  'const __dirname = __realyticaDirname(__filename);',
].join('\n');

async function bundleFunction() {
  await build({
    entryPoints: [path.join(root, 'apps/api/src/vercel.ts')],
    outfile: path.join(functionDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    // ESM, not CommonJS: `storage/index.ts` chooses its adapter with a
    // top-level await and `app.ts` reads `import.meta.url`. Neither survives
    // a CommonJS output format.
    //
    // npm packages are bundled in rather than left external. pnpm gives each
    // workspace package an isolated `node_modules`, so nothing resolves the
    // API's dependencies from where the bundle ends up; bundling drops
    // runtime resolution entirely and keeps the function independent of how
    // the platform traces a pnpm workspace.
    sourcemap: true,
    logLevel: 'info',
    banner: { js: NODE_GLOBALS_BANNER },
  });

  await fsp.writeFile(
    path.join(functionDir, '.vc-config.json'),
    `${JSON.stringify(
      {
        runtime: 'nodejs20.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        // The handler is an Express app, which needs the unmodified Node
        // request and response objects. Vercel's helpers would pre-read and
        // parse the request body, leaving multer nothing to stream and
        // breaking document upload.
        shouldAddHelpers: false,
        // Agent progress is delivered over Server-Sent Events. Without this
        // the platform buffers the whole response and every step arrives at
        // once, after the run has already finished.
        supportsResponseStreaming: true,
        // Agent orchestration is minutes of model calls, not milliseconds.
        maxDuration: 800,
      },
      null,
      2,
    )}\n`,
  );
}

async function copyStatic() {
  const webDist = path.join(root, 'apps/web/dist');
  if (!(await fsp.stat(path.join(webDist, 'index.html')).catch(() => null))) {
    throw new Error(`No web build at ${webDist} — run the web build before this script.`);
  }
  await fsp.cp(webDist, staticDir, { recursive: true });
}

async function writeConfig() {
  await fsp.writeFile(
    path.join(outputDir, 'config.json'),
    `${JSON.stringify(
      {
        version: 3,
        routes: [
          // API first, unconditionally: the whole API lives behind one
          // function and Express routes within it, including its own JSON
          // 404. Matching this before the filesystem means no static file
          // can ever shadow an endpoint.
          { src: '/api/(.*)', dest: '/api' },
          // Then real files — the JS, CSS and assets of the web build.
          { handle: 'filesystem' },
          // Anything left is a client-side route (`/cases/:id/valuation` and
          // friends), which is not a file and must still load the app.
          { src: '/(.*)', dest: '/index.html' },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

await fsp.rm(outputDir, { recursive: true, force: true });
await fsp.mkdir(functionDir, { recursive: true });
await copyStatic();
await bundleFunction();
await writeConfig();
console.log(`[build] Vercel build output written to ${path.relative(root, outputDir)}`);

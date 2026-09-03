/**
 * Catch Tailwind classes that name a token this project does not have.
 *
 * Three of these shipped before anyone noticed. `bg-surface-1` sat on the
 * cockpit's work surface for months — the token is `surface`, so Tailwind
 * emitted nothing and the pane was simply transparent. `bg-critical-soft` was
 * written and would have done the same. Nothing catches them: they are valid
 * strings in valid JSX, TypeScript has no opinion about the contents of a
 * `className`, and ESLint does not know what a design token is. The only
 * symptom is a style that silently does not apply, which is exactly the kind
 * of bug that survives review — the page still renders, just not as intended.
 *
 * The check is a diff. Tailwind is compiled against the real config and the
 * real sources, which yields every utility it recognised; anything in the
 * source that looks like a colour utility and is NOT in that output is a
 * class that resolves to no CSS.
 *
 * ## Kept deliberately narrow
 *
 * Only utilities whose value is a theme key — the ones that fail silently
 * because a token name was wrong. Spacing and layout typos (`flexx`, `p-3.7`)
 * are left alone: they are rarer, more obvious on screen, and widening the net
 * is how a check like this starts crying wolf and gets ignored. A check with
 * false positives is worse than no check, because the next person turns it off
 * rather than reading it.
 *
 * Arbitrary values (`bg-[var(--x)]`), opacity modifiers (`bg-brand/40`) and
 * variants (`hover:`, `lg:`, `coarse:`) are all understood and reduced to the
 * base utility before comparison.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'apps', 'web');

/**
 * Utilities that take a colour from the theme.
 *
 * These are the ones where a wrong token produces silence rather than an
 * error, which is the failure mode this exists for.
 */
const COLOUR_PREFIXES = [
  'bg', 'text', 'ring', 'border', 'divide', 'outline', 'fill', 'stroke',
  'from', 'via', 'to', 'accent', 'caret', 'decoration', 'shadow', 'placeholder',
];

const PREFIX_RE = new RegExp(`^(${COLOUR_PREFIXES.join('|')})-[A-Za-z0-9][A-Za-z0-9-]*$`);

/** Strip `hover:`, `lg:`, `group-hover:` … but never a `:` inside brackets. */
function stripVariants(token) {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i];
    if (c === '[') depth += 1;
    else if (c === ']') depth -= 1;
    else if (c === ':' && depth === 0) lastColon = i;
  }
  return lastColon === -1 ? token : token.slice(lastColon + 1);
}

/** `bg-brand/40` and `!bg-brand` both test as `bg-brand`. */
function baseUtility(token) {
  let t = stripVariants(token).replace(/^!/, '');
  const slash = t.lastIndexOf('/');
  if (slash > 0 && !t.slice(slash).includes(']')) t = t.slice(0, slash);
  return t;
}

/**
 * Blank out comments, keeping line numbers.
 *
 * This file's own explanation of the `bg-surface-1` bug names the class in
 * backticks, and the scanner dutifully reported it — a check whose first
 * finding is the documentation of the thing it checks for. Prose about a class
 * is not a use of it.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, keep) => keep + ' '.repeat(m.length - keep.length));
}

/**
 * Is this string a list of classes, or is it a sentence?
 *
 * English hyphenates, and some of those hyphenations look exactly like
 * utilities: "The PDF was rasterised or text-extracted locally" contains
 * `text-extracted`, which is not a class anybody wrote. Reporting it is the
 * kind of noise that gets a check switched off.
 *
 * The tell is the neighbours. A `className` is almost entirely made of
 * utilities Tailwind emitted; a sentence is almost entirely made of words it
 * has never heard of. Half is a wide margin either way.
 */
function looksLikeClassList(body, generated) {
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  /*
   * A lone token has no neighbours to judge it by, and the ratio would score
   * the dead class itself at zero and skip it — which is backwards, because
   * the single-token string is how a tone map is written:
   *
   *   const SOURCE_TONE = { locality: 'text-status-warning', … }
   *
   * That is a className in every sense and is exactly where these hide. Prose
   * is rarely one hyphenated word alone in a string.
   */
  if (tokens.length === 1) return true;
  const known = tokens.filter((t) => {
    if (t.includes('[')) return true; // an arbitrary value is unambiguously a class
    return generated.has(baseUtility(t));
  }).length;
  return known / tokens.length >= 0.5;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?|html)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every class Tailwind actually emitted, reduced to its base utility. */
function generatedUtilities() {
  const out = mkdtempSync(path.join(tmpdir(), 'realytica-classes-'));
  const cssFile = path.join(out, 'out.css');
  try {
    /*
     * Resolved rather than assembled: pnpm does not hoist, so tailwind lives
     * under `apps/web/node_modules` and a path built from the repo root finds
     * nothing. `createRequire` asks the same resolver the app uses.
     */
    const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
    const cli = requireFromWeb.resolve('tailwindcss/lib/cli.js');
    execFileSync(
      process.execPath,
      [
        cli,
        '-c', path.join(webDir, 'tailwind.config.js'),
        '-i', path.join(webDir, 'src', 'index.css'),
        '-o', cssFile,
      ],
      { cwd: webDir, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const css = readFileSync(cssFile, 'utf-8');
    const found = new Set();
    // Class selectors, with Tailwind's escaping (`.bg-brand\/40`, `.lg\:flex`).
    for (const m of css.matchAll(/\.((?:[^\s{},:>+~[\]()"'\\]|\\.)+)/g)) {
      const unescaped = m[1].replace(/\\(.)/g, '$1');
      found.add(baseUtility(unescaped));
    }
    return found;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function main() {
  const generated = generatedUtilities();
  if (generated.size === 0) {
    console.error('[classes] Tailwind produced no output — the check cannot run, so it is failing rather than passing quietly.');
    process.exit(1);
  }

  const offenders = new Map();
  for (const file of walk(path.join(webDir, 'src'))) {
    const text = stripComments(readFileSync(file, 'utf-8'));
    text.split('\n').forEach((line, i) => {
      // Only inside quoted strings — prose in a comment is not a class list.
      for (const q of line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
        const body = q[1] ?? q[2] ?? q[3] ?? '';
        if (!looksLikeClassList(body, generated)) continue;
        for (const token of body.split(/\s+/)) {
          if (!token || token.includes('[')) continue;
          const base = baseUtility(token);
          if (!PREFIX_RE.test(base)) continue;
          if (generated.has(base)) continue;
          const key = base;
          if (!offenders.has(key)) offenders.set(key, []);
          offenders.get(key).push(`${path.relative(root, file)}:${i + 1}`);
        }
      }
    });
  }

  if (offenders.size === 0) {
    console.log('[classes] no dead colour utilities.');
    return;
  }

  console.error('\n[classes] These name a token this project does not have, so Tailwind emits');
  console.error('          nothing for them and the style silently never applies:\n');
  for (const [cls, where] of [...offenders].sort()) {
    console.error(`  ${cls}`);
    for (const site of [...new Set(where)].slice(0, 8)) console.error(`      ${site}`);
  }
  console.error('\n  Check the token name against apps/web/tailwind.config.js — `bg-surface-1`');
  console.error('  was the last one of these, where the token is `surface`.\n');
  process.exit(1);
}

main();

import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * One rule, in one place, on purpose.
 *
 * This repo had no linter and the absence had a cost: every case page threw
 * React error #310 for four commits because seven hooks were added below an
 * early return in `Cockpit`. `tsc` has no opinion about hook order, and the
 * 411 unit tests are pure functions with no React renderer among them — so
 * nothing between writing that code and opening the page in a browser could
 * say a word about it.
 *
 * `rules-of-hooks` catches that whole class, not just the instance. It is on
 * alone rather than as part of a style preset: enabling `js.recommended` here
 * produced fifteen findings about escape characters and unused assignments,
 * and burying the one that means THE APPLICATION DOES NOT RENDER under
 * fourteen that mean nothing is how a gate becomes something people skim. Add
 * a rule when a real defect argues for it.
 *
 * Scoped to `apps/web` because that is where React is. `packages/shared` has
 * no React and the rule mis-fires there: `useFamily` in the Karnataka
 * land-use playbook answers "which USE family is this property type", and
 * renaming a domain term to appease a linter that has nothing to say about
 * the file would be the wrong way round.
 *
 * `exhaustive-deps` is a WARNING deliberately. It is right far more often
 * than not and wrong often enough — a deliberately once-only effect, a ref
 * that must not retrigger — that failing the build on it teaches people to
 * write disable comments, which is worse than the warning.
 */
export default tseslint.config({
  files: ['apps/web/**/*.{ts,tsx}'],
  ignores: ['**/dist/**'],
  plugins: { 'react-hooks': reactHooks },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
});

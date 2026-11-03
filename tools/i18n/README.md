# Core localization checks

The repository-root `locales/<locale>.json` files are the core diagnostic catalogs. Their keys and
English wording mirror the existing read-only `game/validation/catalogs/en.json` contract; they are
not replacements for per-game catalogs stored next to a `GameSpec`.

`game/i18n/index.mjs` provides local locale selection and `{parameter}` substitution without a
runtime dependency. English is the default. An unsupported locale request selects English; a missing
key in a supported locale returns `undefined` rather than silently mixing English into a translated
catalog. The checker still reports every missing key, even when a non-English catalog meets the
95% threshold.

- `npm run i18n-check` checks all eight fixed locales against the English diagnostic baseline,
  including coverage, extra keys, and identical parameter names.
- `npm run i18n-no-literals` statically scans Godot `.gd` and `.tscn` sources under `game/` for
  non-empty string literals directly assigned to display properties (`text`, `tooltip_text`,
  `placeholder_text`, `window_title`, or `title`). Display strings should use catalog keys.
- `npm run test:i18n` exercises runtime behavior and checker failures, including a real fixture
  literal that makes the no-literals command exit non-zero.

These checks are local and offline. They do not invoke a translation service or alter the validator,
its diagnostic codes, parameter maps, or existing game catalogs.

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
- `npm run i18n-no-literals` reports its scope and scanned file list. It recursively scans
  `game/**/*.gd`, `game/**/*.tscn`, `game/**/*.{mjs,js,cjs}`, and, when present,
  `cli/**/*.{mjs,js,cjs}`. The Godot scene/script and JavaScript CLI/validation sources under
  `game/` are read-only inputs to the checker; the `cli/` tree is also read-only when present.
  It rejects non-empty literals assigned to display properties (`text`, `tooltip_text`,
  `placeholder_text`, `window_title`, `title`), passed to Godot `set_text`, or emitted through
  Godot `print`/`printerr`/`push_error`/`push_warning`, JavaScript `console.log`/`info`/`warn`/
  `error`/`debug`, and `process.stdout.write`/`process.stderr.write`. Translation calls and catalog
  lookups are allowed; diagnostic-code-shaped tokens are treated as machine identifiers, not prose.
  User-visible messages belong in catalogs, while diagnostic output remains code and parameters.
- The public validator accepts `godot --headless --path game --script res://cli/main.gd -- validate <GameSpec> --locale <tag>`.
  Validation messages and CLI usage come from the root diagnostic catalogs; unsupported tags fall
  back to English. Localization changes only `message`, not diagnostic codes, parameters, ordering,
  or the resolved game/module data. `resolve` remains locale-independent.
- `npm run test:i18n` exercises runtime behavior and checker failures, including fixtures for UI
  property assignment, `set_text`, Godot and JavaScript CLI output, localized expressions, and
  comments. Each supported output family has negative probes that make the checker exit non-zero.

These checks are local and offline. They do not invoke a translation service or alter the validator,
its diagnostic codes, parameter maps, or existing game catalogs.

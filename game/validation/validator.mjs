#!/usr/bin/env node
// Local GameSpec validation. The public entry point is game/cli/main.gd; this helper
// reuses the repository-locked YAML 1.2 and JSON Schema implementations offline.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';
import { createI18n } from '../i18n/index.mjs';
import { resolveGameSpec } from '../modules/resolver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_PATH = join(REPO_ROOT, 'schema/gamespec.schema.json');
const ESCAPE_POINTER = (part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1');
function atPointer(value, pointer) {
  if (!pointer || pointer === '/') return value;
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, part) => current?.[Array.isArray(current) ? Number(part) : part], value);
}

function errorPath(error) {
  const base = error.instancePath ?? '';
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    return `${base}/${ESCAPE_POINTER(error.params.missingProperty)}`;
  }
  if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
    return `${base}/${ESCAPE_POINTER(error.params.additionalProperty)}`;
  }
  return base || '/';
}

function pointerParent(pointer) {
  const segments = pointer.split('/').slice(1, -1);
  return `/${segments.join('/')}`.replace(/^\/$/, '');
}

function allowedFields(parentPath) {
  const fields = {
    '': ['specVersion', 'game', 'entry', 'modules', 'locales'],
    '/game': ['id', 'version', 'titleKey', 'descriptionKey'],
    '/entry': ['scene'],
    '/locales': ['default', 'supported'],
  };
  if (/^\/modules\/\d+$/.test(parentPath)) return ['id', 'version', 'optional'];
  return fields[parentPath] ?? [];
}

function diagnostic(code, params) {
  return {
    code,
    params,
    catalogKey: `errors.${code}`,
  };
}

function formatDiagnostic(entry, i18n) {
  const params = entry.params ?? {};
  const formatParams = Array.isArray(params.cycle)
    ? { ...params, cycle: params.cycle.join(' -> ') }
    : params;
  const key = entry.catalogKey ?? `errors.${entry.code}`;
  return { ...entry, message: i18n.t(key, formatParams) };
}

function formatResultDiagnostics(result, i18n) {
  if (!Array.isArray(result.errors)) return result;
  return { ...result, errors: result.errors.map((entry) => formatDiagnostic(entry, i18n)) };
}

function parserError(error, duplicate, source) {
  const position = error.linePos?.[0] ?? { line: 1, col: 1 };
  const sourceLine = source.split(/\r?\n/)[position.line - 1] ?? '';
  const keyMatch = /^\s*(?:-\s*)?([^:[\]{}]+):(?:\s|$)/.exec(sourceLine);
  const code = duplicate ? 'yaml.duplicate-key' : 'yaml.syntax';
  const params = {
    path: '/',
    expected: 'YAML 1.2',
    actual: error.code ?? 'parse error',
    line: position.line,
    column: position.col,
  };
  if (duplicate) params.key = keyMatch?.[1]?.trim() ?? 'unknown';
  return diagnostic(code, params);
}

function parseYaml(text) {
  const doc = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    merge: false,
    customTags: [],
  });

  if (doc.errors.length > 0) {
    const error = doc.errors[0];
    const duplicate = doc.errors.some((entry) => entry.code === 'DUPLICATE_KEY');
    return { error: parserError(error, duplicate, text) };
  }
  if (doc.warnings.length > 0) return { error: parserError(doc.warnings[0], false, text) };

  try {
    return { value: doc.toJS({ maxAliasCount: 100 }) };
  } catch (error) {
    return { error: parserError(error, false, text) };
  }
}

function forbiddenStateFields(value, basePath = '') {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...forbiddenStateFields(item, `${basePath}/${index}`)));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = `${basePath}/${ESCAPE_POINTER(key)}`;
      if (['state', 'save', 'runtime'].includes(key)) violations.push({ path, field: key });
      violations.push(...forbiddenStateFields(child, path));
    }
  }
  return violations;
}

function structuralErrors(value, validate) {
  if (validate(value)) return [];
  const errors = [];
  for (const error of validate.errors ?? []) {
    const path = errorPath(error);
    const actualValue = atPointer(value, path);
    let code = 'field.type';
    let expected;
    let actual = actualValue;

    switch (error.keyword) {
      case 'required':
        code = 'field.required';
        expected = 'present';
        actual = null;
        break;
      case 'additionalProperties':
        code = 'field.unknown';
        expected = allowedFields(pointerParent(path));
        actual = error.params.additionalProperty;
        break;
      case 'type':
        code = 'field.type';
        expected = error.params.type;
        break;
      case 'enum':
        code = 'field.enum';
        expected = error.params.allowedValues;
        break;
      case 'pattern':
        code = 'field.pattern';
        expected = error.params.pattern;
        break;
      case 'uniqueItems':
        code = 'field.unique';
        expected = 'uniqueItems';
        break;
      default:
        code = error.keyword === 'minItems' || error.keyword === 'maxItems' ? 'field.type' : code;
        expected = error.keyword;
    }

    errors.push(diagnostic(code, { path, expected, actual }));
  }
  return errors;
}

function semanticErrors(value, specPath) {
  const errors = [];
  const localeSpec = value.locales ?? { default: 'en', supported: ['en'] };
  const supported = [...localeSpec.supported];

  if (!supported.includes(localeSpec.default)) {
    errors.push(diagnostic('field.enum', {
      path: '/locales/default',
      expected: supported,
      actual: localeSpec.default,
    }));
  }

  const moduleIndexes = new Map();
  for (const [index, moduleRef] of (value.modules ?? []).entries()) {
    const firstIndex = moduleIndexes.get(moduleRef.id);
    if (firstIndex !== undefined) {
      errors.push(diagnostic('module.duplicate', {
        path: `/modules/${index}/id`,
        expected: 'unique',
        actual: moduleRef.id,
        moduleId: moduleRef.id,
      }));
    } else {
      moduleIndexes.set(moduleRef.id, index);
    }
  }

  const translationKeys = [
    ['/game/titleKey', value.game.titleKey],
    ...(value.game.descriptionKey ? [['/game/descriptionKey', value.game.descriptionKey]] : []),
  ];
  const localeDir = join(dirname(specPath), 'locales');
  for (const locale of supported.toSorted()) {
    const catalogPath = join(localeDir, `${locale}.json`);
    let localeCatalog = {};
    try {
      localeCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    } catch {
      localeCatalog = {};
    }

    for (const [path, key] of translationKeys) {
      if (!Object.hasOwn(localeCatalog, key)) {
        errors.push(diagnostic('locale.key.missing', {
          path,
          expected: key,
          actual: 'missing',
          locale,
          catalog: 'game',
        }));
      }
    }
  }

  return errors;
}

function runValidation(inputPath, i18n) {
  const specPath = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
  const source = readFileSync(specPath, 'utf8');
  const parsed = parseYaml(source);
  if (parsed.error) return formatResultDiagnostics({ ok: false, errors: [parsed.error] }, i18n);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
    allowUnionTypes: false,
    messages: true,
  });
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);
  const stateViolations = forbiddenStateFields(parsed.value);
  const forbiddenPaths = new Set(stateViolations.map((entry) => entry.path));
  const stateErrors = stateViolations.map(({ path, field }) => diagnostic(
    'definition.state.forbidden',
    { path, expected: 'absent', actual: field, field },
  ));
  const shapeErrors = structuralErrors(parsed.value, validate).filter((entry) =>
    !(entry.code === 'field.unknown' && forbiddenPaths.has(entry.params.path)));
  const errors = [...stateErrors, ...shapeErrors];
  if (errors.length > 0) return formatResultDiagnostics({ ok: false, errors }, i18n);

  errors.push(...semanticErrors(parsed.value, specPath));
  if (errors.length > 0) return formatResultDiagnostics({ ok: false, errors }, i18n);

  const resolution = resolveGameSpec(parsed.value, specPath);
  if (!resolution.ok) return formatResultDiagnostics(resolution, i18n);

  const locales = parsed.value.locales ?? { default: 'en', supported: ['en'] };
  return {
    ok: true,
    gameId: parsed.value.game.id,
    version: parsed.value.game.version,
    entryScene: parsed.value.entry.scene,
    modules: parsed.value.modules ?? [],
    moduleOrder: resolution.order,
    locales: {
      default: locales.default,
      supported: locales.supported,
    },
  };
}

function parseArguments(args) {
  const positionals = [];
  let locale = 'en';
  let missingLocale = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--locale') {
      positionals.push(args[index]);
    } else if (!args[index + 1] || args[index + 1].startsWith('--')) {
      missingLocale = true;
    } else {
      locale = args[index + 1];
      index += 1;
    }
  }
  return { positionals, locale, missingLocale };
}

function main(args) {
  const { positionals, locale, missingLocale } = parseArguments(args);
  const i18n = createI18n({ locale });
  if (missingLocale || positionals.length !== 2 || positionals[0] !== 'validate') {
    process.stderr.write(`${i18n.t('errors.cli.usage')}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = runValidation(positionals[1], i18n);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.code ?? 'validation.error'}\n`);
    process.exitCode = 2;
  }
}

main(process.argv.slice(2));

// Общие помощники проверки контрактов K-2.
//
// Всё работает офлайн: только node_modules из package-lock.json и локальные файлы
// репозитория. Ни сети, ни cortex, ни аккаунта, ни секретов (INV-1).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';

/** Корень репозитория: tests/contracts/lib -> tests/contracts -> tests -> repo. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Наборы контрактных примеров: имя -> каталог с cases.json. */
export const CASE_SETS = ['gamespec', 'module-manifest', 'error-registry'];

export const ERRORS_DOC = join(REPO_ROOT, 'docs/contracts/errors.md');
export const DECISIONS_DOC = join(REPO_ROOT, 'docs/decisions/SYN-1.md');
export const REGISTRY_FILE = join(REPO_ROOT, 'schema/error-registry.json');
export const REGISTRY_SCHEMA = join(REPO_ROOT, 'schema/error-registry.schema.json');

export function readText(file) {
  return readFileSync(file, 'utf8');
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

/** Ошибка разбора YAML с машинным кодом из реестра. */
export class YamlContractError extends Error {
  constructor(code, file, details) {
    const detail = details.length ? `: ${details[0].message}` : '';
    super(`${file}: ${code}${detail}`);
    this.name = 'YamlContractError';
    this.code = code;
    this.file = file;
    this.details = details;
  }
}

/**
 * Строгое чтение YAML-черновика контракта.
 *
 * - YAML 1.2, core schema: нет неявных дат и «yes/no» из 1.1, нет исполняемых тегов;
 * - uniqueKeys: повтор ключа — ошибка yaml.duplicate-key, а не «последний выиграл»;
 * - maxAliasCount: защита от «billion laughs» через якоря;
 * - любая другая ошибка разбора — yaml.syntax.
 */
export function parseYamlStrict(text, file = '<string>') {
  const doc = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    merge: false,
    customTags: [],
  });

  if (doc.errors.length > 0) {
    const duplicate = doc.errors.some((error) => error.code === 'DUPLICATE_KEY');
    throw new YamlContractError(duplicate ? 'yaml.duplicate-key' : 'yaml.syntax', file, doc.errors);
  }

  try {
    return { value: doc.toJS({ maxAliasCount: 100 }), warnings: doc.warnings, doc };
  } catch (error) {
    throw new YamlContractError('yaml.syntax', file, [error]);
  }
}

/** Создаёт Ajv с поддержкой JSON Schema 2020-12 и строгой проверкой самих схем. */
export function createAjv() {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
    allowUnionTypes: false,
    messages: true,
  });
}

/** Компилирует схему по абсолютному пути и отдаёт валидатор. */
export function compileSchema(schemaPath, ajv = createAjv()) {
  const schema = readJson(schemaPath);
  const validate = ajv.compile(schema);
  return { schema, validate, ajv };
}

const JSON_POINTER_ESCAPE = (segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Путь к значению в документе так, как он попадает в params.path (INV-6).
 *
 * Для отсутствующего обязательного поля и для лишнего ключа путь указывает на имя ключа,
 * а не на контейнер: так пользователю видно, что именно поправить.
 */
export function errorPath(error) {
  const base = error.instancePath === '' ? '' : error.instancePath;
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    return `${base}/${JSON_POINTER_ESCAPE(error.params.missingProperty)}`;
  }
  if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
    return `${base}/${JSON_POINTER_ESCAPE(error.params.additionalProperty)}`;
  }
  return base === '' ? '/' : base;
}

/** Загружает cases.json набора и разрешает пути относительно самого файла. */
export function loadCaseSet(name) {
  const dir = join(REPO_ROOT, 'schema/examples', name);
  const casesFile = join(dir, 'cases.json');
  const cases = readJson(casesFile);
  return {
    name,
    dir,
    casesFile,
    schemaPath: resolve(dir, cases.schema),
    valid: (cases.valid ?? []).map((rel) => resolve(dir, rel)),
    invalid: (cases.invalid ?? []).map((entry) => ({
      ...entry,
      absolutePath: resolve(dir, entry.file),
      phase: entry.phase ?? 'schema',
    })),
  };
}

export function loadAllCaseSets() {
  return CASE_SETS.map(loadCaseSet);
}

/** Коды ошибок из реестра. */
export function registryCodes() {
  return readJson(REGISTRY_FILE).codes;
}

export function codeIndex() {
  return new Map(registryCodes().map((entry) => [entry.code, entry]));
}

/** Все строковые $ref внутри схемы — рекурсивно. */
export function collectRefs(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

/** Рекурсивно собирает файлы с заданным расширением. */
export function walk(dir, extension) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) result.push(...walk(full, extension));
    else if (full.endsWith(extension)) result.push(full);
  }
  return result.sort();
}

/** Коды, упомянутые в таблице реестра в docs/contracts/errors.md. */
export function documentedCodes() {
  const lines = readText(ERRORS_DOC).split('\n');
  const codes = new Set();
  for (const line of lines) {
    const match = /^\|\s*`([a-z][a-zA-Z0-9.-]*)`\s*\|/.exec(line);
    // Строка заголовка таблицы тоже начинается с `code`; настоящие коды всегда составные.
    if (match && match[1].includes('.')) codes.add(match[1]);
  }
  return codes;
}

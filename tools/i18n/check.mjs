import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../game/i18n/index.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL_EN_PATH = join(REPO_ROOT, 'game/validation/catalogs/en.json');
const ERROR_REGISTRY_PATH = join(REPO_ROOT, 'schema/error-registry.json');
const LOCALE_DIR = join(REPO_ROOT, 'locales');
const EXAMPLE_LOCALE_DIR = join(REPO_ROOT, 'examples/locales');
const EXAMPLE_LOCALES = ['en', 'ru', 'zh-Hans'];
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function isCatalog(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function placeholders(message) {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

export function evaluateCatalogs({
  baseCatalog,
  catalogs,
  locales = SUPPORTED_LOCALES,
  defaultLocale = DEFAULT_LOCALE,
  threshold = 0.95,
}) {
  const baseIsValid = isCatalog(baseCatalog);
  const normalizedBase = baseIsValid ? baseCatalog : {};
  const baseKeys = baseIsValid ? Object.keys(baseCatalog).sort() : [];
  const issues = [];
  const results = [];

  if (!baseIsValid || baseKeys.length === 0) {
    issues.push('English baseline must be a non-empty JSON object.');
  }
  for (const key of baseKeys) {
    if (typeof baseCatalog[key] !== 'string' || baseCatalog[key].trim() === '') {
      issues.push(`English baseline key ${key} must have non-empty string text.`);
    }
  }
  if (!locales.includes(defaultLocale)) issues.push(`Default locale ${defaultLocale} is not in the checked locale list.`);

  for (const locale of locales) {
    const catalog = catalogs?.[locale];
    const validCatalog = isCatalog(catalog);
    const current = validCatalog ? catalog : {};
    const missing = baseKeys.filter((key) => typeof current[key] !== 'string' || current[key].trim() === '');
    const extra = Object.keys(current).filter((key) => !Object.hasOwn(normalizedBase, key)).sort();
    const localeIssues = [];

    if (!validCatalog) localeIssues.push(`catalog for ${locale} is missing or is not a JSON object`);
    for (const key of extra) localeIssues.push(`unexpected key ${key}`);
    for (const key of baseKeys) {
      if (missing.includes(key)) continue;
      if (typeof baseCatalog[key] === 'string'
        && JSON.stringify(placeholders(current[key])) !== JSON.stringify(placeholders(baseCatalog[key]))) {
        localeIssues.push(`incompatible parameters for ${key}: expected {${placeholders(baseCatalog[key]).join(', ') || 'none'}}, found {${placeholders(current[key]).join(', ') || 'none'}}`);
      }
    }

    const present = baseKeys.length - missing.length;
    const coverage = baseKeys.length === 0 ? 1 : present / baseKeys.length;
    if (coverage < threshold) {
      localeIssues.push(`coverage ${(coverage * 100).toFixed(1)}% is below ${(threshold * 100).toFixed(1)}%`);
    }
    if (locale === defaultLocale && present !== baseKeys.length) {
      localeIssues.push(`${defaultLocale} baseline must have 100% coverage`);
    }

    for (const issue of localeIssues) issues.push(`${locale}: ${issue}`);
    results.push({ locale, present, total: baseKeys.length, coverage, missing, issues: localeIssues });
  }

  return { ok: issues.length === 0, baseKeys, threshold, results, issues };
}

export function formatReport(report) {
  const lines = [
    `i18n-check: locales=${report.results.length} base-keys=${report.baseKeys.length} threshold=${(report.threshold * 100).toFixed(1)}%`,
  ];
  for (const result of report.results) {
    const missing = result.missing.length > 0 ? result.missing.join(', ') : 'none';
    lines.push(`i18n-check: ${result.locale} ${result.present}/${result.total} ${(result.coverage * 100).toFixed(1)}% missing=[${missing}]`);
  }
  for (const issue of report.issues) lines.push(`i18n-check: ERROR ${issue}`);
  lines.push(report.ok ? 'i18n-check: ok' : `i18n-check: fail=${report.issues.length}`);
  return lines.join('\n');
}

function sameCatalog(left, right) {
  if (!isCatalog(left) || !isCatalog(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && leftKeys.every((key) => left[key] === right[key]);
}

export function loadProductionCatalogs(directory = LOCALE_DIR) {
  const catalogs = {};
  for (const locale of SUPPORTED_LOCALES) {
    try {
      catalogs[locale] = JSON.parse(readFileSync(join(directory, `${locale}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') catalogs[locale] = undefined;
      else throw new Error(`Could not load locales/${locale}.json: ${error.message}`);
    }
  }
  return catalogs;
}

function readCatalogs(directory, locales) {
  return Object.fromEntries(locales.map((locale) => {
    try {
      return [locale, JSON.parse(readFileSync(join(directory, `${locale}.json`), 'utf8'))];
    } catch (error) {
      if (error.code === 'ENOENT') return [locale, undefined];
      throw new Error(`Could not load ${directory}/${locale}.json: ${error.message}`);
    }
  }));
}

function addExactKeySetIssues(report) {
  for (const result of report.results) {
    if (result.missing.length > 0) {
      report.issues.push(`${result.locale}: production key set must match English; missing ${result.missing.join(', ')}`);
    }
  }
  report.ok = report.issues.length === 0;
  return report;
}

export function checkProductionCatalogs({ directory = LOCALE_DIR, canonicalPath = CANONICAL_EN_PATH, registryPath = ERROR_REGISTRY_PATH } = {}) {
  const canonicalCatalog = JSON.parse(readFileSync(canonicalPath, 'utf8'));
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const catalogs = loadProductionCatalogs(directory);
  const english = catalogs[DEFAULT_LOCALE];
  const report = evaluateCatalogs({ baseCatalog: english, catalogs });
  const registryKeys = new Set();
  const registryIssues = [];

  for (const entry of registry.codes ?? []) {
    const key = `errors.${entry.code}`;
    if (entry.catalogKey !== key) registryIssues.push(`error registry code ${entry.code} must use ${key}`);
    if (registryKeys.has(key)) registryIssues.push(`duplicate error catalog key ${key}`);
    registryKeys.add(key);
    if (typeof english?.[key] !== 'string' || english[key].trim() === '') {
      registryIssues.push(`locales/en.json is missing registered key ${key}`);
    } else if (!Object.hasOwn(canonicalCatalog, key)) {
      const allowedParams = new Set([
        ...(registry.params?.required ?? []),
        ...(entry.params ?? []),
        ...(entry.extraParams ?? []),
      ]);
      const unknownParams = placeholders(english[key]).filter((name) => !allowedParams.has(name));
      if (unknownParams.length > 0) {
        registryIssues.push(`${key} uses unregistered parameters: ${unknownParams.join(', ')}`);
      }
    }
  }

  const canonicalKeys = Object.keys(canonicalCatalog);
  const englishCanonical = isCatalog(english)
    ? Object.fromEntries(canonicalKeys.filter((key) => Object.hasOwn(english, key)).map((key) => [key, english[key]]))
    : undefined;
  if (!sameCatalog(canonicalCatalog, englishCanonical)) {
    registryIssues.push('locales/en.json must preserve the canonical diagnostic text in game/validation/catalogs/en.json.');
  }

  const uiKey = /^ui\.[a-z][a-z0-9._-]*$/;
  for (const key of Object.keys(isCatalog(english) ? english : {})) {
    if (!Object.hasOwn(canonicalCatalog, key) && !registryKeys.has(key) && !uiKey.test(key)) {
      registryIssues.push(`unexpected root catalog key ${key}; expected a registered error or ui.* key`);
    }
  }

  report.issues.push(...registryIssues);
  return addExactKeySetIssues(report);
}

function formatExampleReport(report) {
  const lines = [`i18n-check: examples locales=${report.results.length} base-keys=${report.baseKeys.length} threshold=100.0%`];
  for (const result of report.results) {
    const missing = result.missing.length > 0 ? result.missing.join(', ') : 'none';
    lines.push(`i18n-check: examples ${result.locale} ${result.present}/${result.total} ${(result.coverage * 100).toFixed(1)}% missing=[${missing}]`);
  }
  for (const issue of report.issues) lines.push(`i18n-check: examples ERROR ${issue}`);
  lines.push(report.ok ? 'i18n-check: examples ok' : `i18n-check: examples fail=${report.issues.length}`);
  return lines.join('\n');
}

export function checkExampleCatalogs({ directory = EXAMPLE_LOCALE_DIR } = {}) {
  const catalogs = readCatalogs(directory, EXAMPLE_LOCALES);
  const report = evaluateCatalogs({
    baseCatalog: catalogs.en,
    catalogs,
    locales: EXAMPLE_LOCALES,
    threshold: 1,
  });
  const exampleEnglish = isCatalog(catalogs.en) ? catalogs.en : {};
  for (const namespace of ['ui.', 'game.', 'entity.']) {
    if (!Object.keys(exampleEnglish).some((key) => key.startsWith(namespace))) {
      report.issues.push(`examples/locales/en.json must include ${namespace} keys`);
    }
  }
  const productionCatalogs = loadProductionCatalogs();
  const requiredUiKeys = Object.keys(productionCatalogs.en ?? {}).filter((key) => key.startsWith('ui.'));
  for (const locale of EXAMPLE_LOCALES) {
    const exampleCatalog = catalogs[locale];
    const productionCatalog = productionCatalogs[locale];
    for (const key of requiredUiKeys) {
      if (!Object.hasOwn(exampleCatalog ?? {}, key)) report.issues.push(`examples/locales/${locale}.json is missing ${key}`);
      else if (exampleCatalog[key] !== productionCatalog?.[key]) {
        report.issues.push(`examples/locales/${locale}.json must match locales/${locale}.json for ${key}`);
      }
    }
  }
  addExactKeySetIssues(report);
  return report;
}

function main() {
  try {
    const productionReport = checkProductionCatalogs();
    const exampleReport = checkExampleCatalogs();
    process.stdout.write(`${formatReport(productionReport)}\n`);
    process.stdout.write(`${formatExampleReport(exampleReport)}\n`);
    const ok = productionReport.ok && exampleReport.ok;
    process.stdout.write(`i18n-check: overall ${ok ? 'ok' : 'fail'}\n`);
    if (!ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`i18n-check: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

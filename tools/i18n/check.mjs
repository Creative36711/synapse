import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../game/i18n/index.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CANONICAL_EN_PATH = join(REPO_ROOT, 'game/validation/catalogs/en.json');
const LOCALE_DIR = join(REPO_ROOT, 'locales');
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

export function checkProductionCatalogs({ directory = LOCALE_DIR, canonicalPath = CANONICAL_EN_PATH } = {}) {
  const baseCatalog = JSON.parse(readFileSync(canonicalPath, 'utf8'));
  const catalogs = loadProductionCatalogs(directory);
  const report = evaluateCatalogs({ baseCatalog, catalogs });
  if (!sameCatalog(catalogs[DEFAULT_LOCALE], baseCatalog)) {
    report.issues.push('locales/en.json must match game/validation/catalogs/en.json exactly to preserve the diagnostic text contract.');
    report.ok = false;
  }
  return report;
}

function main() {
  try {
    const report = checkProductionCatalogs();
    process.stdout.write(`${formatReport(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`i18n-check: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

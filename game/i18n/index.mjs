import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = Object.freeze([
  'en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko',
]);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALE_DIR = join(REPO_ROOT, 'locales');
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function loadCatalogs(directory = LOCALE_DIR) {
  const catalogs = {};
  for (const locale of SUPPORTED_LOCALES) {
    try {
      catalogs[locale] = JSON.parse(readFileSync(join(directory, `${locale}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') catalogs[locale] = {};
      else throw error;
    }
  }
  return catalogs;
}

function selectedLocale(requested) {
  return SUPPORTED_LOCALES.includes(requested) ? requested : DEFAULT_LOCALE;
}

function stringifyParameter(value) {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? '' : serialized;
}

export function interpolate(template, params = {}) {
  return template.replace(PLACEHOLDER, (_match, name) => (
    Object.hasOwn(params, name) ? stringifyParameter(params[name]) : ''
  ));
}

/**
 * Build a local translator. Unknown locale requests select English; a missing key
 * in a supported locale is deliberately not silently replaced with English.
 */
export function createI18n({ locale = DEFAULT_LOCALE, catalogs = loadCatalogs() } = {}) {
  let activeLocale = selectedLocale(locale);

  function translate(key, params = {}) {
    const template = catalogs[activeLocale]?.[key];
    if (typeof template !== 'string') return undefined;
    return interpolate(template, params);
  }

  return {
    get locale() {
      return activeLocale;
    },
    setLocale(requested) {
      activeLocale = selectedLocale(requested);
      return activeLocale;
    },
    t: translate,
    formatDiagnostic(diagnostic) {
      const key = diagnostic.catalogKey ?? `errors.${diagnostic.code}`;
      return { ...diagnostic, message: translate(key, diagnostic.params ?? {}) };
    },
  };
}

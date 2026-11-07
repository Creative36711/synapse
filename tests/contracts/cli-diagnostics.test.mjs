// Диагностика CLI и реестр кодов: одна форма кода, catalogKey без подмены, тексты во всех каталогах.
//
// Проверяется то, что до этой карточки держалось на честном слове:
//   1) у каждого кода реестра есть ключ во всех восьми каталогах и наоборот;
//   2) код, который CLI печатает через каталог, есть в реестре ровно в одной форме;
//   3) catalogKey = "errors." + code: override допустим только для перечисленных расхождений;
//   4) список расхождений в тесте и в docs/decisions/SYN-2.md совпадает, поэтому расширить его
//      «тихо» нельзя.
//
// Всё офлайн: только файлы репозитория (INV-1).

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { REPO_ROOT, readJson, readText, registryCodes } from './lib/contracts.mjs';

const CLI_MAIN = join(REPO_ROOT, 'game/cli/main.gd');
const LOCALES_DIR = join(REPO_ROOT, 'locales');
const DECISION_S10 = join(REPO_ROOT, 'docs/decisions/SYN-2.md');
const SUPPORTED_LOCALES = ['en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko'];

// Расхождения, подтверждённые аудитом на BASE_SHA f821d0e5 и переданные карточке зоны `game/**`.
// Список обязан совпадать с разделом S-10 в docs/decisions/SYN-2.md — это проверяет последний тест.
const KNOWN_CODE_DEVIATIONS = ['cli.dependency.node_missing', 'cli.run.render_failed'];
const KNOWN_CATALOG_OVERRIDES = ['errors.cli.dependency.node-missing', 'errors.runtime.engine.missing'];

const localeCatalog = (locale) => readJson(join(LOCALES_DIR, `${locale}.json`));

/**
 * Разбирает вызовы `_emit_catalog_error(...)` из GDScript без исполнения кода.
 *
 * Считаем скобки и кавычки вручную: нужен номер аргумента, а регулярка на строку
 * сломалась бы на переносе вызова. Возвращает код (1-й аргумент) и override-ключ (5-й), если он есть.
 */
function catalogCalls(source) {
  const calls = [];
  const needle = '_emit_catalog_error(';
  let index = source.indexOf(needle);
  while (index !== -1) {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    if (source.slice(lineStart, index).includes('func ')) {
      // Объявление функции, а не вызов: первый аргумент там — имя параметра, а не код.
      index = source.indexOf(needle, index + needle.length);
      continue;
    }
    let depth = 0;
    let inString = false;
    let current = '';
    const args = [];
    let cursor = index + needle.length - 1;
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (inString) {
        current += char;
        if (char === '\\') {
          current += source[cursor + 1] ?? '';
          cursor += 1;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        current += char;
        continue;
      }
      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        if (depth > 1) current += char;
        continue;
      }
      if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
        if (depth === 0) {
          args.push(current.trim());
          break;
        }
        current += char;
        continue;
      }
      if (char === ',' && depth === 1) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    const literal = (value) => {
      const match = /^"([^"]*)"$/.exec(value ?? '');
      return match ? match[1] : '';
    };
    calls.push({
      code: literal(args[0]),
      override: literal(args[4]),
      argumentCount: args.length,
      line: source.slice(0, index).split('\n').length,
    });
    index = source.indexOf(needle, cursor);
  }
  return calls;
}

describe('диагностика CLI и реестр кодов', () => {
  const codes = registryCodes();
  const registrCodes = new Set(codes.map((entry) => entry.code));
  const calls = catalogCalls(readText(CLI_MAIN));

  test('каталоги: ровно восемь локалей и одинаковый набор ключей', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = localeCatalog(locale);
      assert.ok(catalog && typeof catalog === 'object', `${locale}: каталог не читается`);
      assert.deepEqual(
        Object.keys(catalog).sort(),
        Object.keys(localeCatalog('en')).sort(),
        `${locale}: набор ключей расходится с en`,
      );
    }
  });

  test('у каждого кода реестра есть текст во всех восьми каталогах', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = localeCatalog(locale);
      for (const entry of codes) {
        assert.equal(
          typeof catalog[entry.catalogKey],
          'string',
          `${locale}: нет текста для ${entry.code} (${entry.catalogKey})`,
        );
        assert.ok(catalog[entry.catalogKey].trim().length > 0, `${locale}: пустой текст для ${entry.code}`);
      }
    }
  });

  test('ключ errors.* в каталогах не живёт без строки в реестре', () => {
    const catalogKeys = Object.keys(localeCatalog('en')).filter((key) => key.startsWith('errors.'));
    const registryKeys = new Set(codes.map((entry) => entry.catalogKey));
    const orphans = catalogKeys.filter((key) => !registryKeys.has(key));
    assert.deepEqual(orphans, [], 'ключи каталога без кода в реестре: реестр и каталог разъехались');
  });

  test('CLI печатает через каталог только коды реестра, кроме перечисленных расхождений', () => {
    assert.ok(calls.length > 0, 'в game/cli/main.gd не найдено ни одного вызова _emit_catalog_error');
    const unknown = calls
      .filter((call) => call.code && !registrCodes.has(call.code))
      .map((call) => call.code);
    const undocumented = [...new Set(unknown)].filter((code) => !KNOWN_CODE_DEVIATIONS.includes(code));
    assert.deepEqual(undocumented, [], 'код диагностики вне реестра и вне списка расхождений');
    assert.deepEqual(
      [...new Set(unknown)].sort(),
      [...KNOWN_CODE_DEVIATIONS].sort(),
      'список расхождений устарел: код исправлен или появился новый',
    );
  });

  test('catalogKey всегда выводится из кода; override — только из списка расхождений', () => {
    for (const call of calls) {
      assert.ok(call.code, `строка ${call.line}: у вызова _emit_catalog_error нет строкового кода`);
      const forms = codes.filter((entry) => entry.code === call.code).length;
      assert.ok(forms <= 1, `строка ${call.line}: код ${call.code} есть в реестре ${forms} раза`);
      if (!call.override) {
        // §9: код состоит из сегментов через точку, подчёркиваний не бывает.
        assert.ok(
          !call.code.includes('_') || KNOWN_CODE_DEVIATIONS.includes(call.code),
          `строка ${call.line}: подчёркивание в коде ${call.code} вне списка расхождений`,
        );
        continue;
      }
      assert.ok(
        KNOWN_CATALOG_OVERRIDES.includes(call.override),
        `строка ${call.line}: override ${call.override} не описан как расхождение`,
      );
    }
    const observedOverrides = [...new Set(calls.map((call) => call.override).filter(Boolean))].sort();
    assert.deepEqual(
      observedOverrides,
      [...KNOWN_CATALOG_OVERRIDES].sort(),
      'список override-расхождений устарел: подмена исправлена или появилась новая',
    );
  });

  test('список расхождений в тесте совпадает с записью решения', () => {
    const decision = readText(DECISION_S10);
    for (const marker of [...KNOWN_CODE_DEVIATIONS, ...KNOWN_CATALOG_OVERRIDES]) {
      assert.ok(decision.includes(marker), `docs/decisions/SYN-2.md не описывает расхождение ${marker}`);
    }
    assert.match(decision, /S-10/, 'в записи решения нет раздела S-10');
  });
});

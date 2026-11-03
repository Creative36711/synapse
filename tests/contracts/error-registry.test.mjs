// Реестр кодов ошибок: форма, единый контракт params, сверка с документацией.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  REGISTRY_FILE,
  REGISTRY_SCHEMA,
  compileSchema,
  documentedCodes,
  readJson,
  registryCodes,
} from './lib/contracts.mjs';

const BASE_PARAMS = ['path', 'expected', 'actual'];
const STAGE_TO_MISSION = { structural: 'K-2', semantic: 'K-3', resolution: 'K-4' };
const LOCALES = ['en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko'];

describe('реестр кодов ошибок', () => {
  const registry = readJson(REGISTRY_FILE);

  test('реестр проходит собственную схему', () => {
    const { validate } = compileSchema(REGISTRY_SCHEMA);
    assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  });

  test('каталог сообщений фиксирует восемь локалей и en по умолчанию (INV-10)', () => {
    assert.equal(registry.catalog.namespace, 'errors');
    assert.equal(registry.catalog.defaultLocale, 'en');
    assert.deepEqual(registry.catalog.locales, LOCALES);
    const keyPattern = new RegExp(registry.catalog.keyPattern);
    for (const entry of registryCodes()) {
      assert.match(entry.catalogKey, keyPattern);
    }
  });

  test('коды уникальны и названы по шаблону', () => {
    const codes = registryCodes().map((entry) => entry.code);
    assert.equal(new Set(codes).size, codes.length, 'код ошибки не может повторяться');
    for (const code of codes) {
      assert.match(code, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
    }
  });

  test('у каждого кода есть code, params(path, expected, actual) и ключ каталога', () => {
    for (const entry of registryCodes()) {
      assert.deepEqual(
        entry.params.slice(0, 3),
        BASE_PARAMS,
        `${entry.code}: базовые параметры идут первыми и в фиксированном порядке`,
      );
      assert.equal(entry.catalogKey, `errors.${entry.code}`, `${entry.code}: ключ каталога выводится из кода`);
      const extras = entry.extraParams ?? [];
      assert.equal(new Set(extras).size, extras.length, `${entry.code}: extraParams без повторов`);
      for (const extra of extras) {
        assert.ok(!BASE_PARAMS.includes(extra), `${entry.code}: ${extra} не может дублировать базовый параметр`);
      }
    }
  });

  test('код не хранит пользовательский текст, только ключ каталога (INV-9)', () => {
    for (const entry of registryCodes()) {
      for (const forbidden of ['message', 'text', 'title', 'rendered', 'label']) {
        assert.equal(entry[forbidden], undefined, `${entry.code}: поле ${forbidden} запрещено`);
      }
      assert.equal(typeof entry.summary, 'string');
    }
  });

  test('стадия проверки соответствует карточке, где она появляется', () => {
    for (const entry of registryCodes()) {
      assert.equal(
        entry.implementedIn,
        STAGE_TO_MISSION[entry.stage],
        `${entry.code}: stage=${entry.stage} должен относиться к ${STAGE_TO_MISSION[entry.stage]}`,
      );
    }
  });

  test('минимальный обязательный набор кодов присутствует', () => {
    const codes = new Set(registryCodes().map((entry) => entry.code));
    for (const required of ['field.unknown', 'field.type', 'module.dependency.cycle', 'locale.key.missing']) {
      assert.ok(codes.has(required), `в реестре нет обязательного кода ${required}`);
    }
  });

  test('цикл модулей — ошибка, а не предупреждение (INV-5)', () => {
    const cycle = registry.codes.find((entry) => entry.code === 'module.dependency.cycle');
    assert.ok(cycle, 'код цикла обязателен');
    assert.equal(cycle.stage, 'resolution');
    assert.equal(cycle.implementedIn, 'K-4', 'диагностику цикла реализует резолвер K-4, не K-2');
    assert.ok(cycle.extraParams.includes('cycle'));
  });

  test('реестр и docs/contracts/errors.md описывают один и тот же набор кодов', () => {
    const documented = documentedCodes();
    const registered = new Set(registryCodes().map((entry) => entry.code));
    assert.ok(documented.size > 0, 'в документации нет таблицы кодов');
    const missingInDocs = [...registered].filter((code) => !documented.has(code));
    const missingInRegistry = [...documented].filter((code) => !registered.has(code));
    assert.deepEqual(missingInDocs, [], 'коды без строки в документации');
    assert.deepEqual(missingInRegistry, [], 'документация обещает коды, которых нет в реестре');
  });
});

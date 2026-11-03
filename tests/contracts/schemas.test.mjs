// Свойства самих схем: версия диалекта, офлайн-безопасность, компиляция, общие определения.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  REPO_ROOT,
  collectRefs,
  compileSchema,
  loadAllCaseSets,
  readJson,
} from './lib/contracts.mjs';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const sharedDefinitions = [
  'moduleId',
  'sceneId',
  'translationKey',
  'semver',
  'versionRange',
  'locale',
];

describe('схемы контрактов', () => {
  const sets = loadAllCaseSets();

  for (const set of sets) {
    test(`${set.name}: схема объявляет диалект JSON Schema 2020-12`, () => {
      const schema = readJson(set.schemaPath);
      assert.equal(schema.$schema, DRAFT_2020_12);
      assert.equal(typeof schema.$id, 'string');
      assert.equal(typeof schema.title, 'string');
    });

    test(`${set.name}: $id нерезолвируемый, чтобы проверка не ходила в сеть`, () => {
      const schema = readJson(set.schemaPath);
      // .invalid зарезервирован RFC 2606: адрес не может быть случайно доступен из песочницы.
      assert.match(schema.$id, /^https:\/\/schema\.synapse\.invalid\//);
    });

    test(`${set.name}: все $ref внутренние`, () => {
      const schema = readJson(set.schemaPath);
      const refs = collectRefs(schema);
      assert.ok(refs.length > 0, 'схема должна использовать $defs, иначе определения не переиспользуются');
      for (const ref of refs) {
        assert.match(ref, /^#\//, `внешняя ссылка запрещена (INV-1): ${ref}`);
      }
    });

    test(`${set.name}: схема компилируется в строгом режиме Ajv`, () => {
      const { validate } = compileSchema(set.schemaPath);
      assert.equal(typeof validate, 'function');
    });
  }

  test('GameSpec требует обязательные поля контракта', () => {
    const schema = readJson(join(REPO_ROOT, 'schema/gamespec.schema.json'));
    assert.deepEqual(schema.required, ['specVersion', 'game', 'entry']);
    assert.deepEqual(schema.$defs.game.required, ['id', 'version', 'titleKey']);
    assert.deepEqual(schema.$defs.entry.required, ['scene']);
    assert.deepEqual(schema.$defs.locales.required, ['default', 'supported']);
    assert.ok(schema.$defs.moduleRef, 'ссылка на модуль должна быть определена');
  });

  test('манифест модуля требует версию модуля, зависимости и конфликты', () => {
    const schema = readJson(join(REPO_ROOT, 'schema/module-manifest.schema.json'));
    assert.deepEqual(schema.required, ['specVersion', 'module', 'requires']);
    assert.deepEqual(schema.$defs.module.required, ['id', 'version', 'titleKey']);
    assert.deepEqual(schema.$defs.dependency.required, ['id', 'version']);
    assert.deepEqual(schema.$defs.conflict.required, ['id', 'version', 'reasonKey']);
    assert.deepEqual(schema.$defs.requires.required, ['spec', 'engine']);
    assert.deepEqual(schema.$defs.provides.required, ['scenes']);
  });

  test('определения не допускают изменяемого состояния экземпляра (INV-4)', () => {
    for (const file of ['schema/gamespec.schema.json', 'schema/module-manifest.schema.json']) {
      const schema = readJson(join(REPO_ROOT, file));
      assert.equal(schema.additionalProperties, false, `${file}: корень закрыт для лишних полей`);
      for (const [name, definition] of Object.entries(schema.$defs)) {
        if (definition?.type === 'object') {
          assert.equal(
            definition.additionalProperties,
            false,
            `${file}#$defs.${name}: объект должен быть закрыт для лишних полей`,
          );
        }
      }
      const text = JSON.stringify(schema);
      for (const forbidden of ['"state"', '"runtime"', '"save"', '"genre"']) {
        assert.ok(!text.includes(forbidden), `${file}: поле ${forbidden} не описано контрактом`);
      }
    }
  });

  test('общие определения GameSpec и манифеста не расходятся', () => {
    const gamespec = readJson(join(REPO_ROOT, 'schema/gamespec.schema.json'));
    const manifest = readJson(join(REPO_ROOT, 'schema/module-manifest.schema.json'));
    for (const name of sharedDefinitions) {
      assert.deepEqual(
        manifest.$defs[name],
        gamespec.$defs[name],
        `определение ${name} должно совпадать в обеих схемах`,
      );
    }
    assert.ok(gamespec.$defs.gameId, 'GameSpec объявляет грамматику ID игры');
    assert.equal(manifest.$defs.gameId, undefined, 'манифесту ID игры не нужен');
  });

  test('схема реестра ошибок запрещает хранить пользовательский текст', () => {
    const schema = readJson(join(REPO_ROOT, 'schema/error-registry.schema.json'));
    const code = schema.$defs.code;
    assert.equal(code.additionalProperties, false);
    for (const forbidden of ['message', 'text', 'title', 'description']) {
      assert.equal(
        code.properties[forbidden],
        undefined,
        `реестр хранит catalogKey, а не текст: поле ${forbidden} запрещено (INV-9)`,
      );
    }
    assert.deepEqual(code.required, [
      'code',
      'stage',
      'implementedIn',
      'summary',
      'params',
      'catalogKey',
    ]);
  });
});

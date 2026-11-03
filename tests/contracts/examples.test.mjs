// Контрактные примеры: валидные проходят, невалидные падают там, где заявлено,
// и с тем кодом, который записан в реестре.

import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { describe, test } from 'node:test';

import {
  REPO_ROOT,
  YamlContractError,
  codeIndex,
  compileSchema,
  errorPath,
  loadAllCaseSets,
  parseYamlStrict,
  readText,
} from './lib/contracts.mjs';

function parseExample(file) {
  const text = readText(file);
  if (file.endsWith('.json')) return { value: JSON.parse(text), warnings: [] };
  const parsed = parseYamlStrict(text, file);
  return { value: parsed.value, warnings: parsed.warnings };
}

const shortName = (file) => relative(REPO_ROOT, file);

describe('контрактные примеры', () => {
  const sets = loadAllCaseSets();

  for (const set of sets) {
    test(`${set.name}: есть и валидные, и невалидные примеры`, () => {
      assert.ok(set.valid.length >= 1, `${set.name}: нужен минимальный валидный пример`);
      assert.ok(set.invalid.length >= 1, `${set.name}: нужен пример ошибки`);
    });

    const { validate } = compileSchema(set.schemaPath);

    for (const file of set.valid) {
      test(`${set.name}: валидный пример ${shortName(file)} проходит`, () => {
        const { value, warnings } = parseExample(file);
        assert.equal(warnings.length, 0, `${shortName(file)}: предупреждений разбора быть не должно`);
        const ok = validate(value);
        assert.equal(
          ok,
          true,
          `${shortName(file)} должен проходить, ошибки: ${JSON.stringify(validate.errors)}`,
        );
      });
    }

    for (const entry of set.invalid) {
      test(`${set.name}: ${shortName(entry.absolutePath)} падает с ${entry.code}`, () => {
        assert.ok(codeIndex().has(entry.code), `${entry.code}: кода нет в реестре`);

        if (entry.phase === 'parse') {
          assert.throws(
            () => parseExample(entry.absolutePath),
            (error) => {
              assert.ok(error instanceof YamlContractError, 'ожидалась ошибка разбора YAML');
              assert.equal(error.code, entry.code);
              return true;
            },
          );
          return;
        }

        const { value } = parseExample(entry.absolutePath);
        const ok = validate(value);
        assert.equal(ok, false, `${shortName(entry.absolutePath)} обязан падать`);
        const errors = validate.errors ?? [];
        const paths = errors.map(errorPath);
        assert.ok(
          paths.includes(entry.path),
          `ожидался путь ${entry.path}, получены: ${JSON.stringify(paths)}`,
        );
        if (entry.keyword) {
          assert.ok(
            errors.some((error) => errorPath(error) === entry.path && error.keyword === entry.keyword),
            `ожидалось ключевое слово ${entry.keyword} по пути ${entry.path}`,
          );
        }
      });
    }
  }

  test('каждый код стадии K-2 подтверждён хотя бы одним примером', () => {
    const covered = new Set();
    for (const set of loadAllCaseSets()) {
      for (const entry of set.invalid) covered.add(entry.code);
    }
    const expected = [...codeIndex().values()].filter((entry) => entry.implementedIn === 'K-2');
    assert.ok(expected.length >= 4, 'реестр должен содержать минимум четыре кода K-2');
    for (const entry of expected) {
      assert.ok(covered.has(entry.code), `код ${entry.code} не подтверждён ни одним примером`);
    }
  });

  test('невалидные примеры не проходят молча и по правильной причине', () => {
    for (const set of loadAllCaseSets()) {
      const { validate } = compileSchema(set.schemaPath);
      for (const entry of set.invalid) {
        if (entry.phase !== 'schema') continue;
        const { value } = parseExample(entry.absolutePath);
        assert.equal(validate(value), false);
        const codes = new Set(validate.errors.map((error) => error.keyword));
        assert.ok(codes.size > 0, `${shortName(entry.absolutePath)}: пустой список ошибок`);
      }
    }
  });
});

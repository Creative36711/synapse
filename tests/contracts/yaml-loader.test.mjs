// Правила чтения YAML-черновика: запрет повторов ключей, YAML 1.2 core, отсутствие сюрпризов.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  YamlContractError,
  loadAllCaseSets,
  parseYamlStrict,
  readText,
} from './lib/contracts.mjs';

const expectCode = (text, code) => {
  assert.throws(
    () => parseYamlStrict(text, 'inline.yaml'),
    (error) => {
      assert.ok(error instanceof YamlContractError, 'ожидалась YamlContractError');
      assert.equal(error.code, code);
      return true;
    },
  );
};

describe('чтение YAML', () => {
  test('повтор ключа на верхнем уровне запрещён', () => {
    expectCode('specVersion: "1.0"\nspecVersion: "1.1"\n', 'yaml.duplicate-key');
  });

  test('повтор ключа во вложенном отображении запрещён', () => {
    expectCode('game:\n  id: "a.b"\n  id: "c.d"\n', 'yaml.duplicate-key');
  });

  test('повтор ключа внутри элемента последовательности запрещён', () => {
    expectCode('dependencies:\n  - id: "a.b.c"\n    id: "d.e.f"\n', 'yaml.duplicate-key');
  });

  test('синтаксическая ошибка даёт yaml.syntax, а не молчаливый null', () => {
    expectCode('game:\n  id: "a.b"\n   version: "1.0.0"\n', 'yaml.syntax');
    expectCode('key: [unclosed\n', 'yaml.syntax');
  });

  test('YAML 1.2 core: нет неявных дат, «yes/no» не становятся булевыми', () => {
    const { value } = parseYamlStrict('when: 2026-11-03\nflag: yes\nport: 8080\n');
    assert.equal(value.when, '2026-11-03');
    assert.equal(typeof value.when, 'string');
    assert.equal(value.flag, 'yes');
    assert.equal(value.port, 8080);
  });

  test('merge-ключ << не раскрывается: контракт не наследует YAML 1.1', () => {
    const { value } = parseYamlStrict('base: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2\n');
    assert.deepEqual(Object.keys(value.child).sort(), ['<<', 'y']);
    assert.equal(value.child.x, undefined);
  });

  test('якорь и алиас читаются как обычное значение', () => {
    const { value } = parseYamlStrict('defaults: &d\n  locale: en\ncopy: *d\n');
    assert.deepEqual(value.copy, { locale: 'en' });
    assert.deepEqual(value.defaults, { locale: 'en' });
  });

  test('пустой документ — null, а не исключение: тип ловит схема', () => {
    const { value } = parseYamlStrict('');
    assert.equal(value, null);
  });

  test('YAML-примеры читаются в JSON-совместимые значения', () => {
    for (const set of loadAllCaseSets()) {
      const parsePhase = new Set(
        set.invalid.filter((entry) => entry.phase === 'parse').map((entry) => entry.absolutePath),
      );
      const files = [...set.valid, ...set.invalid.map((entry) => entry.absolutePath)];
      for (const file of files) {
        if (!file.endsWith('.yaml') || parsePhase.has(file)) continue;
        const text = readText(file);
        const parsed = parseYamlStrict(text, file);
        const json = JSON.stringify(parsed.value);
        assert.deepEqual(JSON.parse(json), parsed.value, `${file}: значение не сериализуется в JSON`);
        assert.ok(!(json.includes('"__yaml')), `${file}: в значении остались служебные типы`);
      }
    }
  });
});

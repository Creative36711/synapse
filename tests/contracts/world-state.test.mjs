// Отпечаток мира: две формы, правило сравнения и негативные фикстуры.
//
// Контракт говорит, что именно значит «отпечатки равны» (INV-15), поэтому проверки здесь
// не декоративные: они пересчитывают хеши срезов и проверяют, что заявленная разница
// (перевод → presentation, сдвиг геометрии от локали → rules) действительно видна в документах,
// а версии v1 и v2 не смешиваются.
//
// Всё офлайн: только файлы репозитория и node:crypto (INV-1).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { REPO_ROOT, compileSchema, readJson, readText, walk } from './lib/contracts.mjs';

const V1_DIR = join(REPO_ROOT, 'schema/examples/world-state-v1');
const V2_DIR = join(REPO_ROOT, 'schema/examples/world-state-v2');
const V1_SCHEMA = join(REPO_ROOT, 'schema/world-state.v1.schema.json');
const V2_SCHEMA = join(REPO_ROOT, 'schema/world-state.v2.schema.json');
const WORLD_STATE_DOC = join(REPO_ROOT, 'docs/contracts/world-state.md');

/** Канонический JSON: ключи по возрастанию, без пробелов, числа — как их пишет JSON.stringify. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

/** Срез документа без собственного хеша — ровно то, что хешируется. */
const rulesSubject = (document) => ({ frame: document.rules.frame, nodes: document.rules.nodes });
const presentationSubject = (document) => ({
  locale: document.presentation.locale,
  nodes: document.presentation.nodes,
});

const withoutArtifact = ({ artifact, ...rest }) => rest;

const v2ValidFiles = walk(join(V2_DIR, 'valid'), '.json');

const collectPresentationProperties = (document) => {
  const found = {};
  for (const entry of document.presentation.nodes) {
    for (const [name, value] of Object.entries(entry.properties)) {
      found[name] = (found[name] || 0) + 1;
      assert.equal(typeof value, 'string', `${entry.path}: переводимое поле ${name} должно быть строкой`);
    }
  }
  return found;
};

const nodePaths = (node, found = []) => {
  found.push(node.path);
  for (const child of node.children) nodePaths(child, found);
  return found;
};

describe('отпечаток мира v2 и восстановленный v1', () => {
  test('спецификация отпечатка создана и перечисляет оба среза, artifact и fingerprintScope', () => {
    assert.ok(existsSync(WORLD_STATE_DOC), 'нет docs/contracts/world-state.md');
    const text = readText(WORLD_STATE_DOC);
    for (const marker of [
      'synapse.world-state.v2',
      'synapse.world-state.v1',
      '`rules`',
      '`presentation`',
      '`artifact`',
      'fingerprintScope',
      'INV-12',
      'INV-15',
      'D-058',
      'фикстура (а)',
      'фикстура (б)',
    ]) {
      assert.ok(text.includes(marker), `world-state.md: нет маркера «${marker}»`);
    }
  });

  test('v1-документ текущего эмиттера валиден по v1-схеме', () => {
    const { validate } = compileSchema(V1_SCHEMA);
    const captured = readJson(join(V1_DIR, 'emitter-arena-frames-1.json'));
    const ok = validate(captured);
    assert.equal(ok, true, `документ эмиттера не проходит v1-схему: ${JSON.stringify(validate.errors)}`);
    assert.equal(captured.format, 'synapse.world-state.v1');
  });

  test('v1 и v2 не смешиваются: чужая версия не проходит схему', () => {
    const v1 = compileSchema(V1_SCHEMA).validate;
    const v2 = compileSchema(V2_SCHEMA).validate;
    const v1Document = readJson(join(V1_DIR, 'emitter-arena-frames-1.json'));
    const v2Document = readJson(join(V2_DIR, 'valid/translation.en.json'));
    assert.equal(v1(v2Document), false, 'документ v2 не должен проходить v1-схему');
    assert.equal(v2(v1Document), false, 'документ v1 не должен проходить v2-схему');
    const errors = v2.errors ?? [];
    assert.ok(
      errors.some((error) => error.instancePath === '/format'),
      `ожидалась ошибка по /format, получены: ${JSON.stringify(errors.map((error) => error.instancePath))}`,
    );
  });

  test('хеши срезов и artifact пересчитываются каноническим JSON', () => {
    for (const file of v2ValidFiles) {
      const document = readJson(file);
      assert.equal(document.rules.hash, sha256(rulesSubject(document)), `${file}: хеш среза rules`);
      assert.equal(
        document.presentation.hash,
        sha256(presentationSubject(document)),
        `${file}: хеш среза presentation`,
      );
      assert.equal(document.artifact.hash, sha256(withoutArtifact(document)), `${file}: хеш artifact`);
    }
  });

  test('фикстура (б): перевод различает presentation, но не rules', () => {
    const en = readJson(join(V2_DIR, 'valid/translation.en.json'));
    const de = readJson(join(V2_DIR, 'valid/translation.de.json'));
    assert.equal(en.rules.hash, de.rules.hash, 'rules обязаны быть равны: перевод не меняет правил (INV-12)');
    assert.deepEqual(rulesSubject(en), rulesSubject(de), 'срез rules обязан совпадать побайтово');
    assert.notEqual(en.presentation.hash, de.presentation.hash, 'presentation обязана различаться (INV-15)');

    const different = new Set();
    for (const field of ['text', 'tooltip_text', 'title']) {
      const left = en.presentation.nodes.map((entry) => entry.properties[field]).filter((value) => value !== undefined);
      const right = de.presentation.nodes.map((entry) => entry.properties[field]).filter((value) => value !== undefined);
      if (JSON.stringify(left) !== JSON.stringify(right)) different.add(field);
    }
    assert.ok(
      different.size > 0,
      'presentation различается только полем locale — это прошло бы и на полностью непереведённом UI',
    );
  });

  test('фикстура (а): геометрия, зависящая от локали, обязана различать rules', () => {
    const en = readJson(join(V2_DIR, 'valid/locale-geometry.en.json'));
    const de = readJson(join(V2_DIR, 'valid/locale-geometry.de.json'));
    assert.notEqual(en.rules.hash, de.rules.hash, 'сдвиг геометрии от локали обязан ломать равенство rules');
    assert.notDeepEqual(rulesSubject(en), rulesSubject(de));
    const position = (document) => document.rules.nodes.children[1].properties.position;
    assert.notDeepEqual(position(en), position(de), 'различие должно быть видно в геометрии, а не в хеше');
  });

  test('frame входит в rules и различается между прогонами', () => {
    const zero = readJson(join(V2_DIR, 'valid/frame-0.en.json'));
    const sixty = readJson(join(V2_DIR, 'valid/translation.en.json'));
    assert.equal(zero.rules.frame, 0);
    assert.equal(sixty.rules.frame, 60);
    assert.notEqual(zero.rules.hash, sixty.rules.hash, 'разное число кадров — разные rules');
    assert.equal(zero.presentation.hash, sixty.presentation.hash, 'кадр не входит в presentation');
  });

  test('fingerprintScope объявляет ровно те поля, которые допускает схема', () => {
    const schema = readJson(V2_SCHEMA);
    const document = readJson(join(V2_DIR, 'valid/translation.en.json'));
    assert.deepEqual(document.fingerprintScope.slices, ['rules', 'presentation']);
    assert.equal(document.fingerprintScope.rule, 'within-version-by-slice');

    const rulesProperties = Object.keys(schema.$defs.rulesProperties.properties).map(
      (name) => `rules.nodes[].properties.${name}`,
    );
    const declaredRules = document.fingerprintScope.fields.rules.filter((field) =>
      field.startsWith('rules.nodes[].properties.'),
    );
    assert.deepEqual(declaredRules.sort(), rulesProperties.sort(), 'объявленные поля rules разошлись со схемой');

    const presentationProperties = Object.keys(schema.$defs.presentationProperties.properties).map(
      (name) => `presentation.nodes[].properties.${name}`,
    );
    const declaredPresentation = document.fingerprintScope.fields.presentation.filter((field) =>
      field.startsWith('presentation.nodes[].properties.'),
    );
    assert.deepEqual(
      declaredPresentation.sort(),
      presentationProperties.sort(),
      'объявленные поля presentation разошлись со схемой',
    );

    for (const field of ['scene', 'rules.frame', 'rules.nodes[].class', 'rules.nodes[].path']) {
      assert.ok(document.fingerprintScope.fields.rules.includes(field), `в rules не объявлено ${field}`);
    }
    assert.ok(document.fingerprintScope.fields.presentation.includes('presentation.locale'));
  });

  test('presentation описывает только узлы, которые есть в rules, и только переводимые поля', () => {
    for (const file of v2ValidFiles) {
      const document = readJson(file);
      const paths = new Set(nodePaths(document.rules.nodes));
      for (const entry of document.presentation.nodes) {
        assert.ok(paths.has(entry.path), `${file}: presentation ссылается на узел ${entry.path}, которого нет в rules`);
      }
      const properties = collectPresentationProperties(document);
      for (const name of Object.keys(properties)) {
        assert.ok(
          ['text', 'tooltip_text', 'title'].includes(name),
          `${file}: поле ${name} не переводимое, ему не место в presentation`,
        );
      }
    }
  });

  test('ни в одном v1-документе нет локали, текста и кадра', () => {
    const text = walk(V1_DIR, '.json')
      .filter((file) => !file.includes('/invalid/'))
      .map((file) => readText(file))
      .join('\n');
    for (const forbidden of ['"locale"', '"text"', '"tooltip_text"', '"title"', '"frame"']) {
      assert.ok(!text.includes(forbidden), `v1 не должен знать про ${forbidden}`);
    }
  });
});

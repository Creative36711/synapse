// Пакет проверки контрактов: только devDependencies, точные версии, lockfile в синхроне.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { REPO_ROOT, readJson } from './lib/contracts.mjs';

const pkg = readJson(join(REPO_ROOT, 'package.json'));
const lockPath = join(REPO_ROOT, 'package-lock.json');
const allowedDevDependencies = new Set(['ajv', 'yaml']);

describe('пакет проверки контрактов', () => {
  test('runtime-зависимостей нет (INV-1)', () => {
    assert.equal(pkg.dependencies, undefined, 'ядру не нужны runtime-зависимости');
    assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ['ajv', 'yaml']);
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
      assert.ok(allowedDevDependencies.has(name), `${name}: лишняя зависимость проверки`);
    }
  });

  test('версии зависимостей зафиксированы точно, без диапазонов', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: версия должна быть точной`);
    }
  });

  test('lockfile есть и совпадает с package.json', () => {
    assert.ok(existsSync(lockPath), 'без package-lock.json команда npm ci не работает');
    const lock = readJson(lockPath);
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
    for (const name of Object.keys(pkg.devDependencies)) {
      const entry = lock.packages[`node_modules/${name}`];
      assert.ok(entry, `в lockfile нет ${name}`);
      assert.equal(entry.version, pkg.devDependencies[name], `${name}: версия в lockfile разошлась`);
      assert.equal(typeof entry.integrity, 'string', `${name}: нет integrity-хеша`);
    }
  });

  test('лицензия пакета согласована с MIT-ядром (INV-8)', () => {
    assert.equal(pkg.license, 'MIT');
  });

  test('проверка запускается одной командой и не прячет шаги в хуках', () => {
    assert.equal(pkg.scripts['check:contracts'], 'node tests/contracts/check-contracts.mjs');
    assert.ok(existsSync(join(REPO_ROOT, 'tests/contracts/check-contracts.mjs')));
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
      assert.equal(pkg.scripts[hook], undefined, `хук ${hook} запрещён: проверка должна быть явной`);
    }
  });

  test('node_modules не попадает в Git', () => {
    const text = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(text, /^node_modules\/$/m, 'node_modules/ должен быть в .gitignore');
  });
});

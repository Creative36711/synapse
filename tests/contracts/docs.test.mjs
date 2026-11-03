// Документация — часть контракта: границы K-2/K-3/K-4, «почему YAML», статус решения.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { DECISIONS_DOC, REPO_ROOT, readText, walk } from './lib/contracts.mjs';

const DOCS = {
  readme: join(REPO_ROOT, 'docs/contracts/README.md'),
  gamespec: join(REPO_ROOT, 'docs/contracts/gamespec.md'),
  manifest: join(REPO_ROOT, 'docs/contracts/module-manifest.md'),
  errors: join(REPO_ROOT, 'docs/contracts/errors.md'),
  localization: join(REPO_ROOT, 'docs/contracts/localization.md'),
  decisions: DECISIONS_DOC,
};

describe('документация контрактов', () => {
  test('все документы контракта существуют', () => {
    for (const [name, file] of Object.entries(DOCS)) {
      assert.ok(existsSync(file), `${name}: нет файла ${file}`);
    }
  });

  test('README объясняет «почему YAML» и ссылается на схемы', () => {
    const text = readText(DOCS.readme);
    assert.match(text, /##\s*Почему YAML/);
    assert.match(text, /JSON Schema 2020-12/);
    for (const path of [
      'schema/gamespec.schema.json',
      'schema/module-manifest.schema.json',
      'schema/error-registry.json',
    ]) {
      assert.ok(text.includes(path), `README не ссылается на ${path}`);
    }
  });

  test('README фиксирует границы K-2 и честно называет то, чего K-2 не делает', () => {
    const text = readText(DOCS.readme);
    const lower = text.toLowerCase();
    for (const marker of ['K-2', 'K-3', 'K-4', 'структурн', 'семантич', 'не реализует']) {
      assert.ok(lower.includes(marker.toLowerCase()), `README: нет обязательного маркера «${marker}»`);
    }
    assert.ok(text.includes('contract-check: ok'), 'README описывает машиночитаемый итог проверки');
  });

  test('документ GameSpec описывает смысловые ID и точку входа (INV-3)', () => {
    const text = readText(DOCS.gamespec);
    assert.ok(text.includes('schema/gamespec.schema.json'));
    for (const marker of ['INV-3', 'entry.scene', 'scene.main-menu', 'titleKey']) {
      assert.ok(text.includes(marker), `gamespec.md: нет маркера «${marker}»`);
    }
  });

  test('документ манифеста описывает зависимости, конфликты и диагностику цикла (INV-5)', () => {
    const text = readText(DOCS.manifest);
    assert.ok(text.includes('schema/module-manifest.schema.json'));
    for (const marker of ['dependencies', 'conflicts', 'module.dependency.cycle', 'INV-5', 'versionRange']) {
      assert.ok(text.includes(marker), `module-manifest.md: нет маркера «${marker}»`);
    }
  });

  test('документ ошибок задаёт params(path, expected, actual) и правило каталога', () => {
    const text = readText(DOCS.errors);
    for (const marker of ['path', 'expected', 'actual', 'catalogKey', 'INV-6', 'INV-9', 'INV-10']) {
      assert.ok(text.includes(marker), `errors.md: нет маркера «${marker}»`);
    }
    assert.match(text, /^\|\s*`code`\s*\|\s*`stage`\s*\|/m, 'ожидалась таблица реестра');
  });

  test('документ локализации перечисляет все восемь локалей', () => {
    const text = readText(DOCS.localization);
    for (const locale of ['en', 'ru', 'zh-Hans', 'ja', 'pt-BR', 'de', 'fr', 'ko']) {
      assert.ok(text.includes(locale), `localization.md: нет локали ${locale}`);
    }
    assert.ok(text.includes('locale.key.missing'));
  });

  test('запись решения содержит статус из допустимого набора', () => {
    const text = readText(DOCS.decisions);
    const match = /^Статус:\s*(proposed|accepted|rejected)\s*$/m.exec(text);
    assert.ok(match, 'ожидалась строка «Статус: proposed|accepted|rejected»');
    // Тест не замораживает proposed: принять или отклонить решение можно, не ломая проверку.
    assert.ok(['proposed', 'accepted', 'rejected'].includes(match[1]));
  });

  test('открытый вопрос в записи решения помечен как открытый', () => {
    const text = readText(DOCS.decisions);
    const status = /^Статус:\s*(proposed|accepted|rejected)\s*$/m.exec(text)[1];
    if (status === 'proposed') {
      assert.match(text, /Открытый вопрос:/, 'proposed без пометки открытого вопроса');
      assert.match(text, /default/i, 'у вопроса должен быть вариант по умолчанию');
      assert.match(text, /не (является|считается) принятием/, 'default не должен выглядеть как решение');
    }
  });

  test('в записи решения есть обратимые решения «неясно / решил / откат»', () => {
    const text = readText(DOCS.decisions);
    for (const marker of ['неясно', 'решил', 'откат']) {
      assert.ok(text.includes(marker), `SYN-1.md: нет строки «${marker}»`);
    }
  });

  test('документы не требуют доступа к cortex (INV-1)', () => {
    const files = walk(join(REPO_ROOT, 'docs'), '.md');
    for (const file of files) {
      assert.ok(!readText(file).includes('synapse-cortex'), `${file}: ссылка на закрытый репозиторий`);
    }
  });
});

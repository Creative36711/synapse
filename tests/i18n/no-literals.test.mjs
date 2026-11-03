import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findUserFacingLiterals } from '../../tools/i18n/no-literals.mjs';

const SCRIPT = fileURLToPath(new URL('../../tools/i18n/no-literals.mjs', import.meta.url));

test('a real display-property literal is reported and makes the checker exit non-zero', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'synapse-i18n-literal-'));
  try {
    const uiDirectory = join(projectRoot, 'game/ui');
    mkdirSync(uiDirectory, { recursive: true });
    writeFileSync(join(uiDirectory, 'menu.gd'), [
      'extends Control',
      'func _ready():',
      '    start_button.text = "Start Game"',
      '',
    ].join('\n'));

    const report = findUserFacingLiterals(projectRoot);
    assert.equal(report.filesScanned, 1);
    assert.deepEqual(report.violations, [{ file: 'game/ui/menu.gd', line: 3, property: 'text' }]);

    const result = spawnSync(process.execPath, [SCRIPT, '--root', resolve(projectRoot)], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ERROR game\/ui\/menu\.gd:3: literal assigned to display property text/);
    assert.match(result.stdout, /fail=1/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('catalog-backed display expressions are not mistaken for string literals', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'synapse-i18n-catalog-'));
  try {
    const uiDirectory = join(projectRoot, 'game/ui');
    mkdirSync(uiDirectory, { recursive: true });
    writeFileSync(join(uiDirectory, 'menu.gd'), [
      'extends Control',
      'func _ready():',
      '    start_button.text = tr("ui.menu.start")',
      '',
    ].join('\n'));
    const report = findUserFacingLiterals(projectRoot);
    assert.deepEqual(report.violations, []);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

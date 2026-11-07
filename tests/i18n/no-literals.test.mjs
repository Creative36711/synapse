import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findUserFacingLiterals } from '../../tools/i18n/no-literals.mjs';

const SCRIPT = fileURLToPath(new URL('../../tools/i18n/no-literals.mjs', import.meta.url));

function withProject(run) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'synapse-i18n-literal-'));
  mkdirSync(join(projectRoot, 'game'), { recursive: true });
  try {
    return run(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

function fixture(projectRoot, relativePath, source) {
  const path = join(projectRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function runChecker(projectRoot) {
  return spawnSync(process.execPath, [SCRIPT, '--root', resolve(projectRoot)], { encoding: 'utf8' });
}

test('a direct UI display-property assignment is reported and fails the CLI check', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/menu.gd', [
    'extends Control',
    'func _ready():',
    '    start_button.text = "Start Game"',
    '',
  ].join('\n'));

  const report = findUserFacingLiterals(projectRoot);
  assert.deepEqual(report.violations, [{
    file: 'game/ui/menu.gd', line: 3, mechanism: 'display-property', property: 'text',
  }]);
  const result = runChecker(projectRoot);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ERROR game\/ui\/menu\.gd:3: literal in display property text/);
}));

test('literal text in a Godot scene property is reported', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/menu.tscn', [
    '[gd_scene load_steps=1 format=3]',
    '[node name="StartButton" type="Button"]',
    'text = "Start Game"',
    '',
  ].join('\n'));
  const report = findUserFacingLiterals(projectRoot);
  assert.deepEqual(report.violations, [{
    file: 'game/ui/menu.tscn', line: 3, mechanism: 'display-property', property: 'text',
  }]);
  assert.equal(runChecker(projectRoot).status, 1);
}));

test('set_text, Godot CLI output and engine diagnostic sinks reject direct user strings', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/popup.gd', [
    'extends Label',
    'func _ready():',
    '    set_text("Continue")',
    '    print("Please continue")',
    '    printerr("Please continue")',
    '    push_error("Please continue")',
    '    push_warning("Please continue")',
    '',
  ].join('\n'));
  const report = findUserFacingLiterals(projectRoot);
  assert.deepEqual(report.violations.map(({ mechanism }) => mechanism), [
    'set_text', 'print', 'printerr', 'push_error', 'push_warning',
  ]);
  const result = runChecker(projectRoot);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /output call set_text/);
  assert.match(result.stdout, /output call print/);
}));

test('CLI stdout/stderr and console message literals are found in game and root cli sources', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/validation/validator.mjs', [
    'process.stdout.write("Please choose a game\\n");',
    'process.stderr.write("Could not read the game\\n");',
    'console.log("Game loaded");',
    'console.info("Game loaded, choose an option");',
    'console.warn("Game warning");',
    'console.error("Game error");',
    'console.debug("Game debug");',
    'console.info(`Game ready: ${name}`);',
    '',
  ].join('\n'));
  fixture(projectRoot, 'cli/start.cjs', 'console.log("Choose a language");\n');

  const report = findUserFacingLiterals(projectRoot);
  assert.equal(report.filesScanned, 2);
  assert.deepEqual(report.violations.map(({ mechanism }) => mechanism), [
    'console.log', 'process.stdout.write', 'process.stderr.write', 'console.log',
    'console.info', 'console.warn', 'console.error', 'console.debug', 'console.info',
  ]);
  assert.ok(report.scannedFiles.includes('cli/start.cjs'));
  const result = runChecker(projectRoot);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /paths=game\/\*\*\/\*\.gd,game\/\*\*\/\*\.tscn,game\/\*\*\/\*\.\{mjs,js,cjs\},cli\/\*\*\/\*\.\{mjs,js,cjs\}/);
  assert.match(result.stdout, /ERROR cli\/start\.cjs:1: literal in output call console\.log/);
}));

test('localized display and CLI expressions pass; catalog keys and diagnostic codes remain technical', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/menu.gd', [
    'extends Control',
    'func _ready():',
    '    start_button.text = tr("ui.menu.start")',
    '    start_button.set_text(tr("ui.menu.start"))',
    '',
  ].join('\n'));
  fixture(projectRoot, 'game/validation/validator.mjs', [
    'process.stdout.write(i18n.t("errors.cli.usage"));',
    'console.error(`${i18n.t("errors.cli.usage")}\\n`);',
    'process.stderr.write(`${error.code ?? \'validation.error\'}\\n`);',
    'console.log(catalog["errors.cli.usage"]);',
    '',
  ].join('\n'));

  const report = findUserFacingLiterals(projectRoot);
  assert.deepEqual(report.violations, []);
  const result = runChecker(projectRoot);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /user-facing-literals=0/);
}));

test('comments are not treated as executable UI or CLI output', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/menu.gd', '# button.text = "comment only"\n# print("comment only")\n');
  fixture(projectRoot, 'cli/entry.mjs', '// console.log("comment only")\n/* process.stdout.write("comment only") */\n');
  assert.deepEqual(findUserFacingLiterals(projectRoot).violations, []);
}));

test('all supported display properties are detected in GDScript and scene resources', () => withProject((projectRoot) => {
  const properties = ['text', 'tooltip_text', 'placeholder_text', 'window_title', 'title'];
  fixture(projectRoot, 'game/ui/hud.gd', [
    'extends Control',
    'func _ready():',
    ...properties.map((property) => `    self.${property} = "Literal ${property}"`),
    '',
  ].join('\n'));
  fixture(projectRoot, 'game/ui/hud.tscn', [
    '[gd_scene load_steps=1 format=3]',
    '[node name="HUD" type="Control"]',
    ...properties.map((property) => `${property} = "Literal ${property}"`),
    '',
  ].join('\n'));

  const report = findUserFacingLiterals(projectRoot);
  assert.equal(report.violations.length, 10, JSON.stringify(report.violations));
  for (const property of properties) {
    assert.equal(report.violations.filter((violation) => violation.property === property).length, 2, property);
  }
  const result = runChecker(projectRoot);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /literal in display property placeholder_text/);
  assert.match(result.stdout, /literal in display property window_title/);
}));

test('localized GDScript assignments and empty serialized display properties pass', () => withProject((projectRoot) => {
  fixture(projectRoot, 'game/ui/hud.gd', [
    'extends Control',
    'func _ready():',
    '    self.text = tr("ui.minigame.score")',
    '    self.tooltip_text = tr("ui.minigame.controls_hint")',
    '    self.placeholder_text = tr("ui.minigame.win_condition")',
    '    self.window_title = tr("game.example_minimal.title")',
    '    self.title = tr("ui.minigame.button.start")',
    '',
  ].join('\n'));
  fixture(projectRoot, 'game/ui/hud.tscn', [
    '[gd_scene load_steps=1 format=3]',
    '[node name="HUD" type="Control"]',
    'text = ""',
    'tooltip_text = ""',
    'placeholder_text = ""',
    'window_title = ""',
    'title = ""',
    '',
  ].join('\n'));

  const report = findUserFacingLiterals(projectRoot);
  assert.deepEqual(report.violations, []);
  const result = runChecker(projectRoot);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /user-facing-literals=0/);
}));

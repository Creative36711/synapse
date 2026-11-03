#!/usr/bin/env node
// Вход оракула: npm run check:contracts.
//
// Запускает ровно node --test по tests/contracts/*.test.mjs, разбирает TAP-итог и печатает
// машиночитаемую строку. Ноль тестов — тоже провал: «нечего проверять» не равно «всё хорошо».
// Сеть, cortex, аккаунт и секреты не используются (INV-1).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 180_000;

const testFiles = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(TESTS_DIR, name));

if (testFiles.length === 0) {
  console.error('contract-check: fail (в tests/contracts нет ни одного *.test.mjs)');
  process.exit(1);
}

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
  cwd: dirname(dirname(TESTS_DIR)),
  encoding: 'utf8',
  timeout: TIMEOUT_MS,
  env: { ...process.env, NODE_OPTIONS: '' },
});

const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;

function summary(label) {
  const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output);
  return match ? Number(match[1]) : 0;
}

const tests = summary('tests');
const pass = summary('pass');
const fail = summary('fail');
const cancelled = summary('cancelled');
const skipped = summary('skipped');

console.log(`contract-check: files=${testFiles.length} tests=${tests} pass=${pass} fail=${fail}`);

function failRun(reason) {
  console.error(`contract-check: fail (${reason})`);
  const tail = output.trimEnd().split('\n').slice(-80).join('\n');
  if (tail) console.error(tail);
  process.exit(1);
}

if (run.error) failRun(`не удалось запустить node --test: ${run.error.message}`);
if (run.status !== 0) failRun(`node --test вернул код ${run.status}`);
if (tests === 0) failRun('ни один тест не выполнился');
if (fail !== 0) failRun(`провалено тестов: ${fail}`);
if (cancelled !== 0) failRun(`отменено тестов: ${cancelled}`);
if (pass !== tests) failRun(`pass (${pass}) не совпадает с tests (${tests})`);
if (skipped !== 0) failRun(`пропущено тестов: ${skipped} — контракт не проверен`);

console.log('contract-check: ok');

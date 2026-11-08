import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cliTestDir = join(repoRoot, 'tests/cli');
const patternText = process.env.SYNAPSE_CLI_TEST_PATTERN ?? '.*';

let pattern;
try {
  pattern = new RegExp(patternText);
} catch (error) {
  console.error(`test:cli pattern is not a valid regular expression: ${error.message}`);
  process.exit(2);
}

const testFiles = readdirSync(cliTestDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();
const testNamePattern = /^\s*test\(\s*(['"])([^'"\n]+)\1\s*,/gm;
const testNames = testFiles.flatMap((file) => {
  const source = readFileSync(join(cliTestDir, file), 'utf8');
  return [...source.matchAll(testNamePattern)].map((match) => match[2]);
});

if (testNames.length !== 20) {
  console.error(`test:cli expected exactly 20 top-level tests, found ${testNames.length}`);
  process.exit(1);
}

const selectedNames = testNames.filter((name) => pattern.test(name));
if (selectedNames.length === 0) {
  console.error(`test:cli pattern matched zero tests: ${patternText}`);
  process.exit(1);
}

console.log(`test:cli pattern matched ${selectedNames.length} tests: ${patternText}`);
const testPaths = testFiles.map((file) => join('tests/cli', file));
const result = spawnSync(process.execPath, [
  '--test',
  `--test-name-pattern=${patternText}`,
  ...testPaths,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(`test:cli could not start Node's test runner: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const executedNames = selectedNames.filter((name) => output.includes(`# Subtest: ${name}`));
console.log(`test:cli executed ${executedNames.length}/${selectedNames.length} selected tests`);
if (executedNames.length !== selectedNames.length) {
  const notReported = selectedNames.filter((name) => !executedNames.includes(name));
  console.error(`test:cli runner did not report selected tests: ${notReported.join(' | ')}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

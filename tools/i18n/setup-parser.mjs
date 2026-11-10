import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PARSER_VERSION = '4.5.0';
const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REQUIREMENTS = join(TOOL_DIRECTORY, 'parser-requirements.txt');
const RECOVERY_COMMAND = 'node tools/i18n/setup-parser.mjs';

export function parserEnvironmentPaths() {
  const environment = process.env.SYNAPSE_I18N_VENV;
  const venv = resolve(environment || join(TOOL_DIRECTORY, '.venv'));
  const windows = process.platform === 'win32';
  return {
    venv,
    python: join(venv, windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python'),
    gdparse: join(venv, windows ? 'Scripts' : 'bin', windows ? 'gdparse.exe' : 'gdparse'),
  };
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
}

function unavailable(reason, paths = parserEnvironmentPaths()) {
  return {
    available: false,
    record: {
      event: 'parser.unavailable',
      path: paths.venv,
      command: RECOVERY_COMMAND,
      reason: String(reason || 'parser is not installed'),
    },
  };
}

let cachedStatus;
let cachedVenv;

export function checkParser() {
  const paths = parserEnvironmentPaths();
  if (cachedStatus && cachedVenv === paths.venv) return cachedStatus;
  cachedVenv = paths.venv;

  if (!existsSync(paths.python)) {
    cachedStatus = unavailable('isolated Python environment is missing', paths);
    return cachedStatus;
  }
  const probe = run(paths.python, [
    '-c',
    'from gdtoolkit.parser import parser; parser.parse("extends Node\\n")',
  ]);
  if (probe.error || probe.status !== 0) {
    cachedStatus = unavailable((probe.stderr || probe.error?.message || 'gdtoolkit import failed').trim(), paths);
    return cachedStatus;
  }
  const version = run(paths.python, ['-c', 'import importlib.metadata; print(importlib.metadata.version("gdtoolkit"))']);
  if (version.error || version.status !== 0 || version.stdout.trim() !== PARSER_VERSION) {
    cachedStatus = unavailable(`expected gdtoolkit ${PARSER_VERSION}; found ${(version.stdout || version.stderr || '').trim() || 'no version'}`, paths);
    return cachedStatus;
  }
  if (!existsSync(paths.gdparse)) {
    cachedStatus = unavailable('gdparse executable is missing from the isolated environment', paths);
    return cachedStatus;
  }

  cachedStatus = { available: true, paths, version: PARSER_VERSION };
  return cachedStatus;
}

function emitUnavailable(status) {
  process.stderr.write(`${JSON.stringify(status.record)}\n`);
}

function setup() {
  const paths = parserEnvironmentPaths();
  const current = checkParser();
  if (current.available) {
    process.stdout.write(`${JSON.stringify({ event: 'parser.ready', path: paths.venv, version: PARSER_VERSION })}\n`);
    return 0;
  }

  const pythonCommand = process.env.PYTHON || 'python3';
  if (!existsSync(paths.python)) {
    mkdirSync(dirname(paths.venv), { recursive: true });
    const create = run(pythonCommand, ['-m', 'venv', paths.venv]);
    if (create.error || create.status !== 0) {
      emitUnavailable(unavailable(create.stderr || create.error?.message || 'python3 -m venv failed', paths));
      return 1;
    }
  }

  const install = run(paths.python, [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', REQUIREMENTS,
  ]);
  if (install.error || install.status !== 0) {
    const detail = (install.stderr || install.stdout || install.error?.message || 'pip install failed').trim();
    emitUnavailable(unavailable(detail, paths));
    return 1;
  }

  cachedStatus = undefined;
  cachedVenv = undefined;
  const installed = checkParser();
  if (!installed.available) {
    emitUnavailable(installed);
    return 1;
  }
  process.stdout.write(`${JSON.stringify({ event: 'parser.ready', path: paths.venv, version: PARSER_VERSION })}\n`);
  return 0;
}

function main(args) {
  if (args.length === 0) return setup();
  if (args.length === 1 && args[0] === '--check') {
    const status = checkParser();
    if (!status.available) {
      emitUnavailable(status);
      return 1;
    }
    process.stdout.write(`${JSON.stringify({ event: 'parser.ready', path: status.paths.venv, version: status.version })}\n`);
    return 0;
  }
  process.stderr.write('Usage: node tools/i18n/setup-parser.mjs [--check]\n');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

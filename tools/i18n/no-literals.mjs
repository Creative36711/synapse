import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
const DISPLAY_ASSIGNMENT = /^\s*(?:(?:@export\s+)?var\s+)?(?:[A-Za-z_$%][A-Za-z0-9_$%]*(?:\.[A-Za-z_$%][A-Za-z0-9_$%]*)*\.)?(?:text|tooltip_text|placeholder_text|window_title|title)\s*=\s*(["'])(.+?)\1(?:\s*(?:#.*)?)?$/;
const IGNORED_DIRECTORIES = new Set(['.git', '.godot', 'node_modules']);

function sourceFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(join(directory, entry.name)));
    } else if (entry.isFile() && /\.(?:gd|tscn)$/i.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files.sort();
}

export function findUserFacingLiterals(projectRoot = REPO_ROOT) {
  const normalizedRoot = resolve(projectRoot);
  const gameDirectory = join(normalizedRoot, 'game');
  if (!statSync(gameDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game directory not found under ${normalizedRoot}`);
  }
  const files = sourceFiles(gameDirectory);
  const violations = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#') || trimmed.startsWith(';')) return;
      const match = line.match(DISPLAY_ASSIGNMENT);
      if (match && match[2].trim() !== '') {
        violations.push({
          file: relative(resolve(projectRoot), file).split('\\').join('/'),
          line: index + 1,
          property: line.match(/\b(text|tooltip_text|placeholder_text|window_title|title)\s*=/)?.[1] ?? 'display',
        });
      }
    });
  }
  return { filesScanned: files.length, violations };
}

function parseArguments(args) {
  let projectRoot = REPO_ROOT;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1]) {
      projectRoot = resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    }
  }
  return projectRoot;
}

function main() {
  try {
    const projectRoot = parseArguments(process.argv.slice(2));
    const { filesScanned, violations } = findUserFacingLiterals(projectRoot);
    for (const violation of violations) {
      process.stdout.write(`i18n-no-literals: ERROR ${violation.file}:${violation.line}: literal assigned to display property ${violation.property}\n`);
    }
    if (violations.length > 0) {
      process.stdout.write(`i18n-no-literals: fail=${violations.length} files=${filesScanned}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`i18n-no-literals: scanned=${filesScanned} user-facing-literals=0\n`);
    }
  } catch (error) {
    process.stderr.write(`i18n-no-literals: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

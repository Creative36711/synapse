import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { checkParser } from './setup-parser.mjs';

const TOOL_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(join(TOOL_DIRECTORY, '../..'));
const PARSER_BRIDGE = join(TOOL_DIRECTORY, 'parser_bridge.py');
const IGNORED_DIRECTORIES = new Set(['.git', '.godot', 'node_modules']);
const GAME_EXTENSIONS = new Set(['.gd', '.tscn', '.mjs', '.js', '.cjs']);
const CLI_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);
const DISPLAY_PROPERTIES = new Set(['text', 'tooltip_text', 'placeholder_text', 'window_title', 'title']);
const SCENE_DISPLAY_PROPERTY_PATTERN = new RegExp(
  `^\\s*(${[...DISPLAY_PROPERTIES].join('|')})\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')\\s*(?:;.*)?$`,
);
const GODOT_OUTPUT_CALLS = new Set(['set_text', 'print', 'printerr', 'push_error', 'push_warning']);
const JS_CONSOLE_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug']);
const JS_LOCALIZERS = new Set(['t', 'tr', 'translate', 'localize']);
const TECHNICAL_CODE = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$/;
const SCAN_PATTERNS = [
  'game/**/*.gd',
  'game/**/*.tscn',
  'game/**/*.{mjs,js,cjs}',
  'cli/**/*.{mjs,js,cjs}',
];

function sourceFiles(directory, extensions) {
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
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...sourceFiles(join(directory, entry.name), extensions));
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function tokenize(source, extension) {
  const tokens = [];
  const isGdscript = extension === '.gd';
  const isScene = extension === '.tscn';
  const isJavaScript = ['.mjs', '.js', '.cjs'].includes(extension);
  let index = 0;
  let line = 1;

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      if (character === '\n') line += 1;
      index += 1;
      continue;
    }

    if ((isGdscript && character === '#') || (isScene && character === ';')) {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (isJavaScript && character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (isJavaScript && character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }

    if (character === "'" || character === '"') {
      const tokenLine = line;
      const quote = character;
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\' && index + 1 < source.length) {
          value += source.slice(index, index + 2);
          if (source[index + 1] === '\n') line += 1;
          index += 2;
        } else {
          if (source[index] === '\n') line += 1;
          value += source[index];
          index += 1;
        }
      }
      if (index < source.length) index += 1;
      tokens.push({ type: 'string', value, line: tokenLine });
      continue;
    }

    if (character === '`' && isJavaScript) {
      const tokenLine = line;
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\' && index + 1 < source.length) {
          value += source.slice(index, index + 2);
          if (source[index + 1] === '\n') line += 1;
          index += 2;
        } else {
          if (source[index] === '\n') line += 1;
          value += source[index];
          index += 1;
        }
      }
      if (index < source.length) index += 1;
      tokens.push({ type: 'template', value, line: tokenLine });
      continue;
    }

    const identifier = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier, line });
      index += identifier.length;
      continue;
    }

    const operator = ['+=', ':=', '??', '?.', '=>', '==', '!='].find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: 'punctuation', value: operator, line });
      index += operator.length;
    } else {
      tokens.push({ type: 'punctuation', value: character, line });
      index += 1;
    }
  }
  return tokens;
}

function hasVisibleCharacters(value) {
  return value.replace(/\\[nrtvf]/g, ' ').trim() !== '';
}

function skipTemplateExpression(value, start) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  return value.length - 1;
}

function templateHasStaticText(value) {
  let text = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && index + 1 < value.length) {
      const escaped = value[index + 1];
      text += 'nrtvf'.includes(escaped) ? ' ' : escaped;
      index += 1;
    } else if (value[index] === '$' && value[index + 1] === '{') {
      if (hasVisibleCharacters(text)) return true;
      text = '';
      index = skipTemplateExpression(value, index + 2);
    } else {
      text += value[index];
    }
  }
  return hasVisibleCharacters(text);
}

function templateExpressions(value) {
  const expressions = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
    } else if (value[index] === '$' && value[index + 1] === '{') {
      const start = index + 2;
      const end = skipTemplateExpression(value, start);
      expressions.push(value.slice(start, end));
      index = end;
    }
  }
  return expressions;
}

function isLocalizationKey(tokens, index) {
  if (tokens[index - 1]?.type === 'punctuation' && tokens[index - 1]?.value === '[') return true;
  if (tokens[index - 1]?.type !== 'punctuation' || tokens[index - 1]?.value !== '(') return false;
  return tokens[index - 2]?.type === 'identifier' && JS_LOCALIZERS.has(tokens[index - 2].value);
}

function isDiagnosticCodeFallback(tokens, index) {
  const value = tokens[index]?.value.trim();
  if (!TECHNICAL_CODE.test(value ?? '')
    || tokens[index - 1]?.type !== 'punctuation'
    || tokens[index - 1]?.value !== '??') return false;
  for (let cursor = index - 2; cursor >= Math.max(0, index - 5); cursor -= 1) {
    if (tokens[cursor]?.type === 'identifier' && tokens[cursor]?.value === 'code'
      && tokens[cursor - 1]?.type === 'punctuation' && tokens[cursor - 1]?.value === '.') return true;
  }
  return false;
}

function hasUserFacingText(tokens, depth = 0) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'string' && hasVisibleCharacters(token.value)) {
      if (!isLocalizationKey(tokens, index)
        && !TECHNICAL_CODE.test(token.value.trim())
        && !isDiagnosticCodeFallback(tokens, index)) return true;
    }
    if (token.type === 'template') {
      if (templateHasStaticText(token.value)) return true;
      if (depth < 4) {
        for (const expression of templateExpressions(token.value)) {
          if (hasUserFacingText(tokenize(expression, '.mjs'), depth + 1)) return true;
        }
      }
    }
  }
  return false;
}

function firstArgument(tokens, openParenIndex) {
  const result = [];
  let depth = 0;
  for (let index = openParenIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = token.value;
    if (token.type === 'punctuation' && value === ',' && depth === 0) break;
    if (token.type === 'punctuation' && value === ')' && depth === 0) break;
    if (token.type === 'punctuation' && ['(', '[', '{'].includes(value)) depth += 1;
    else if (token.type === 'punctuation' && [')', ']', '}'].includes(value)) depth -= 1;
    result.push(token);
  }
  return result;
}

function jsOutputCall(tokens, index) {
  if (tokens[index]?.type === 'identifier' && tokens[index]?.value === 'console'
    && tokens[index + 1]?.type === 'punctuation' && tokens[index + 1]?.value === '.'
    && tokens[index + 2]?.type === 'identifier' && JS_CONSOLE_METHODS.has(tokens[index + 2]?.value)
    && tokens[index + 3]?.type === 'punctuation' && tokens[index + 3]?.value === '(') {
    return { openParenIndex: index + 3, mechanism: `console.${tokens[index + 2].value}` };
  }
  if (tokens[index]?.type === 'identifier' && tokens[index]?.value === 'process'
    && tokens[index + 1]?.type === 'punctuation' && tokens[index + 1]?.value === '.'
    && tokens[index + 2]?.type === 'identifier' && ['stdout', 'stderr'].includes(tokens[index + 2]?.value)
    && tokens[index + 3]?.type === 'punctuation' && tokens[index + 3]?.value === '.'
    && tokens[index + 4]?.type === 'identifier' && tokens[index + 4]?.value === 'write'
    && tokens[index + 5]?.type === 'punctuation' && tokens[index + 5]?.value === '(') {
    return { openParenIndex: index + 5, mechanism: `process.${tokens[index + 2].value}.write` };
  }
  return null;
}

function godotOutputCall(tokens, index) {
  const name = tokens[index]?.value;
  if (tokens[index]?.type === 'identifier' && GODOT_OUTPUT_CALLS.has(name) && tokens[index + 1]?.value === '(') {
    return { openParenIndex: index + 1, mechanism: name };
  }
  return null;
}

function addViolation(violations, file, line, mechanism, property = undefined) {
  const violation = { file, line, mechanism, ...(property ? { property } : {}) };
  if (!violations.some((existing) => JSON.stringify(existing) === JSON.stringify(violation))) {
    violations.push(violation);
  }
}

function parserError(record) {
  const error = new Error(record.reason || record.detail || 'GDScript parser failed');
  error.parserRecord = record;
  return error;
}

function requireParserAvailable() {
  const status = checkParser();
  if (!status.available) throw parserError(status.record);
  return status;
}

function parseGDScriptFiles(files) {
  const status = requireParserAvailable();
  if (files.length === 0) return new Map();

  const input = JSON.stringify({
    files: files.map(({ file, source }) => ({ file, source })),
  });
  const result = spawnSync(status.paths.python, [PARSER_BRIDGE], {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || !result.stdout) {
    throw parserError({
      event: 'parser.unavailable',
      path: status.paths.venv,
      command: 'node tools/i18n/setup-parser.mjs',
      reason: result.error?.message || result.stderr || 'gdtoolkit parser produced no result',
    });
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw parserError({
      event: 'parser.failed',
      path: status.paths.venv,
      detail: error.message,
      reason: result.stderr || result.stdout.slice(0, 500),
    });
  }
  if (report.version !== '4.5.0' || !Array.isArray(report.files)) {
    throw parserError({ event: 'parser.failed', path: status.paths.venv, reason: 'unexpected parser bridge response' });
  }
  const failed = report.files.find((item) => item.error);
  if (failed || result.status !== 0) {
    throw parserError({
      event: 'parser.parse_failed',
      file: failed?.file,
      line: failed?.line,
      column: failed?.column,
      reason: failed?.error || result.stderr || 'GDScript parse failed',
    });
  }
  return new Map(report.files.map((item) => [item.file, item]));
}

function inspectScene(source, file, violations) {
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(SCENE_DISPLAY_PROPERTY_PATTERN);
    if (!match) return;
    const literal = match[2].slice(1, -1);
    if (hasVisibleCharacters(literal)) addViolation(violations, file, index + 1, 'display-property', match[1]);
  });
}

function inspectCode(source, file, extension, violations) {
  const tokens = tokenize(source, extension);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'identifier' && DISPLAY_PROPERTIES.has(token.value)
      && ['=', '+=', ':='].includes(tokens[index + 1]?.value)) {
      const value = tokens[index + 2];
      if (value?.type === 'string' && hasVisibleCharacters(value.value)) {
        addViolation(violations, file, token.line, 'display-property', token.value);
      } else if (value?.type === 'template' && templateHasStaticText(value.value)) {
        addViolation(violations, file, token.line, 'display-property', token.value);
      }
    }

    const call = extension === '.gd' ? godotOutputCall(tokens, index)
      : ['.mjs', '.js', '.cjs'].includes(extension) ? jsOutputCall(tokens, index) : null;
    if (!call) continue;
    const argument = firstArgument(tokens, call.openParenIndex);
    if (hasUserFacingText(argument)) {
      addViolation(violations, file, token.line, call.mechanism);
    }
  }
}

export function findUserFacingLiterals(projectRoot = REPO_ROOT) {
  const normalizedRoot = resolve(projectRoot);
  const gameDirectory = join(normalizedRoot, 'game');
  if (!statSync(gameDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game directory not found under ${normalizedRoot}`);
  }

  const files = [
    ...sourceFiles(gameDirectory, GAME_EXTENSIONS),
    ...sourceFiles(join(normalizedRoot, 'cli'), CLI_EXTENSIONS),
  ].sort();
  const sourceRecords = files.map((file) => ({
    file: relative(normalizedRoot, file).split('\\').join('/'),
    extension: extname(file).toLowerCase(),
    source: readFileSync(file, 'utf8'),
  }));
  const parserReports = parseGDScriptFiles(sourceRecords
    .filter((record) => record.extension === '.gd')
    .map(({ file, source }) => ({ file, source })));
  const violations = [];
  for (const record of sourceRecords) {
    const { file, extension, source } = record;
    if (extension === '.tscn') {
      inspectScene(source, file, violations);
      continue;
    }
    if (extension === '.gd') {
      const parsed = parserReports.get(file);
      for (const assignment of parsed.assignments) {
        if (['=', '+=', ':='].includes(assignment.operator) && assignment.hasStaticVisibleText) {
          addViolation(violations, file, assignment.line, 'display-property', assignment.property);
        }
      }
      for (const call of parsed.calls) {
        addViolation(violations, file, call.line, call.mechanism);
      }
    }
    inspectCode(source, file, extension, violations);
  }
  return { filesScanned: files.length, scannedFiles: sourceRecords.map(({ file }) => file), scanPatterns: SCAN_PATTERNS, violations };
}

function parseArguments(args) {
  let projectRoot = REPO_ROOT;
  let requireParser = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1]) {
      projectRoot = resolve(args[index + 1]);
      index += 1;
    } else if (args[index] === '--require-parser') {
      requireParser = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[index]}`);
    }
  }
  return { projectRoot, requireParser };
}

function main() {
  try {
    const { projectRoot, requireParser } = parseArguments(process.argv.slice(2));
    if (requireParser) {
      const parser = requireParserAvailable();
      process.stdout.write(`i18n-no-literals: parser=gdtoolkit@${parser.version} required\n`);
    }
    const { filesScanned, scannedFiles, scanPatterns, violations } = findUserFacingLiterals(projectRoot);
    process.stdout.write(`i18n-no-literals: paths=${scanPatterns.join(',')}\n`);
    process.stdout.write(`i18n-no-literals: files=${scannedFiles.join(',') || '[none]'}\n`);
    for (const violation of violations) {
      const subject = violation.property ? `display property ${violation.property}` : `output call ${violation.mechanism}`;
      process.stdout.write(`i18n-no-literals: ERROR ${violation.file}:${violation.line}: literal in ${subject}\n`);
    }
    if (violations.length > 0) {
      process.stdout.write(`i18n-no-literals: fail=${violations.length} scanned=${filesScanned}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`i18n-no-literals: scanned=${filesScanned} user-facing-literals=0\n`);
    }
  } catch (error) {
    if (error.parserRecord) {
      process.stderr.write(`${JSON.stringify(error.parserRecord)}\n`);
    } else {
      process.stderr.write(`i18n-no-literals: ERROR ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

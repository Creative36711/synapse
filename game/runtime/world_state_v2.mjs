#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function normalize(value) {
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('world-state numbers must be finite');
    const rounded = Math.round(value * 10_000) / 10_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key.normalize('NFC')] = normalize(item);
    return result;
  }
  return value;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 4 });

function canonicalNumber(value) {
  if (Object.is(value, -0) || value === 0) return '0';
  return NUMBER_FORMAT.format(value);
}

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const members = Object.keys(value)
      .map((key) => key.normalize('NFC'))
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`unsupported world-state value: ${typeof value}`);
}

function sha256(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) process.exit(2);

const document = normalize(JSON.parse(readFileSync(inputPath, 'utf8')));
document.rules.hash = sha256({ frame: document.rules.frame, nodes: document.rules.nodes });
document.presentation.hash = sha256({ locale: document.presentation.locale, nodes: document.presentation.nodes });
document.artifact = {
  algorithm: 'sha256',
  subject: 'document-without-artifact',
  hash: sha256(document),
};
writeFileSync(outputPath, `${canonical(document)}\n`, 'utf8');

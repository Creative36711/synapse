#!/usr/bin/env node
// Deterministic, local-only module graph resolution for Synapse GameSpec 1.0.
// A GameSpec's manifests live in its stem-specific `modules/` directory, with
// deterministic sibling/shared fallbacks. This helper never contacts external services.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_SCHEMA_PATH = join(REPO_ROOT, 'schema/gamespec.schema.json');
const MODULE_SCHEMA_PATH = join(REPO_ROOT, 'schema/module-manifest.schema.json');
const CATALOG_PATH = join(REPO_ROOT, 'game/validation/catalogs/en.json');
const ESCAPE_POINTER = (part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1');

function atPointer(value, pointer) {
  if (!pointer || pointer === '/') return value;
  return pointer.split('/').slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, part) => current?.[Array.isArray(current) ? Number(part) : part], value);
}

function errorPath(error) {
  const base = error.instancePath ?? '';
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    return `${base}/${ESCAPE_POINTER(error.params.missingProperty)}`;
  }
  if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
    return `${base}/${ESCAPE_POINTER(error.params.additionalProperty)}`;
  }
  return base || '/';
}

function pointerParent(pointer) {
  const segments = pointer.split('/').slice(1, -1);
  return `/${segments.join('/')}`.replace(/^\/$/, '');
}

function allowedFields(parentPath, schemaKind) {
  if (schemaKind === 'gamespec') {
    const fields = {
      '': ['specVersion', 'game', 'entry', 'modules', 'locales'],
      '/game': ['id', 'version', 'titleKey', 'descriptionKey'],
      '/entry': ['scene'],
      '/locales': ['default', 'supported'],
    };
    if (/^\/modules\/\d+$/.test(parentPath)) return ['id', 'version', 'optional'];
    return fields[parentPath] ?? [];
  }

  const fields = {
    '': ['specVersion', 'module', 'requires', 'dependencies', 'conflicts', 'provides'],
    '/module': ['id', 'version', 'titleKey', 'descriptionKey'],
    '/requires': ['spec', 'engine'],
    '/provides': ['scenes', 'locales'],
  };
  if (/^\/dependencies\/\d+$/.test(parentPath)) return ['id', 'version', 'optional'];
  if (/^\/conflicts\/\d+$/.test(parentPath)) return ['id', 'version', 'reasonKey'];
  return fields[parentPath] ?? [];
}

function catalogMessage(catalog, code, params) {
  const template = catalog[`errors.${code}`];
  if (typeof template !== 'string') return undefined;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key) => {
    const value = params[key];
    if (value === undefined) return '';
    if (Array.isArray(value)) return key === 'cycle' ? value.join(' -> ') : JSON.stringify(value);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function diagnostic(catalog, code, params) {
  const item = { code, params, catalogKey: `errors.${code}` };
  const message = catalogMessage(catalog, code, params);
  if (message !== undefined) item.message = message;
  return item;
}

function parserDiagnostic(error, source, catalog) {
  const position = error.linePos?.[0] ?? { line: 1, col: 1 };
  const sourceLine = source.split(/\r?\n/)[position.line - 1] ?? '';
  const keyMatch = /^\s*(?:-\s*)?([^:[\]{}]+):(?:\s|$)/.exec(sourceLine);
  const duplicate = error.code === 'DUPLICATE_KEY';
  const code = duplicate ? 'yaml.duplicate-key' : 'yaml.syntax';
  const params = {
    path: '/',
    expected: 'YAML 1.2',
    actual: error.code ?? 'parse error',
    line: position.line,
    column: position.col,
  };
  if (duplicate) params.key = keyMatch?.[1]?.trim() ?? 'unknown';
  return diagnostic(catalog, code, params);
}

function parseYaml(source, catalog) {
  const doc = parseDocument(source, {
    version: '1.2', schema: 'core', uniqueKeys: true, merge: false, customTags: [],
  });
  const error = doc.errors[0] ?? doc.warnings[0];
  if (error) {
    const duplicate = doc.errors.find((entry) => entry.code === 'DUPLICATE_KEY');
    return { error: parserDiagnostic(duplicate ?? error, source, catalog) };
  }
  try {
    return { value: doc.toJS({ maxAliasCount: 100 }) };
  } catch (error) {
    return { error: parserDiagnostic(error, source, catalog) };
  }
}

function structuralErrors(value, validate, catalog, schemaKind) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => {
    const path = errorPath(error);
    const actualValue = atPointer(value, path);
    let code = 'field.type';
    let expected;
    let actual = actualValue;
    switch (error.keyword) {
      case 'required':
        code = 'field.required';
        expected = 'present';
        actual = null;
        break;
      case 'additionalProperties':
        code = 'field.unknown';
        expected = allowedFields(pointerParent(path), schemaKind);
        actual = error.params.additionalProperty;
        break;
      case 'type':
        code = 'field.type';
        expected = error.params.type;
        break;
      case 'enum':
        code = 'field.enum';
        expected = error.params.allowedValues;
        break;
      case 'pattern':
        code = 'field.pattern';
        expected = error.params.pattern;
        break;
      case 'uniqueItems':
        code = 'field.unique';
        expected = 'uniqueItems';
        break;
      default:
        expected = error.keyword;
    }
    return diagnostic(catalog, code, { path, expected, actual });
  });
}

function compileSchema(path) {
  const ajv = new Ajv2020({
    allErrors: true, strict: true, strictRequired: false,
    validateSchema: true, allowUnionTypes: false, messages: true,
  });
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return undefined;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some((part) => !part || (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))) {
    return undefined;
  }
  return { major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]), prerelease };
}

function compareVersions(leftVersion, rightVersion) {
  const left = typeof leftVersion === 'string' ? parseVersion(leftVersion) : leftVersion;
  const right = typeof rightVersion === 'string' ? parseVersion(rightVersion) : rightVersion;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const compared = compareIdentifiers(a, b);
    if (compared !== 0) return compared;
  }
  return 0;
}

function comparatorMatches(version, operator, target) {
  const comparison = compareVersions(version, target);
  switch (operator) {
    case '>': return comparison > 0;
    case '>=': return comparison >= 0;
    case '<': return comparison < 0;
    case '<=': return comparison <= 0;
    case '=': return comparison === 0;
    default: return false;
  }
}

function expandRange(range) {
  if (range === '*') return { comparators: [], prereleaseTuples: new Set() };
  if (range.startsWith('^') || range.startsWith('~')) {
    const operator = range[0];
    const version = parseVersion(range.slice(1));
    if (!version) return undefined;
    let upper;
    if (operator === '~') {
      upper = `${version.major}.${version.minor + 1n}.0`;
    } else if (version.major > 0n) {
      upper = `${version.major + 1n}.0.0`;
    } else if (version.minor > 0n) {
      upper = `0.${version.minor + 1n}.0`;
    } else {
      upper = `0.0.${version.patch + 1n}`;
    }
    const comparators = [
      { operator: '>=', version: range.slice(1) },
      { operator: '<', version: upper },
    ];
    return { comparators, prereleaseTuples: new Set(comparators
      .map((item) => parseVersion(item.version))
      .filter((item) => item?.prerelease.length)
      .map((item) => `${item.major}.${item.minor}.${item.patch}`)) };
  }
  const pieces = range.split(' ');
  const comparators = pieces.map((piece) => {
    const match = /^(>=|>|<=|<|=)?(.+)$/.exec(piece);
    return match ? { operator: match[1] ?? '=', version: match[2] } : undefined;
  });
  if (comparators.some((item) => !item || !parseVersion(item.version))) return undefined;
  const prereleaseTuples = new Set(comparators
    .map((item) => parseVersion(item.version))
    .filter((item) => item.prerelease.length)
    .map((item) => `${item.major}.${item.minor}.${item.patch}`));
  return { comparators, prereleaseTuples };
}

function satisfies(version, range) {
  const parsedVersion = parseVersion(version);
  const expanded = expandRange(range);
  if (!parsedVersion || !expanded) return false;
  const tuple = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`;
  if (parsedVersion.prerelease.length && !expanded.prereleaseTuples.has(tuple)) return false;
  return expanded.comparators.every(({ operator, version: target }) =>
    comparatorMatches(version, operator, target));
}

function manifestDirectory(specPath) {
  const directory = dirname(specPath);
  const filename = basename(specPath);
  const stem = filename.replace(/\.game\.ya?ml$/i, '');
  const perGame = join(directory, stem, 'modules');
  if (existsSync(perGame)) return perGame;
  const sibling = join(directory, 'modules');
  if (existsSync(sibling)) return sibling;
  return join(REPO_ROOT, 'game/modules');
}

function scanManifests(moduleDir) {
  const files = [];
  function visit(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ya?ml)$/i.test(entry.name)) files.push(path);
    }
  }
  visit(moduleDir);
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function availableVersions(candidates) {
  return candidates
    .map((candidate) => candidate.manifest.module.version)
    .sort((left, right) => compareVersions(right, left));
}

function versionError(catalog, { path, constraint, available }) {
  const value = available.length ? available.join(', ') : 'none';
  return diagnostic(catalog, 'module.version.unsatisfied', {
    path,
    expected: constraint,
    actual: value,
    constraint,
    available,
  });
}

function missingError(catalog, { path, requiredBy, constraint, id }) {
  return diagnostic(catalog, 'module.dependency.missing', {
    path,
    expected: 'available module manifest',
    actual: id,
    requiredBy,
    constraint,
  });
}

function cloneState(state) {
  return {
    assignments: new Map(state.assignments),
    constraints: new Map([...state.constraints].map(([id, ranges]) => [id, [...ranges]])),
    pending: [...state.pending],
    expanded: new Set(state.expanded),
    edges: new Map([...state.edges].map(([id, dependencies]) => [id, [...dependencies]])),
  };
}

function addEdge(state, parentId, dependencyId) {
  if (!parentId) return;
  const dependencies = state.edges.get(parentId) ?? [];
  if (!dependencies.includes(dependencyId)) dependencies.push(dependencyId);
  state.edges.set(parentId, dependencies);
}

function selectCandidates(candidates, ranges) {
  return candidates.filter((candidate) => ranges.every((range) =>
    satisfies(candidate.manifest.module.version, range)));
}

function solveGraph(rootRequests, catalogById, catalog) {
  const initialState = {
    assignments: new Map(),
    constraints: new Map(),
    pending: [...rootRequests],
    expanded: new Set(),
    edges: new Map(),
  };

  function search(state) {
    if (state.pending.length === 0) return { state };
    const [request, ...remaining] = state.pending;
    const candidates = catalogById.get(request.id) ?? [];
    const currentConstraints = state.constraints.get(request.id) ?? [];
    const proposedRanges = [...currentConstraints, request.version];
    const eligible = selectCandidates(candidates, proposedRanges);

    if (request.optional) {
      if (candidates.length === 0 || eligible.length === 0) {
        return search({ ...state, pending: remaining });
      }
      const includeState = cloneState(state);
      includeState.pending = [{ ...request, optional: false }, ...remaining];
      const included = search(includeState);
      if (included.state) return included;
      const skipped = search({ ...state, pending: remaining });
      return skipped.state ? skipped : included;
    }

    if (candidates.length === 0) {
      return { error: missingError(catalog, {
        path: request.path,
        requiredBy: request.requiredBy,
        constraint: request.version,
        id: request.id,
      }) };
    }
    if (eligible.length === 0) {
      return { error: versionError(catalog, {
        path: request.path,
        constraint: request.version,
        available: availableVersions(candidates),
        requiredBy: request.requiredBy,
      }) };
    }

    const existing = state.assignments.get(request.id);
    if (existing) {
      if (!proposedRanges.every((range) => satisfies(existing.manifest.module.version, range))) {
        return { error: versionError(catalog, {
          path: request.path,
          constraint: request.version,
          available: availableVersions(candidates),
          requiredBy: request.requiredBy,
        }) };
      }
      const next = cloneState(state);
      next.pending = remaining;
      next.constraints.set(request.id, proposedRanges);
      addEdge(next, request.requiredBy, request.id);
      return search(next);
    }

    let lastError;
    for (const candidate of eligible) {
      const next = cloneState(state);
      next.constraints.set(request.id, proposedRanges);
      next.assignments.set(request.id, candidate);
      next.pending = remaining;
      addEdge(next, request.requiredBy, request.id);
      if (!next.expanded.has(request.id)) {
        next.expanded.add(request.id);
        const dependencies = candidate.manifest.dependencies ?? [];
        const seen = new Set();
        for (const [index, dependency] of dependencies.entries()) {
          if (seen.has(dependency.id)) {
            return { error: diagnostic(catalog, 'module.duplicate', {
              path: `/dependencies/${index}/id`,
              expected: 'unique dependency IDs',
              actual: dependency.id,
              moduleId: dependency.id,
            }) };
          }
          seen.add(dependency.id);
        }
        const requests = dependencies.map((dependency, index) => ({
          id: dependency.id,
          version: dependency.version,
          optional: dependency.optional === true,
          requiredBy: candidate.manifest.module.id,
          path: `/dependencies/${index}`,
        }));
        next.pending = [...requests, ...next.pending];
      }
      const result = search(next);
      if (result.state) return result;
      lastError = result.error ?? lastError;
    }
    return { error: lastError };
  }

  return search(initialState);
}

function findCycle(assignments, edges) {
  const state = new Map();
  const stack = [];
  const ids = [...assignments.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  function visit(id) {
    state.set(id, 1);
    stack.push(id);
    const dependencies = [...(edges.get(id) ?? [])].sort((left, right) => left.localeCompare(right, 'en'));
    for (const dependencyId of dependencies) {
      if (!assignments.has(dependencyId)) continue;
      if (state.get(dependencyId) === 1) {
        const start = stack.indexOf(dependencyId);
        return [...stack.slice(start), dependencyId];
      }
      if (!state.has(dependencyId)) {
        const found = visit(dependencyId);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return undefined;
  }
  for (const id of ids) {
    if (!state.has(id)) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return undefined;
}

function topologicalOrder(assignments, edges) {
  const indegree = new Map([...assignments.keys()].map((id) => [id, 0]));
  const dependents = new Map([...assignments.keys()].map((id) => [id, []]));
  for (const [id, dependencies] of edges) {
    for (const dependencyId of dependencies) {
      if (!assignments.has(dependencyId)) continue;
      indegree.set(id, indegree.get(id) + 1);
      dependents.get(dependencyId).push(id);
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0)
    .map(([id]) => id).sort((left, right) => left.localeCompare(right, 'en'));
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const dependent of dependents.get(id).sort((left, right) => left.localeCompare(right, 'en'))) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort((left, right) => left.localeCompare(right, 'en'));
      }
    }
  }
  return order.length === assignments.size ? order : undefined;
}

function resolutionErrors(assignments, edges, gameSpec, catalog) {
  const errors = [];
  const order = topologicalOrder(assignments, edges);
  if (!order) {
    const cycle = findCycle(assignments, edges) ?? [];
    errors.push(diagnostic(catalog, 'module.dependency.cycle', {
      path: '/dependencies',
      expected: 'acyclic module dependency graph',
      actual: cycle.join(' -> '),
      cycle,
    }));
    return errors;
  }

  const conflictPairs = new Set();
  for (const moduleId of [...assignments.keys()].sort((left, right) => left.localeCompare(right, 'en'))) {
    const candidate = assignments.get(moduleId);
    for (const [index, conflict] of (candidate.manifest.conflicts ?? []).entries()) {
      const target = assignments.get(conflict.id);
      if (!target || !satisfies(target.manifest.module.version, conflict.version)) continue;
      const pair = [moduleId, conflict.id].sort((left, right) => left.localeCompare(right, 'en')).join('\0');
      if (conflictPairs.has(pair)) continue;
      conflictPairs.add(pair);
      errors.push(diagnostic(catalog, 'module.conflict', {
        path: `/conflicts/${index}`,
        expected: `module ${conflict.id} absent or outside ${conflict.version}`,
        actual: `${conflict.id}@${target.manifest.module.version}`,
        conflictId: conflict.id,
        constraint: conflict.version,
      }));
    }
  }
  if (errors.length) return errors;

  // An empty module graph is a valid no-op for `resolve` and has no module-owned
  // scene dictionary to inspect. For non-empty builds, entry.scene must resolve.
  if (assignments.size > 0) {
    const providedBy = [...assignments.keys()].filter((id) =>
      (assignments.get(id).manifest.provides?.scenes ?? []).includes(gameSpec.entry.scene))
      .sort((left, right) => left.localeCompare(right, 'en'));
    if (providedBy.length === 0) {
      errors.push(diagnostic(catalog, 'ref.unresolved', {
        path: '/entry/scene',
        expected: 'scene provided by a resolved module',
        actual: gameSpec.entry.scene,
        refKind: 'scene',
        providedBy,
      }));
      return errors;
    }
  }
  return errors;
}

function loadCatalog() {
  return JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
}

export function resolveGameSpec(gameSpec, specPath) {
  const catalog = loadCatalog();
  const gameValidator = compileSchema(GAME_SCHEMA_PATH);
  const gameErrors = structuralErrors(gameSpec, gameValidator, catalog, 'gamespec');
  if (gameErrors.length) return { ok: false, errors: gameErrors };

  const specAbsolutePath = isAbsolute(specPath) ? specPath : resolve(process.cwd(), specPath);
  const moduleDir = manifestDirectory(specAbsolutePath);
  const moduleValidator = compileSchema(MODULE_SCHEMA_PATH);
  const catalogById = new Map();
  for (const filePath of scanManifests(moduleDir)) {
    const source = readFileSync(filePath, 'utf8');
    const parsed = parseYaml(source, catalog);
    if (parsed.error) return { ok: false, errors: [parsed.error] };
    const errors = structuralErrors(parsed.value, moduleValidator, catalog, 'module');
    if (errors.length) return { ok: false, errors };
    const id = parsed.value.module.id;
    const candidates = catalogById.get(id) ?? [];
    if (candidates.some((candidate) => candidate.manifest.module.version === parsed.value.module.version)) {
      return { ok: false, errors: [diagnostic(catalog, 'module.duplicate', {
        path: '/module/id',
        expected: 'unique module ID and version manifest',
        actual: `${id}@${parsed.value.module.version}`,
        moduleId: id,
      })] };
    }
    candidates.push({ manifest: parsed.value, filePath });
    candidates.sort((left, right) => compareVersions(
      right.manifest.module.version, left.manifest.module.version,
    ));
    catalogById.set(id, candidates);
  }

  const rootRequests = [];
  const seenRootIds = new Set();
  for (const [index, moduleRef] of (gameSpec.modules ?? []).entries()) {
    if (seenRootIds.has(moduleRef.id)) {
      return { ok: false, errors: [diagnostic(catalog, 'module.duplicate', {
        path: `/modules/${index}/id`,
        expected: 'unique module IDs',
        actual: moduleRef.id,
        moduleId: moduleRef.id,
      })] };
    }
    seenRootIds.add(moduleRef.id);
    rootRequests.push({
      id: moduleRef.id,
      version: moduleRef.version,
      optional: moduleRef.optional === true,
      requiredBy: gameSpec.game.id,
      path: `/modules/${index}`,
    });
  }
  rootRequests.sort((left, right) => left.id.localeCompare(right.id, 'en')
    || left.version.localeCompare(right.version, 'en'));

  const solved = solveGraph(rootRequests, catalogById, catalog);
  if (!solved.state) return { ok: false, errors: solved.error ? [solved.error] : [] };
  const { assignments, edges } = solved.state;
  const errors = resolutionErrors(assignments, edges, gameSpec, catalog);
  if (errors.length) return { ok: false, errors };
  const order = topologicalOrder(assignments, edges) ?? [];
  return {
    ok: true,
    gameId: gameSpec.game.id,
    entryScene: gameSpec.entry.scene,
    order,
    modules: order.map((id) => ({ id, version: assignments.get(id).manifest.module.version })),
  };
}

function main(args) {
  if (args.length !== 2 || args[0] !== 'resolve') {
    process.stderr.write(`${loadCatalog()['errors.cli.usage']}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const specPath = isAbsolute(args[1]) ? args[1] : resolve(process.cwd(), args[1]);
    const parsed = parseYaml(readFileSync(specPath, 'utf8'), loadCatalog());
    if (parsed.error) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors: [parsed.error] })}\n`);
      process.exitCode = 1;
      return;
    }
    const result = resolveGameSpec(parsed.value, specPath);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.code ?? 'resolve.error'}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

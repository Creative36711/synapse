# Offline npm development dependencies

This snapshot pins every registry package represented by `package-lock.json` (npm lockfile v3).
It is a development/test dependency snapshot only; it adds no runtime dependency and does not modify
the lockfile. `offline-install.sh` uses only Python's standard library and local files: it invokes no
npm command and has no network fallback.

## Snapshot contents and verification

Six original npm registry tarballs are stored separately in `vendor/npm/` so each package can be
checked against both its own package-lock SRI and the repository's SHA-256 manifest. The tarballs total
**391,357 bytes**.

| Package | Version | License | Tarball bytes | package-lock SRI | SHA-256 |
|---|---:|---|---:|---|---|
| `ajv` | `8.20.0` | MIT | 217,611 | `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==` | `b2f0b3a893bbb8cc5efb6814f08b1499e19e31d5dd73683f5893382f48f6e7b3` |
| `fast-deep-equal` | `3.1.3` | MIT | 3,656 | `sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==` | `b019a0980f27638dc3f85836b0e478f188e00d7a6e5852c0819fa86f56e47b8f` |
| `fast-uri` | `3.1.9` | BSD-3-Clause | 50,086 | `sha512-hS/0Wt3Ya043oKXs0sIxrMpKQITXhMLIrVAKKXi4gozGC9v7YRWVnXIZzjNPTO02M9BdxLCWqK1yRXgNziVyJQ==` | `4f5a67f7b61110aae7b3ad38e806627f5712f4c150bd38eb804a562e69a9ee5e` |
| `json-schema-traverse` | `1.0.0` | MIT | 6,074 | `sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==` | `023222622df29fc274bde5d3590e47aa1d4a8e3c1d6e2aba029948ed79799b21` |
| `require-from-string` | `2.0.2` | MIT | 1,816 | `sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==` | `cb694a4965908f7775a0c757f00cf4e624d193cd71d77988fbcca0f597b88d82` |
| `yaml` | `2.9.1` | ISC | 112,114 | `sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==` | `4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3` |

`vendor/SHA256SUMS` is the canonical SHA-256 list. The verifier independently:

1. requires exactly the lockfile's registry package set and tarball paths;
2. checks each tarball's SHA-256 against `vendor/SHA256SUMS`;
3. checks every SRI digest against the `integrity` field for that package in `package-lock.json` (SHA-512 here; it does not compare the textual SHA-256 and SRI values to each other);
4. checks the tarball's internal `package.json` name and version.

Run `python3 tools/deps/vendor.py verify` to repeat these checks without installing anything.

## Offline installation and failure behavior

From the repository root:

```sh
rm -rf node_modules
./tools/deps/offline-install.sh
```

The acceptance invocation may set `npm_config_offline`, registry, cache, and proxy variables; this
installer ignores npm's cache and registry settings and reads only the committed snapshot. It verifies
all files before touching `node_modules`, extracts to a temporary staging directory, reconstructs the
lockfile's package locations and package executable links, then replaces the ignored `node_modules`
directory. A missing, extra, corrupted, wrong-version, or lockfile-mismatched tarball exits nonzero;
there is no warning-only success path or network fallback.

For an isolated damage check, use a disposable clone/copy: alter one byte in a tarball or remove one,
then run `./tools/deps/offline-install.sh`. It must exit nonzero before installation. Restore the
snapshot before running the normal acceptance command.

## Recreating the snapshot from the lockfile

Snapshot refresh is deliberately a separate, network-using maintainer operation. In a clean clone, with
a new empty cache, run the exact locked install first, then fetch and verify the original `resolved`
tarball URLs recorded by that same lockfile:

```sh
CACHE=$(mktemp -d)
test -z "$(find "$CACHE" -mindepth 1 -print -quit)"
npm_config_cache="$CACHE" npm_config_registry=https://registry.npmjs.org \
  npm ci --ignore-scripts --no-audit --fund=false
python3 tools/deps/vendor.py snapshot
python3 tools/deps/vendor.py verify
rm -rf node_modules
```

`npm ci` validates/reifies the dependency graph from the committed lockfile. `snapshot` then downloads
only HTTPS tarball URLs whose host is exactly `registry.npmjs.org`, checks each response against the
lockfile SRI before writing it, regenerates `vendor/SHA256SUMS`, and rebuilds root `NOTICE` from the
bundled license texts. The cache can be removed afterward.
This refresh procedure needs access to npm's registry; the acceptance install and checks do not.

## Reversible decision

- **Неясно:** хранить зависимости одним архивом или отдельными npm tarball.
- **Решил:** отдельные оригинальные tarball; так lockfile integrity сверяется для каждого пакета, а повреждение локализуется по имени.
- **Откат:** перейти на один архив и изменить только этот helper/manifest layout; `package-lock.json` и package versions остаются прежними.

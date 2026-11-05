#!/usr/bin/env python3
"""Build or install the package-lock-pinned npm tarball snapshot (Python stdlib only)."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import posixpath
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "package-lock.json"
VENDOR_DIR = ROOT / "vendor"
TARBALL_DIR = VENDOR_DIR / "npm"
SUMS_PATH = VENDOR_DIR / "SHA256SUMS"


def fail(message: str) -> "NoReturn":
    print(f"offline-vendor: ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def package_name_from_lock_path(lock_path: str) -> str:
    parts = lock_path.split("/")
    marker = max((index for index, part in enumerate(parts) if part == "node_modules"), default=-1)
    if marker < 0 or marker + 1 >= len(parts):
        fail(f"cannot derive package name from lockfile key {lock_path!r}")
    tail = parts[marker + 1 :]
    if tail[0].startswith("@"):
        if len(tail) < 2:
            fail(f"incomplete scoped package key {lock_path!r}")
        return f"{tail[0]}/{tail[1]}"
    return tail[0]


def safe_filename(name: str, version: str) -> str:
    filename = f"{name.replace('/', '+')}-{version}.tgz"
    if not re.fullmatch(r"[A-Za-z0-9@.+_-]+\.tgz", filename):
        fail(f"unsafe package filename derived from {name!r}@{version!r}")
    return filename


def packages_from_lock() -> list[dict]:
    try:
        lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {LOCK_PATH}: {error}")
    if lock.get("lockfileVersion") != 3:
        fail(f"expected lockfileVersion 3, got {lock.get('lockfileVersion')!r}")

    packages = []
    for lock_path, entry in sorted(lock.get("packages", {}).items()):
        if not lock_path.startswith("node_modules/"):
            continue
        name = package_name_from_lock_path(lock_path)
        version = entry.get("version")
        resolved = entry.get("resolved")
        integrity = entry.get("integrity")
        if entry.get("link") or not version or not resolved or not integrity:
            fail(f"{lock_path}: only registry packages with version, resolved URL, and integrity are supported")
        packages.append({
            "lock_path": lock_path,
            "name": name,
            "version": version,
            "license": entry.get("license", "UNKNOWN"),
            "resolved": resolved,
            "integrity": integrity,
            "filename": safe_filename(name, version),
        })
    if not packages:
        fail("package-lock.json contains no installable registry packages")
    return packages


def verify_sri(data: bytes, integrity: str, label: str) -> None:
    tokens = integrity.split()
    if not tokens:
        fail(f"{label}: empty lockfile integrity")
    for token in tokens:
        token = token.split("?", 1)[0]
        try:
            algorithm, expected = token.split("-", 1)
            actual = base64.b64encode(hashlib.new(algorithm, data).digest()).decode("ascii")
        except (ValueError, TypeError) as error:
            fail(f"{label}: unsupported SRI token {token!r}: {error}")
        if actual != expected:
            fail(f"{label}: package-lock integrity mismatch ({algorithm})")


def parse_sums() -> dict[str, str]:
    try:
        lines = SUMS_PATH.read_text(encoding="ascii").splitlines()
    except OSError as error:
        fail(f"missing or unreadable {SUMS_PATH}: {error}")
    sums: dict[str, str] = {}
    for line_number, line in enumerate(lines, 1):
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9@.+_/-]+)", line)
        if not match:
            fail(f"{SUMS_PATH}:{line_number}: malformed SHA256SUMS entry")
        digest, relative = match.groups()
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or path.parts[:1] != ("npm",):
            fail(f"{SUMS_PATH}:{line_number}: unsafe vendor path {relative!r}")
        if relative in sums:
            fail(f"{SUMS_PATH}:{line_number}: duplicate entry {relative!r}")
        sums[relative] = digest
    return sums


def validate_tarball_content(package: dict, data: bytes, label: str) -> None:
    verify_sri(data, package["integrity"], package["lock_path"])
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            package_json = archive.extractfile("package/package.json")
            if package_json is None:
                fail(f"{label}: package/package.json is missing")
            manifest = json.loads(package_json.read().decode("utf-8"))
    except (tarfile.TarError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"invalid npm package tarball {label}: {error}")
    if manifest.get("name") != package["name"] or manifest.get("version") != package["version"]:
        fail(
            f"{label}: package metadata is {manifest.get('name')}@{manifest.get('version')}, "
            f"lockfile requires {package['name']}@{package['version']}"
        )
    manifest_license = manifest.get("license")
    if package["license"] != "UNKNOWN" and manifest_license != package["license"]:
        fail(
            f"{label}: package license {manifest_license!r} differs from lockfile "
            f"{package['license']!r}"
        )


def license_text(package: dict, data: bytes) -> str:
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            candidates = sorted(
                (
                    member for member in archive.getmembers()
                    if member.isfile()
                    and PurePosixPath(member.name).parts[:1] == ("package",)
                    and PurePosixPath(member.name).name.casefold() in {
                        "license", "license.txt", "license.md", "license.rst",
                    }
                ),
                key=lambda member: member.name.casefold(),
            )
            if not candidates:
                fail(f"{package['name']}@{package['version']}: no license text in tarball")
            source = archive.extractfile(candidates[0])
            if source is None:
                fail(f"{package['name']}@{package['version']}: cannot read bundled license")
            return source.read().decode("utf-8").replace("\r\n", "\n").rstrip()
    except (tarfile.TarError, UnicodeDecodeError) as error:
        fail(f"cannot read license for {package['name']}@{package['version']}: {error}")


def expected_notice(packages: list[dict], contents: dict[str, bytes]) -> str:
    sections = [
        "Third-party notices for Synapse vendored npm development dependencies.",
        "The following license texts are copied from the corresponding package tarballs in vendor/npm.",
    ]
    for package in packages:
        sections.extend([
            "",
            f"## {package['name']}@{package['version']} — {package['license']}",
            "",
            license_text(package, contents[package["lock_path"]]),
        ])
    return "\n".join(sections).rstrip() + "\n"


def write_notice(packages: list[dict], contents: dict[str, bytes]) -> None:
    (ROOT / "NOTICE").write_text(expected_notice(packages, contents), encoding="utf-8")


def verify_package_tarball(package: dict, file_path: Path, expected_sha256: str) -> bytes:
    try:
        data = file_path.read_bytes()
    except OSError as error:
        fail(f"missing or unreadable vendor tarball {file_path}: {error}")
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if actual_sha256 != expected_sha256:
        fail(f"SHA-256 mismatch for {file_path.relative_to(VENDOR_DIR)}")
    validate_tarball_content(package, data, str(file_path))
    return data


def verify_snapshot(packages: list[dict]) -> dict[str, bytes]:
    sums = parse_sums()
    expected_paths = {f"npm/{package['filename']}" for package in packages}
    if set(sums) != expected_paths:
        missing = sorted(expected_paths - set(sums))
        extra = sorted(set(sums) - expected_paths)
        fail(f"SHA256SUMS does not match package-lock; missing={missing}, extra={extra}")
    try:
        actual_files = {
            f"npm/{path.name}"
            for path in TARBALL_DIR.iterdir()
            if path.is_file()
        }
    except OSError as error:
        fail(f"missing or unreadable {TARBALL_DIR}: {error}")
    if actual_files != expected_paths:
        fail(
            "vendor tarball set does not match package-lock; "
            f"missing={sorted(expected_paths - actual_files)}, extra={sorted(actual_files - expected_paths)}"
        )

    contents = {}
    for package in packages:
        relative = f"npm/{package['filename']}"
        contents[package["lock_path"]] = verify_package_tarball(
            package, VENDOR_DIR / relative, sums[relative],
        )
    expected = expected_notice(packages, contents).encode("utf-8")
    try:
        actual_notice = (ROOT / "NOTICE").read_bytes()
    except OSError as error:
        fail(f"missing or unreadable NOTICE: {error}")
    try:
        actual_notice.decode("utf-8")
    except UnicodeDecodeError as error:
        fail(f"NOTICE is not valid UTF-8: {error}")
    if not actual_notice.startswith(expected):
        fail("NOTICE does not start with the license block bundled in the verified tarballs")
    return contents


def safe_member_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "package":
        fail(f"unsafe archive entry {name!r}")
    relative = PurePosixPath(*path.parts[1:])
    if not relative.parts:
        return relative
    if any(part in ("", ".") for part in relative.parts):
        fail(f"non-canonical archive entry {name!r}")
    return relative


def extract_package(data: bytes, destination: Path, label: str) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    pending_links = []
    seen = set()
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive.getmembers():
                relative = safe_member_path(member.name)
                if not relative.parts:
                    continue
                relative_text = relative.as_posix()
                if relative_text in seen:
                    fail(f"{label}: duplicate archive path {relative_text!r}")
                seen.add(relative_text)
                target = destination.joinpath(*relative.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                if member.isfile():
                    source = archive.extractfile(member)
                    if source is None:
                        fail(f"{label}: cannot read archive member {member.name!r}")
                    with target.open("xb") as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(member.mode & 0o777)
                elif member.issym():
                    link = PurePosixPath(member.linkname)
                    resolved = PurePosixPath(posixpath.normpath(posixpath.join(relative.parent.as_posix(), member.linkname)))
                    if link.is_absolute() or ".." in resolved.parts or resolved == PurePosixPath("."):
                        fail(f"{label}: unsafe symbolic link {member.name!r} -> {member.linkname!r}")
                    target.symlink_to(member.linkname)
                elif member.islnk():
                    link_name = member.linkname
                    if link_name.startswith("package/"):
                        link_name = link_name[len("package/"):]
                    link = PurePosixPath(link_name)
                    if link.is_absolute() or ".." in link.parts:
                        fail(f"{label}: unsafe hard link {member.name!r} -> {member.linkname!r}")
                    pending_links.append((target, destination.joinpath(*link.parts), member.name))
                else:
                    fail(f"{label}: unsupported archive member type for {member.name!r}")
    except tarfile.TarError as error:
        fail(f"invalid archive for {label}: {error}")

    for target, link_target, member_name in pending_links:
        if not link_target.is_file():
            fail(f"{label}: hard-link target missing for {member_name!r}")
        os.link(link_target, target)


def package_bin_links(package: dict, stage: Path) -> None:
    package_parts = PurePosixPath(package["lock_path"]).parts[1:]
    package_dir = stage.joinpath(*package_parts)
    manifest_path = package_dir / "package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bins = manifest.get("bin")
    if not bins:
        return
    if isinstance(bins, str):
        bin_name = package["name"].rsplit("/", 1)[-1]
        bins = {bin_name: bins}
    elif not isinstance(bins, dict):
        fail(f"{package['lock_path']}: invalid package.json bin field")

    parent_parts = package_parts[:-1]
    if len(PurePosixPath(package["lock_path"]).parts) < 2:
        fail(f"{package['lock_path']}: cannot determine npm .bin directory")
    bin_dir = stage.joinpath(*parent_parts, ".bin")
    bin_dir.mkdir(parents=True, exist_ok=True)
    for name, relative_target in bins.items():
        target = package_dir / relative_target
        if not target.is_file():
            fail(f"{package['lock_path']}: bin target {relative_target!r} is missing")
        link = bin_dir / name
        if link.exists() or link.is_symlink():
            fail(f"duplicate npm executable name {name!r} in {bin_dir}")
        link.symlink_to(os.path.relpath(target, bin_dir))


def install_snapshot(packages: list[dict], contents: dict[str, bytes], stage: Path) -> None:
    if stage.exists() and any(stage.iterdir()):
        fail(f"staging directory is not empty: {stage}")
    stage.mkdir(parents=True, exist_ok=True)
    for package in packages:
        destination = stage.joinpath(*PurePosixPath(package["lock_path"]).parts[1:])
        extract_package(contents[package["lock_path"]], destination, package["lock_path"])
        manifest = json.loads((destination / "package.json").read_text(encoding="utf-8"))
        if manifest.get("name") != package["name"] or manifest.get("version") != package["version"]:
            fail(f"installed metadata differs from lockfile for {package['lock_path']}")
    for package in packages:
        package_bin_links(package, stage)


def snapshot_from_registry(packages: list[dict]) -> None:
    downloaded: dict[str, bytes] = {}
    for package in packages:
        parsed = urlparse(package["resolved"])
        if parsed.scheme != "https" or parsed.hostname != "registry.npmjs.org":
            fail(f"{package['lock_path']}: refusing non-registry tarball URL {package['resolved']!r}")
        try:
            request = Request(package["resolved"], headers={"User-Agent": "synapse-lockfile-vendor/1"})
            with urlopen(request, timeout=60) as response:
                final_url = urlparse(response.geturl())
                if final_url.scheme != "https" or final_url.hostname != "registry.npmjs.org":
                    fail(f"{package['lock_path']}: registry redirected outside registry.npmjs.org")
                data = response.read()
        except OSError as error:
            fail(f"download failed for {package['lock_path']}: {error}")
        validate_tarball_content(package, data, package["resolved"])
        downloaded[package["lock_path"]] = data
        print(
            f"snapshot: {package['name']}@{package['version']} bytes={len(data)} "
            f"lock-integrity={package['integrity']}"
        )

    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    TARBALL_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="synapse-vendor-") as temporary:
        temporary_dir = Path(temporary)
        sums = []
        for package in packages:
            data = downloaded[package["lock_path"]]
            temp_file = temporary_dir / package["filename"]
            temp_file.write_bytes(data)
            sums.append((hashlib.sha256(data).hexdigest(), f"npm/{package['filename']}"))
        for package in packages:
            source = temporary_dir / package["filename"]
            destination = TARBALL_DIR / package["filename"]
            os.replace(source, destination)
        sum_text = "".join(f"{digest}  {relative}\n" for digest, relative in sorted(sums))
        sum_temp = VENDOR_DIR / ".SHA256SUMS.tmp"
        sum_temp.write_text(sum_text, encoding="ascii")
        os.replace(sum_temp, SUMS_PATH)
    write_notice(packages, downloaded)
    total = sum(map(len, downloaded.values()))
    print(f"snapshot: wrote {len(packages)} packages, {total} tarball bytes; SHA256SUMS regenerated")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("snapshot", "verify", "install"))
    parser.add_argument("--stage", type=Path, help="empty node_modules staging directory for install mode")
    args = parser.parse_args()

    packages = packages_from_lock()
    if args.mode == "snapshot":
        snapshot_from_registry(packages)
        verify_snapshot(packages)
        print("snapshot: post-write SHA-256 and package-lock SRI verification passed")
        return

    contents = verify_snapshot(packages)
    total = sum(len(data) for data in contents.values())
    if args.mode == "verify":
        print(f"offline-vendor: verified {len(packages)} packages, {total} tarball bytes; SHA-256 and lockfile SRI match")
        return
    if args.stage is None:
        fail("install mode requires --stage")
    install_snapshot(packages, contents, args.stage.resolve())
    print(f"offline-vendor: installed {len(packages)} lockfile packages ({total} tarball bytes)")


if __name__ == "__main__":
    main()

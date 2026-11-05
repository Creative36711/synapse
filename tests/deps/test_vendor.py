#!/usr/bin/env python3
"""Regression tests for the offline npm snapshot verifier (Python stdlib only)."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[2]
VENDOR_SCRIPT = REPO_ROOT / "tools/deps/vendor.py"
_spec = importlib.util.spec_from_file_location("synapse_vendor", VENDOR_SCRIPT)
assert _spec is not None and _spec.loader is not None
vendor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vendor)


def make_tarball() -> bytes:
    package_json = json.dumps(
        {"name": "fixture-package", "version": "1.0.0", "license": "MIT"},
        sort_keys=True,
    ).encode("utf-8")
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in (
            ("package/package.json", package_json),
            ("package/LICENSE", b"MIT fixture license\n"),
        ):
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o644
            member.mtime = 0
            archive.addfile(member, io.BytesIO(data))
    return output.getvalue()


def sri_sha512(data: bytes) -> str:
    digest = base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    return f"sha512-{digest}"


class VendorSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="synapse-vendor-test-")
        self.root = Path(self.temp.name)
        self.vendor_dir = self.root / "vendor"
        self.tarball_dir = self.vendor_dir / "npm"
        self.tarball_dir.mkdir(parents=True)
        self.lock_path = self.root / "package-lock.json"
        self.sums_path = self.vendor_dir / "SHA256SUMS"
        self.notice_path = self.root / "NOTICE"
        self.tarball_path = self.tarball_dir / "fixture-package-1.0.0.tgz"
        self.tarball = make_tarball()
        self.tarball_path.write_bytes(self.tarball)

        self.original_paths = {
            "ROOT": vendor.ROOT,
            "LOCK_PATH": vendor.LOCK_PATH,
            "VENDOR_DIR": vendor.VENDOR_DIR,
            "TARBALL_DIR": vendor.TARBALL_DIR,
            "SUMS_PATH": vendor.SUMS_PATH,
        }
        vendor.ROOT = self.root
        vendor.LOCK_PATH = self.lock_path
        vendor.VENDOR_DIR = self.vendor_dir
        vendor.TARBALL_DIR = self.tarball_dir
        vendor.SUMS_PATH = self.sums_path

        self._write_lock_integrity(sri_sha512(self.tarball))
        self._write_sums(hashlib.sha256(self.tarball).hexdigest())
        self.packages = vendor.packages_from_lock()
        self.contents = {self.packages[0]["lock_path"]: self.tarball}
        self.expected_notice = vendor.expected_notice(self.packages, self.contents).encode("utf-8")

    def tearDown(self) -> None:
        for name, value in self.original_paths.items():
            setattr(vendor, name, value)
        self.temp.cleanup()

    def _write_lock_integrity(self, integrity: str) -> None:
        self.lock_path.write_text(
            json.dumps(
                {
                    "lockfileVersion": 3,
                    "packages": {
                        "": {"name": "synapse-fixture", "version": "1.0.0"},
                        "node_modules/fixture-package": {
                            "version": "1.0.0",
                            "resolved": "https://registry.npmjs.org/fixture-package/-/fixture-package-1.0.0.tgz",
                            "integrity": integrity,
                            "license": "MIT",
                        },
                    },
                }
            ),
            encoding="utf-8",
        )

    def _write_sums(self, digest: str) -> None:
        self.sums_path.write_text(
            f"{digest}  npm/fixture-package-1.0.0.tgz\n",
            encoding="ascii",
        )

    def _assert_snapshot_rejected(self, expected_message: str) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
            vendor.verify_snapshot(vendor.packages_from_lock())
        self.assertEqual(raised.exception.code, 1)
        self.assertIn(expected_message, stderr.getvalue())

    def test_append_only_notice_suffix_is_accepted(self) -> None:
        self.notice_path.write_bytes(
            self.expected_notice + b"\n## Godot and other third-party notices\nAttribution retained.\n"
        )
        verified = vendor.verify_snapshot(self.packages)
        self.assertEqual(verified, self.contents)

    def test_missing_truncated_and_corrupted_npm_notice_blocks_are_rejected(self) -> None:
        broken_prefixes = {
            "missing": b"",
            "truncated": self.expected_notice[:-1],
            "corrupted": b"X" + self.expected_notice[1:],
        }
        for label, notice in broken_prefixes.items():
            with self.subTest(label=label):
                self.notice_path.write_bytes(notice)
                self._assert_snapshot_rejected(
                    "NOTICE does not start with the license block bundled in the verified tarballs"
                )

    def test_missing_notice_file_is_rejected(self) -> None:
        self._assert_snapshot_rejected("missing or unreadable NOTICE")

    def test_non_utf8_suffix_is_rejected(self) -> None:
        self.notice_path.write_bytes(self.expected_notice + b"\xff")
        self._assert_snapshot_rejected("NOTICE is not valid UTF-8")

    def test_sha256_mismatch_in_tarball_is_rejected(self) -> None:
        self.notice_path.write_bytes(self.expected_notice)
        self.tarball_path.write_bytes(self.tarball + b"damage")
        self._assert_snapshot_rejected("SHA-256 mismatch")

    def test_sha256_manifest_mismatch_is_rejected(self) -> None:
        self.notice_path.write_bytes(self.expected_notice)
        self._write_sums("0" * 64)
        self._assert_snapshot_rejected("SHA-256 mismatch")

    def test_lockfile_sri_mismatch_is_rejected(self) -> None:
        self.notice_path.write_bytes(self.expected_notice)
        wrong_integrity = "sha512-" + base64.b64encode(b"\x00" * 64).decode("ascii")
        self._write_lock_integrity(wrong_integrity)
        self._assert_snapshot_rejected("package-lock integrity mismatch")

    def test_invalid_archive_with_matching_hash_and_sri_is_rejected(self) -> None:
        invalid_archive = b"not a gzip-compressed tar archive"
        self.tarball_path.write_bytes(invalid_archive)
        self._write_sums(hashlib.sha256(invalid_archive).hexdigest())
        self._write_lock_integrity(sri_sha512(invalid_archive))
        self.notice_path.write_bytes(self.expected_notice)
        self._assert_snapshot_rejected("invalid npm package tarball")


if __name__ == "__main__":
    unittest.main(verbosity=2)

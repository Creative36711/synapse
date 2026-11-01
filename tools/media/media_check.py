#!/usr/bin/env python3
"""
media_check.py — cheap acceptance gate for generated media.

  media_check.py assets/            # walk a directory
  media_check.py a.png b.mp3 --json

Checks (ported from narthex `npm run media:check`, same thresholds):
  * signature vs. extension — a ".png" that is really HTML/JPEG/error page fails;
  * chroma residue — share of OPAQUE pure-green pixels (strict key from
    cutout-chromakey.py: cyan/teal is NOT background) above 0.5 % fails;
  * opaque corners on a PNG with alpha — warning (cutout probably forgotten);
  * weight — > 4 MB per image, > 8 MB per audio file fails;
  * duplicates by sha256 — warning.

Does NOT judge beauty, audio duration or bitrate: look at images yourself
(read_file on a contact sheet) and listen/peek at audio with ffmpeg.
Exit code 1 if any check failed. Pillow is needed for pixel checks
(tools/media/setup.sh); without it only signature/size/duplicate checks run.
"""
import argparse
import hashlib
import json
import os
import sys

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_EXT = {".mp3", ".ogg", ".wav", ".opus"}
IMG_LIMIT = 4 * 1024 * 1024
AUDIO_LIMIT = 8 * 1024 * 1024
CHROMA_LIMIT = 0.005


def signature_ok(path, ext, head):
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == ".wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext in (".ogg", ".opus"):
        return head.startswith(b"OggS")
    if ext == ".mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    return True


def green_key(r, g, b, tol=70):
    # identical to cutout-chromakey.py: bright, dominant green that is not cyan
    return g > 140 and (g - max(r, b)) > tol and b < g * 0.75


def pixel_checks(path):
    try:
        from PIL import Image
    except ImportError:
        return None, []
    issues = []
    img = Image.open(path)
    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    img = img.convert("RGBA")
    w, h = img.size
    # sample at most ~250k pixels for speed
    step = max(1, int(((w * h) / 250_000) ** 0.5))
    px = img.load()
    total = green = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b, a = px[x, y]
            total += 1
            if a > 200 and green_key(r, g, b):
                green += 1
    share = green / max(1, total)
    if share > CHROMA_LIMIT:
        issues.append(("fail", f"chroma residue {share:.1%} opaque #00FF00-like pixels "
                               f"(run cutout-chromakey, maybe --mode color)"))
    if has_alpha:
        corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
        if all(c[3] > 200 for c in corners):
            issues.append(("warn", "PNG has alpha but all 4 corners are opaque (cutout forgotten?)"))
    return {"size": [w, h], "alpha": has_alpha, "chroma_share": round(share, 5)}, issues


def check_file(path):
    ext = os.path.splitext(path)[1].lower()
    info = {"file": path, "issues": []}
    size = os.path.getsize(path)
    info["bytes"] = size
    with open(path, "rb") as f:
        head = f.read(16)
    if not signature_ok(path, ext, head):
        info["issues"].append(("fail", f"content does not match extension {ext} (head={head[:8]!r})"))
        return info
    if ext in IMG_EXT:
        if size > IMG_LIMIT:
            info["issues"].append(("fail", f"image is {size / 1e6:.1f} MB > 4 MB"))
        meta, issues = pixel_checks(path)
        if meta:
            info.update(meta)
        info["issues"] += issues
    elif ext in AUDIO_EXT and size > AUDIO_LIMIT:
        info["issues"].append(("fail", f"audio is {size / 1e6:.1f} MB > 8 MB"))
    return info


def main():
    ap = argparse.ArgumentParser(description="Signature / chroma residue / size gate for media files")
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    files = []
    for p in args.paths:
        if os.path.isdir(p):
            for root, dirs, names in os.walk(p):
                dirs[:] = [d for d in dirs if d not in (".godot", ".git", ".import")]
                for n in sorted(names):
                    if os.path.splitext(n)[1].lower() in IMG_EXT | AUDIO_EXT:
                        files.append(os.path.join(root, n))
        else:
            files.append(p)

    results, seen = [], {}
    for f in files:
        r = check_file(f)
        digest = hashlib.sha256(open(f, "rb").read()).hexdigest()
        if digest in seen:
            r["issues"].append(("warn", f"duplicate of {seen[digest]}"))
        else:
            seen[digest] = f
        results.append(r)

    fails = sum(1 for r in results for lvl, _ in r["issues"] if lvl == "fail")
    warns = sum(1 for r in results for lvl, _ in r["issues"] if lvl == "warn")
    if args.json:
        print(json.dumps({"files": results, "fail": fails, "warn": warns}, ensure_ascii=False, indent=1))
    else:
        for r in results:
            mark = "✗" if any(l == "fail" for l, _ in r["issues"]) else ("!" if r["issues"] else "✓")
            extra = f" {r['size'][0]}x{r['size'][1]}" if "size" in r else ""
            print(f"{mark} {r['file']}{extra}")
            for lvl, msg in r["issues"]:
                print(f"    {lvl}: {msg}")
        print(f"\n{len(results)} files, {fails} failed, {warns} warnings")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

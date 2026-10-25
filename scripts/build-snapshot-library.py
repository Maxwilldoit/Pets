#!/usr/bin/env python3
"""Build only the explicitly listed public ZIPs from sources/archives.

Build: python scripts/build-snapshot-library.py --source-dir /path/to/zips
Check tracked metadata: python scripts/build-snapshot-library.py --check
Check release archives too: add --archives
Building previews / normalized walking GIFs requires Pillow >= 10.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/Maxwilldoit/Pets"
RAW = "https://raw.githubusercontent.com/Maxwilldoit/Pets/main"
LICENSE = "未单独声明素材许可"
VERSION = "1.0.0"
EVENTS = {"capture.success", "capture.failure", "recording.started", "recording.stopped",
          "recording.failure", "polish.success", "polish.failure", "shortcuts.paused", "shortcuts.resumed"}
STATES = {"recording", "shortcuts-paused"}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def hash_bytes(data):
    return hashlib.sha256(data).hexdigest()


def normalized_walk(data, idle, anchor):
    """Wide travelling GIFs become in-place walking on the idle canvas.

    Keep each frame's vertical movement and timing; follow the character horizontally.
    This also keeps GIF dimensions consistent with Snapshot's layout manifest.
    """
    from PIL import Image, ImageSequence
    image = Image.open(io.BytesIO(data))
    frames = [(frame.convert("RGBA"), frame.info.get("duration", 100)) for frame in ImageSequence.Iterator(image)]
    tallest = max(frame.getbbox()[3] - frame.getbbox()[1] for frame, _ in frames if frame.getbbox())
    idle_box = idle.getbbox()
    idle_height = idle_box[3] - idle_box[1]
    scale = idle_height / tallest if tallest > idle_height * 1.15 else 1
    if scale != 1:
        frames = [(frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.Resampling.NEAREST), delay)
                  for frame, delay in frames]
    bottom = max(frame.getbbox()[3] for frame, _ in frames if frame.getbbox())
    result, delays = [], []
    for frame, delay in frames:
        canvas = Image.new("RGBA", idle.size)
        box = frame.getbbox()
        if box:
            left = round(anchor[0] - (box[0] + box[2]) / 2)
            canvas.alpha_composite(frame, (left, round(anchor[1] - bottom)))
        # Reserve palette index 255 for transparent pixels, avoiding GIF trails.
        indexed = canvas.convert("RGB").quantize(colors=255)
        indexed.paste(255, mask=canvas.getchannel("A").point(lambda alpha: 255 if alpha < 128 else 0))
        indexed.info["transparency"] = 255
        result.append(indexed)
        delays.append(delay)
    output = io.BytesIO()
    result[0].save(output, format="GIF", save_all=True, append_images=result[1:], duration=delays,
                   loop=0, disposal=2, transparency=255, optimize=False)
    return output.getvalue()


def build(source_dir):
    from PIL import Image
    config = read_json(ROOT / "catalog/sources.json")
    destination = ROOT / "dist" / config["release"]
    destination.mkdir(parents=True, exist_ok=True)
    assets = []
    for spec in config["assets"]:
        # Never enumerate the input folder: this file is the publication allowlist.
        source = source_dir / spec["source"]
        with ZipFile(source) as archive:
            gifs = {name: archive.read(name) for name in archive.namelist() if name.lower().endswith(".gif")}
            manifest = json.loads(archive.read("pet.json")) if "pet.json" in archive.namelist() else None
        idle = Image.open(io.BytesIO(gifs[spec["idle"]])).convert("RGBA")
        box = idle.getbbox()
        anchor = [(box[0] + box[2]) / 2, box[3]]
        if manifest is None:
            manifest = {"version": 1, "base": {"width": idle.width, "height": idle.height, "anchor": anchor}, "animations": {}}
        base = manifest["base"]
        anchor = base["anchor"]
        for entry in spec.get("normalizeWalks", []):
            gifs[entry] = normalized_walk(gifs[entry], idle, anchor)
        for name, data in gifs.items():
            image = Image.open(io.BytesIO(data)).convert("RGBA")
            bounds = image.getbbox()
            point = anchor if image.size == (base["width"], base["height"]) else [(bounds[0] + bounds[2]) / 2, bounds[3]]
            manifest["animations"].setdefault(name, {"anchor": point})

        # Dedicated copies let feedback mappings coexist with click-to-cycle originals.
        aliases = {}
        for action in ("success", "failure", "recording", "paused", "resumed"):
            if action not in spec:
                continue
            entry = spec[action]
            alias = f"feedback/{action}.gif"
            gifs[alias] = gifs[entry]
            manifest["animations"][alias] = dict(manifest["animations"][entry])
            aliases[action] = alias
        manifest["events"] = {}
        for event in ("capture.success", "polish.success", "recording.stopped"):
            manifest["events"][event] = aliases["success"]
        if "failure" in aliases:
            for event in ("capture.failure", "polish.failure", "recording.failure"):
                manifest["events"][event] = aliases["failure"]
        manifest["events"]["recording.started"] = aliases.get("resumed", aliases["success"])
        manifest["events"]["shortcuts.resumed"] = aliases.get("resumed", aliases["success"])
        manifest["events"]["shortcuts.paused"] = aliases["paused"]
        manifest["states"] = {"shortcuts-paused": aliases["paused"]}
        if "recording" in aliases:
            manifest["states"]["recording"] = aliases["recording"]
        write_json(ROOT / f"catalog/manifests/{spec['id']}.json", manifest)
        file_name = f"{spec['id']}-{VERSION}.zip"
        license_text = f"{spec['name']}\n素材许可：{LICENSE}。\n公开提供下载不表示授予开放许可或商业使用许可。\n来源：{REPOSITORY}\n"
        contents = {**gifs, "pet.json": (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
                    "ASSET-LICENSE.txt": license_text.encode()}
        with ZipFile(destination / file_name, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(contents.items()):
                if ".." in PurePosixPath(name).parts or PurePosixPath(name).is_absolute():
                    raise ValueError(f"Unsafe archive entry: {name}")
                info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, data)
        data = (destination / file_name).read_bytes()
        preview = idle.crop(box)
        preview.thumbnail((128, 128), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (144, 144))
        canvas.alpha_composite(preview, ((144 - preview.width) // 2, 136 - preview.height))
        preview_path = ROOT / f"catalog/previews/{spec['id']}.png"
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(preview_path, optimize=True)
        assets.append({"id": spec["id"], "name": spec["name"], "description": spec["description"],
                       "tags": spec["tags"], "version": VERSION, "file": file_name,
                       "sizeBytes": len(data), "sha256": hash_bytes(data), "sourceSha256": hash_bytes(source.read_bytes()),
                       "downloadUrl": f"{REPOSITORY}/releases/download/{config['release']}/{file_name}",
                       "previewUrl": f"{RAW}/catalog/previews/{spec['id']}.png", "licenseStatus": LICENSE})
        print(f"Built {spec['id']}: {len(gifs)} GIFs, {len(data)} bytes")
    write_json(ROOT / "catalog.json", {"version": 1, "assets": assets})
    (destination / "SHA256SUMS.txt").write_text("".join(f"{asset['sha256']}  {asset['file']}\n" for asset in assets), encoding="utf-8")


def check(archives=False):
    config = read_json(ROOT / "catalog/sources.json")
    catalog = read_json(ROOT / "catalog.json")
    assert catalog["version"] == 1
    assets = catalog["assets"]
    assert len({a["id"] for a in assets}) == len(assets)
    assert {a["id"] for a in assets} == {s["id"] for s in config["assets"]}
    for asset in assets:
        assert re.fullmatch(r"[a-z0-9-]{1,64}", asset["id"])
        assert asset["file"] == f"{asset['id']}-{asset['version']}.zip"
        assert asset["downloadUrl"] == f"{REPOSITORY}/releases/download/{config['release']}/{asset['file']}"
        assert asset["previewUrl"] == f"{RAW}/catalog/previews/{asset['id']}.png"
        assert re.fullmatch(r"[a-f0-9]{64}", asset["sha256"])
        assert 0 < asset["sizeBytes"] <= 100 * 1024 * 1024
        assert asset["licenseStatus"] == LICENSE
        assert (ROOT / f"catalog/previews/{asset['id']}.png").is_file()
        manifest = read_json(ROOT / f"catalog/manifests/{asset['id']}.json")
        assert manifest["version"] == 1 and set(manifest["events"]) <= EVENTS and set(manifest["states"]) <= STATES
        assert all(entry in manifest["animations"] for entry in [*manifest["events"].values(), *manifest["states"].values()])
        if archives:
            path = ROOT / "dist" / config["release"] / asset["file"]
            data = path.read_bytes()
            assert len(data) == asset["sizeBytes"] and hash_bytes(data) == asset["sha256"]
            with ZipFile(io.BytesIO(data)) as archive:
                assert archive.testzip() is None
                assert json.loads(archive.read("pet.json")) == manifest
                for name in archive.namelist():
                    assert ".." not in PurePosixPath(name).parts and not PurePosixPath(name).is_absolute()
                    assert name.endswith(".gif") or name in {"pet.json", "ASSET-LICENSE.txt"}
                for name in manifest["animations"]:
                    assert archive.read(name)[:6] in (b"GIF87a", b"GIF89a")
    print(f"Validated {len(assets)} public catalog entries" + (" and release ZIPs" if archives else ""))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--archives", action="store_true")
    args = parser.parse_args()
    if args.source_dir:
        build(args.source_dir)
        check(True)
    elif args.check:
        check(args.archives)
    else:
        parser.error("provide --source-dir or --check")

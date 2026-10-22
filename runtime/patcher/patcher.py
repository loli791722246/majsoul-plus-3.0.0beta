#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""雀魂 Plus 资源包补丁器（Unity AssetBundle 版）。

这个程序由雀魂 Plus 主程序调用，用来：
  1. `index`：下载 bundle_info_so.majset，解析出「资源名 / 分组 -> bundle」索引；
  2. `patch`：把用户提供的 png / txt 写进对应的 .majset，输出可直接下发的 bundle。

它依赖 UnityPy。打包成 exe 后不需要用户安装 Python。
"""

import argparse
import io
import json
import os
import shutil
import sys
import urllib.request

import UnityPy
from PIL import Image

# 雀魂的 bundle 头里写的是 "5.x.x"，UnityPy 需要一个真实的版本号做回退
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f1"

BASE = "https://game.maj-soul.com"
BUNDLE_INFO_URL = BASE + "/assetbundles/DXT/bundle_info_so.majset"
BUNDLE_HASH_URL = BASE + "/assetbundles/DXT/bundle_hash.txt"
BUNDLE_BASE = BASE + "/assetbundles/DXT/"


def log(message):
    print(message, file=sys.stderr, flush=True)


def http_get(url: str) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 MajsoulPlus"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def download(url: str, path: str) -> str:
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    log("下载 " + url)
    data = http_get(url)
    tmp = path + ".tmp"
    with open(tmp, "wb") as handle:
        handle.write(data)
    os.replace(tmp, path)
    return path


def read_bundle_hash(cache_dir: str) -> str:
    path = os.path.join(cache_dir, "bundle_hash.txt")
    download(BUNDLE_HASH_URL, path)
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


def load_bundle_info(cache_dir: str):
    path = os.path.join(cache_dir, "bundle_info_so.majset")
    download(BUNDLE_INFO_URL, path)
    env = UnityPy.load(path)
    for obj in env.objects:
        if obj.type.name == "MonoBehaviour":
            tree = obj.read_typetree()
            if "bundleInfos" in tree and "assetInfos" in tree:
                return tree
    raise RuntimeError("bundle_info_so 中没有找到 BundleInfoSO")


def command_index(args):
    os.makedirs(args.cache, exist_ok=True)
    version = read_bundle_hash(args.cache)
    info = load_bundle_info(args.cache)

    bundles = [item["name"] for item in info["bundleInfos"]]
    groups = {}
    for item in info.get("groupInfos", []):
        groups[item["groupName"]] = [
            bundles[i] for i in item["bundlesIndex"] if 0 <= i < len(bundles)
        ]

    assets = {}
    for item in info.get("assetInfos", []):
        index = item.get("ownerBundleIndex", -1)
        if 0 <= index < len(bundles):
            assets[item["assetPath"]] = bundles[index]

    data = {
        "version": version,
        "bundles": bundles,
        "groups": groups,
        "assets": assets,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    log("索引完成：%d 个包 / %d 个资源 / %d 个分组" % (len(bundles), len(assets), len(groups)))
    print(json.dumps({"ok": True, "version": version}))


def _resolve_extension(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def _replace_texture(obj, image_path: str) -> str:
    data = obj.read()
    image = Image.open(image_path).convert("RGBA")
    width, height = data.m_Width, data.m_Height
    if image.size != (width, height):
        image = image.resize((width, height), Image.LANCZOS)
    data.set_image(image)
    data.save()
    return "%s (%dx%d)" % (data.m_Name, width, height)


def _make_full_rect_sprite(
    obj,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    scale: float = 1.0,
) -> str:
    """把 Sprite 的紧贴网格改成覆盖整张纹理的四边形。

    offset_x / offset_y 是纹理像素单位的平移，scale 是整体缩放，
    用来微调立绘在屏幕上的位置和大小。
    """
    import struct

    data = obj.read()
    rd = data.m_RD
    width = float(data.m_Rect.width)
    height = float(data.m_Rect.height)
    ppu = float(getattr(data, "m_PixelsToUnits", 100.0) or 100.0)
    pivot = getattr(data, "m_Pivot", None)
    px = float(getattr(pivot, "x", 0.5)) if pivot is not None else 0.5
    py = float(getattr(pivot, "y", 0.5)) if pivot is not None else 0.5
    w = width / ppu
    h = height / ppu
    dx = offset_x / ppu
    dy = offset_y / ppu
    scale = scale if scale > 0 else 1.0
    x0 = -px * w * scale + dx
    x1 = (1.0 - px) * w * scale + dx
    y0 = -py * h * scale + dy
    y1 = (1.0 - py) * h * scale + dy

    positions = [(x0, y0, 0.0), (x1, y0, 0.0), (x1, y1, 0.0), (x0, y1, 0.0)]
    uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    blob = b"".join(struct.pack("<fff", *point) for point in positions)
    blob += b"".join(struct.pack("<ff", *uv) for uv in uvs)

    rd.m_VertexData.m_VertexCount = 4
    rd.m_VertexData.m_DataSize = blob
    rd.m_IndexBuffer = struct.pack("<6H", 0, 1, 2, 2, 3, 0)

    if rd.m_SubMeshes:
        sub = rd.m_SubMeshes[0]
        sub.indexCount = 6
        sub.vertexCount = 4
        sub.firstVertex = 0
        sub.firstByte = 0
        sub.baseVertex = 0
    rd.settingsRaw = 0
    data.save()
    return data.m_Name


def _replace_text(obj, file_path: str) -> str:
    data = obj.read()
    with open(file_path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = None
    if isinstance(getattr(data, "m_Script", None), str) and text is not None:
        data.m_Script = text
    else:
        data.m_Script = raw
    data.save()
    return data.m_Name


def command_patch(args):
    with open(args.plan, "r", encoding="utf-8-sig") as handle:
        plan = json.load(handle)

    source = os.path.join(args.cache, "bundles", args.bundle)
    download(BUNDLE_BASE + args.bundle, source)

    env = UnityPy.load(source)
    applied = []
    texture_names = []
    texture_offsets = {}

    for item in plan:
        target = item["target"]
        file_path = item["file"]
        name = target.split("/")[-1]
        extension = _resolve_extension(file_path)
        is_texture = extension in (".png", ".jpg", ".jpeg", ".webp")
        sprite_offset_x = float(item.get("sprite_offset_x", 0) or 0)
        sprite_offset_y = float(item.get("sprite_offset_y", 0) or 0)
        sprite_scale = float(item.get("sprite_scale", 1) or 1)

        for obj in env.objects:
            type_name = obj.type.name
            if is_texture and type_name not in ("Texture2D", "Sprite"):
                continue
            if not is_texture and type_name not in ("TextAsset",):
                continue
            try:
                data = obj.read()
            except Exception:
                continue
            object_name = getattr(data, "m_Name", "")
            if object_name != name and not object_name.endswith(name):
                continue
            try:
                if is_texture and type_name == "Texture2D":
                    texture_names.append(object_name)
                    texture_offsets[object_name] = (
                        sprite_offset_x,
                        sprite_offset_y,
                        sprite_scale,
                    )
                    applied.append(target + " -> " + _replace_texture(obj, file_path))
                elif is_texture and type_name == "Sprite":
                    # Sprite 只改引用，纹理由 Texture2D 处理
                    continue
                else:
                    applied.append(target + " -> " + _replace_text(obj, file_path))
            except Exception as error:  # noqa: BLE001
                log("替换失败 %s: %s" % (target, error))

    # 贴图替换后，把对应 Sprite 的 Tight Mesh 改成整图四边形
    for sprite_obj in env.objects:
        if sprite_obj.type.name != "Sprite":
            continue
        try:
            sprite_data = sprite_obj.read()
        except Exception:
            continue
        if getattr(sprite_data, "m_Name", "") in texture_names:
            try:
                offset_x, offset_y, scale = texture_offsets.get(
                    sprite_data.m_Name, (0, 0, 1)
                )
                _make_full_rect_sprite(sprite_obj, offset_x, offset_y, scale)
                log(
                    "已展开 Sprite 网格：%s (offset %s,%s scale %s)"
                    % (sprite_data.m_Name, offset_x, offset_y, scale)
                )
            except Exception as error:  # noqa: BLE001
                log("展开 Sprite 网格失败 %s: %s" % (sprite_data.m_Name, error))

    if not applied:
        print(json.dumps({"ok": False, "error": "bundle 中没有匹配的资源"}))
        return 1

    os.makedirs(args.out_dir, exist_ok=True)
    saved = env.save(pack="lz4", out_path=args.out_dir)
    output = os.path.join(args.out_dir, args.bundle)
    if not os.path.exists(output):
        # 某些 UnityPy 版本返回字典
        if isinstance(saved, dict) and args.bundle in saved:
            with open(output, "wb") as handle:
                handle.write(saved[args.bundle])
        else:
            env.save(pack="none", out_path=args.out_dir)
    print(json.dumps({"ok": True, "applied": applied, "output": output}))
    return 0


def _add_glyphs(
    font_bytes: bytes,
    chars: str,
    source_path: str,
    scale: float = 1.0,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
) -> tuple:
    """把 source 字体里的字形复制到 font_bytes，返回 (新字体字节, 新增字符)。

    scale 为字形缩放（1.0 表示按字体 em 比例原样），
    offset_x / offset_y 为 em 比例偏移（0.01 表示 1% em）。
    """
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    class ScalePen:
        def __init__(self, out, scale, dx, dy):
            self.out = out
            self.scale = scale
            self.dx = dx
            self.dy = dy

        def _p(self, pt):
            return (
                pt[0] * self.scale + self.dx,
                pt[1] * self.scale + self.dy,
            )

        def moveTo(self, pt):
            self.out.moveTo(self._p(pt))

        def lineTo(self, pt):
            self.out.lineTo(self._p(pt))

        def qCurveTo(self, *points):
            self.out.qCurveTo(
                *[self._p(p) if p is not None else None for p in points]
            )

        def curveTo(self, *points):
            self.out.curveTo(*[self._p(p) for p in points])

        def closePath(self):
            self.out.closePath()

        def endPath(self):
            self.out.endPath()

    target = TTFont(io.BytesIO(font_bytes))
    source = (
        TTFont(source_path, fontNumber=0)
        if source_path.lower().endswith(".ttc")
        else TTFont(source_path)
    )
    upem = target["head"].unitsPerEm
    ratio = upem / source["head"].unitsPerEm
    dx = offset_x * upem
    dy = offset_y * upem
    src_cmap = source.getBestCmap()
    src_glyphs = source.getGlyphSet()
    existing = set(target.getBestCmap())
    added = []

    for ch in chars:
        code = ord(ch)
        if code in existing or code not in src_cmap:
            continue
        name = src_cmap[code]
        new_name = "uni%04X" % code
        if new_name in target["glyf"]:
            continue
        recording = DecomposingRecordingPen(src_glyphs)
        source["glyf"][name].draw(recording, src_glyphs)
        pen = TTGlyphPen(None)
        recording.replay(ScalePen(pen, ratio * scale, dx, dy))
        target["glyf"][new_name] = pen.glyph()
        target["hmtx"][new_name] = (
            int(round(source["hmtx"][name][0] * ratio * scale)),
            0,
        )
        for table in target["cmap"].tables:
            if table.isUnicode():
                table.cmap[code] = new_name
        added.append(ch)

    out = io.BytesIO()
    target.save(out)
    return out.getvalue(), "".join(added)


def _add_composed_glyphs(
    font_bytes: bytes,
    source_path: str,
    compose,
    scale: float = 1.0,
):
    """把多个字符合成为一个 PUA 字形。

    compose 是 [{"code": 57344, "text": "橘爱"}] 这样的列表。
    生成的字形会按字符自然宽度横向排列，advance 等于总宽度。
    """
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.misc.transform import Transform

    target = TTFont(io.BytesIO(font_bytes))
    source = (
        TTFont(source_path, fontNumber=0)
        if source_path.lower().endswith(".ttc")
        else TTFont(source_path)
    )
    upem = target["head"].unitsPerEm
    ratio = upem / source["head"].unitsPerEm
    src_cmap = source.getBestCmap()
    src_glyphs = source.getGlyphSet()
    added = []

    for item in compose or []:
        try:
            code = int(item.get("code", 0))
            text = str(item.get("text", ""))
        except Exception:
            continue
        if not code:
            continue
        new_name = "uni%04X" % code
        if new_name in target["glyf"]:
            continue
        if item.get("blank") or not text:
            # 零宽空字形，用来填充 from 与 PUA 之间的字节差
            target["glyf"][new_name] = TTGlyphPen(None).glyph()
            target["hmtx"][new_name] = (0, 0)
            for table in target["cmap"].tables:
                if table.isUnicode():
                    table.cmap[code] = new_name
            added.append(code)
            continue
        pen = TTGlyphPen(None)
        x = 0.0
        drawn = False
        for ch in text:
            name = src_cmap.get(ord(ch))
            if not name:
                continue
            recording = DecomposingRecordingPen(src_glyphs)
            source["glyf"][name].draw(recording, src_glyphs)
            recording.replay(
                TransformPen(
                    pen,
                    Transform(ratio * scale, 0, 0, ratio * scale, x, 0),
                )
            )
            x += source["hmtx"][name][0] * ratio * scale
            drawn = True
        if not drawn:
            continue
        target["glyf"][new_name] = pen.glyph()
        target["hmtx"][new_name] = (int(round(x)), 0)
        for table in target["cmap"].tables:
            if table.isUnicode():
                table.cmap[code] = new_name
        added.append(code)

    target["maxp"].numGlyphs = len(target.getGlyphOrder())
    out = io.BytesIO()
    target.save(out)
    return out.getvalue(), added


def command_font(args):
    source = os.path.join(args.cache, "bundles", args.bundle)
    download(BUNDLE_BASE + args.bundle, source)

    if not os.path.exists(args.source):
        print(json.dumps({"ok": False, "error": "源字体不存在: " + args.source}))
        return 1

    env = UnityPy.load(source)
    applied = []
    try:
        compose = json.loads(args.compose or "[]")
    except Exception:
        compose = []

    for obj in env.objects:
        if obj.type.name != "Font":
            continue
        data = obj.read()
        raw = bytes(data.m_FontData)
        # 只处理 TrueType 轮廓（glyf）；CFF/OTF 跳过
        if len(raw) < 4 or raw[:4] != b"\x00\x01\x00\x00":
            continue
        try:
            merged, added = _add_glyphs(
                raw,
                args.chars,
                args.source,
                args.scale,
                args.offset_x,
                args.offset_y,
            )
            composed = []
            if compose:
                merged, composed = _add_composed_glyphs(
                    merged, args.source, compose, args.scale
                )
        except Exception as error:  # noqa: BLE001
            log("字体合并失败 %s: %s" % (getattr(data, "m_Name", ""), error))
            continue
        if added or composed:
            data.m_FontData = merged
            data.save()
            applied.append(
                "%s:%s%s"
                % (
                    getattr(data, "m_Name", ""),
                    added,
                    "(compose %d)" % len(composed) if composed else "",
                )
            )

    if not applied:
        print(json.dumps({"ok": True, "changed": False}))
        return 0

    os.makedirs(args.out_dir, exist_ok=True)
    saved = env.save(pack="lz4", out_path=args.out_dir)
    output = os.path.join(args.out_dir, args.bundle)
    if not os.path.exists(output):
        if isinstance(saved, dict) and args.bundle in saved:
            with open(output, "wb") as handle:
                handle.write(saved[args.bundle])
        else:
            env.save(pack="none", out_path=args.out_dir)
    print(
        json.dumps(
            {"ok": True, "changed": True, "fonts": applied, "output": output}
        )
    )
    return 0


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    index = sub.add_parser("index")
    index.add_argument("--cache", required=True)
    index.add_argument("--out", required=True)
    index.set_defaults(func=command_index)

    patch = sub.add_parser("patch")
    patch.add_argument("--cache", required=True)
    patch.add_argument("--bundle", required=True)
    patch.add_argument("--plan", required=True)
    patch.add_argument("--out-dir", required=True)
    patch.set_defaults(func=command_patch)

    font = sub.add_parser("font")
    font.add_argument("--cache", required=True)
    font.add_argument("--bundle", required=True)
    font.add_argument("--chars", required=True)
    font.add_argument("--source", required=True)
    font.add_argument("--scale", type=float, default=1.0)
    font.add_argument("--offset-x", type=float, default=0.0)
    font.add_argument("--offset-y", type=float, default=0.0)
    font.add_argument("--compose", default="[]")
    font.add_argument("--out-dir", required=True)
    font.set_defaults(func=command_font)

    args = parser.parse_args()
    try:
        code = args.func(args)
    except Exception as error:  # noqa: BLE001
        log("错误: %s" % error)
        print(json.dumps({"ok": False, "error": str(error)}))
        code = 1
    sys.exit(code or 0)


if __name__ == "__main__":
    main()

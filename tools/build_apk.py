#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 EPanel 打进 DCloud 5+ 的 Android 外壳，产出一个可以直接安装的 APK。

原理：旧版 APK（H551BFC19）本身就是 DCloud 5+ 的运行外壳，网页资源放在
      assets/apps/H551BFC19/www/ 里。所以只要
        1) 换掉 www 里的网页资源
        2) 把应用名改掉（resources.arsc 全局字符串池里那一条）
        3) 换掉启动图标（res/drawable-*/icon.png）
        4) 重新签名（原 APK 用的是 DCloud 云端证书，私钥拿不到）
      就能得到一个装着我们新面板的 APK，不需要 Android SDK，也不需要 HBuilderX。

用法：
    python tools/build_apk.py                     # 用旧版 APK 作外壳
    python tools/build_apk.py --base <某.apk>      # 换一个外壳
    python tools/build_apk.py --name "E 面板"      # 换应用名

产物：
    build/EPanel-<name>-<date>.apk      可以直接装
    build/www/                          打进 APK 的网页资源（可单独检查）
    build/hbuilder/EPanel/              标准 HBuilderX 工程（想正式云打包时用）
    build/keystore/epanel.keystore      签名证书，务必留好，以后升级要用同一个
"""

import argparse
import json
import os
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent          # EPanel/
BUILD = ROOT / "build"
BASE_APK_DEFAULT = (ROOT.parent / "旧版本" / "转APK" / "Quicker快捷面板" /
                    "unpackage" / "release" / "apk" / "H551BFC19__20260127165747.apk")

ANDROID_TOOLS = pathlib.Path(os.environ.get("ANDROID_TOOLS", "D:/Software/WorkBuddy/android-tools/tools"))
ZIPALIGN = ANDROID_TOOLS / "zipalign.exe"
APKSIGNER = ANDROID_TOOLS / "lib" / "apksigner.jar"

APPID = "H551BFC19"                    # 必须和 assets/data/dcloud_control.xml 里一致
APP_NAME = "E 面板"
OLD_APP_NAME = "Quicker快捷面板"        # 外壳 APK 里当前的名字，用来定位 resources.arsc 里那一条
VERSION_NAME = "3.0.0"                 # 只用于产物文件名（APK 内部版本保持原样，避免和 dcloud_control.xml 打架）

KS_ALIAS = "epanel"
KS_PASS = "epanel2026"                 # 本地开发用证书；换掉的话以后升级要重新卸载安装
KS_FILE = BUILD / "keystore" / "epanel.keystore"

# 打进 APK 的网页资源（相对 EPanel/）
WWW_FILES = ["index.html", "app.css", "app.js"]
WWW_DIRS = ["channels", "modules"]
WWW_SKIP = {"_模板.js"}

ICON_SIZES = {                          # APK 里的 res 目录 → 边长
    "res/drawable-hdpi/icon.png": 72,
    "res/drawable-xhdpi/icon.png": 96,
    "res/drawable-xxhdpi/icon.png": 144,
    "res/drawable-xxxhdpi/icon.png": 192,
}
ICON_SET_1024 = {                       # HBuilderX 工程要的一整套
    20: "20x20.png", 29: "29x29.png", 40: "40x40.png", 58: "58x58.png",
    60: "60x60.png", 72: "72x72.png", 76: "76x76.png", 80: "80x80.png",
    87: "87x87.png", 96: "96x96.png", 120: "120x120.png", 144: "144x144.png",
    152: "152x152.png", 167: "167x167.png", 180: "180x180.png",
    192: "192x192.png", 1024: "1024x1024.png",
}

FONT_CANDIDATES = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf",
                   "C:/Windows/Fonts/arial.ttf"]


# ---------------------------------------------------------------- 图标

def make_icon(size=1024):
    """应用图标：圆角渐变底 + 白色粗体 E + 左上角柔光"""
    from PIL import Image, ImageDraw, ImageFont
    S = size
    top, bot = (96, 143, 238), (48, 82, 168)          # #608FEE → #3052A8

    # 渐变底：小图放大，比逐行画快且平滑
    g = Image.new("RGB", (8, S))
    gd = ImageDraw.Draw(g)
    for y in range(S):
        t = y / max(1, S - 1)
        gd.line([(0, y), (7, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    bg = g.resize((S, S), Image.BILINEAR)

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
    img.paste(bg, (0, 0), mask)

    # 左上柔光（模糊一下，免得椭圆边缘露出硬弧）
    from PIL import ImageFilter
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-int(S * 0.40), -int(S * 0.50), int(S * 0.90), int(S * 0.60)],
                                 fill=(255, 255, 255, 34))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.10))
    img = Image.alpha_composite(img, Image.composite(
        glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

    d = ImageDraw.Draw(img, "RGBA")
    # 内描边，增加一点体积感
    d.rounded_rectangle([int(S * 0.008), int(S * 0.008), S - 1 - int(S * 0.008), S - 1 - int(S * 0.008)],
                        radius=int(S * 0.222), outline=(255, 255, 255, 52), width=max(2, S // 200))

    font = None
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            try:
                font = ImageFont.truetype(f, int(S * 0.46))
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()
    # 视觉居中：E 的几何中心比字框中心略高
    d.text((S / 2, S * 0.505), "E", font=font, fill=(255, 255, 255, 255), anchor="mm")
    return img


def png_bytes(size, image1024):
    import io
    im = image1024 if size == 1024 else image1024.resize((size, size), 1)   # 1 = LANCZOS
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- resources.arsc

def _decode_pool_index(data, base, offs, i, utf8):
    """读字符串池第 i 条，返回 (条目起始偏移, 条目总字节数, 字符串)"""
    p = base + offs[i]
    start = p

    def read_len():
        nonlocal p
        b = data[p]
        p += 1
        if b & 0x80:
            v = ((b & 0x7F) << 8) | data[p]
            p += 1
            return v
        return b

    if utf8:
        n16 = read_len()
        n8 = read_len()
        s = data[p:p + n8].decode("utf-8", "replace")
        p += n8
    else:
        n16 = read_len()
        s = data[p:p + n16 * 2].decode("utf-16-le", "replace")
        p += n16 * 2
    p += 1                                       # 结尾 \0
    return start, p - start, s


def _encode_len(v):
    return bytes([(v >> 8) | 0x80, v & 0xFF]) if v > 0x7F else bytes([v])


def patch_app_name(arsc, old_name, new_name):
    """把全局字符串池里的应用名换掉，字节总长保持不变（不足的部分补 0）。

    只改这一条字符串的内容，池大小/偏移/其它字符串全部不动，所以是安全的最小改动。
    """
    off = 12                                     # RES_TABLE_HEADER(12) 之后是第一个字符串池
    typ, _hs, _cs = struct.unpack_from("<HHI", arsc, off)
    if typ != 0x0001:
        raise RuntimeError("resources.arsc 首个 chunk 不是字符串池，无法安全改写")
    cnt, _styc, flags, str_start, _sty_start = struct.unpack_from("<IIIII", arsc, off + 8)
    utf8 = bool(flags & 0x100)
    base = off + str_start
    offs = [struct.unpack_from("<I", arsc, off + 28 + 4 * i)[0] for i in range(cnt)]

    hits = [i for i in range(cnt) if _decode_pool_index(arsc, base, offs, i, utf8)[2] == old_name]
    if len(hits) != 1:
        raise RuntimeError("字符串池里 %r 的出现次数是 %d，不是 1，不敢改" % (old_name, len(hits)))

    idx = hits[0]
    start, total, _ = _decode_pool_index(arsc, base, offs, idx, utf8)
    raw = new_name.encode("utf-8") if utf8 else new_name.encode("utf-16-le")
    n16 = sum(2 if ord(ch) > 0xFFFF else 1 for ch in new_name)
    entry = _encode_len(n16) + (_encode_len(len(raw)) if utf8 else b"") + raw + b"\x00"
    if len(entry) > total:
        raise RuntimeError("新名字 %r 比原来的长，放不进同一位置" % new_name)

    out = bytearray(arsc)
    out[start:start + total] = entry + b"\x00" * (total - len(entry))
    out = bytes(out)

    # 复核：除了那一条，其它字符串必须一字不差
    offs2 = [struct.unpack_from("<I", out, off + 28 + 4 * i)[0] for i in range(cnt)]
    for i in range(cnt):
        _s, _t, v = _decode_pool_index(out, base, offs2, i, utf8)
        if i == idx:
            if v != new_name:
                raise RuntimeError("改写后复核失败")
        elif v != _decode_pool_index(arsc, base, offs, i, utf8)[2]:
            raise RuntimeError("改动了不该动的字符串（下标 %d）" % i)
    return out


# ---------------------------------------------------------------- 组装 www

def copy_tree(src, dst, skip):
    for p in sorted(src.iterdir()):
        if p.name in skip:
            continue
        if p.is_file():
            shutil.copy2(p, dst / p.name)
        elif p.is_dir():
            (dst / p.name).mkdir(parents=True, exist_ok=True)
            copy_tree(p, dst / p.name, set())


def build_www(base_apk, app_name):
    """把网页资源整理到 build/www，并带上 5+ 需要的 manifest.json / androidPrivacy.json"""
    www = BUILD / "www"
    if www.exists():
        shutil.rmtree(www)
    www.mkdir(parents=True)

    for f in WWW_FILES:
        shutil.copy2(ROOT / f, www / f)
    for d in WWW_DIRS:
        (www / d).mkdir(parents=True, exist_ok=True)
        copy_tree(ROOT / d, www / d, WWW_SKIP)

    # 5+ 的 www/manifest.json：保留原结构，只改名字（版本号不动，免得和 dcloud_control.xml 不一致）
    with zipfile.ZipFile(base_apk) as z:
        old = json.loads(z.read("assets/apps/%s/www/manifest.json" % APPID).decode("utf-8"))
    old["name"] = app_name
    old["description"] = "通用面板工作台"
    (www / "manifest.json").write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
    (www / "androidPrivacy.json").write_text('{\n    "prompt" : "none"\n}\n', encoding="utf-8")

    files = [f for f in www.rglob("*") if f.is_file()]
    total = sum(f.stat().st_size for f in files)
    print("  www 共 %d 个文件，%.1f KB" % (len(files), total / 1024))
    return www


# ---------------------------------------------------------------- 重打包

def repack(base_apk, www, icons, out, old_name):
    drop = {"META-INF/MANIFEST.MF"}
    with zipfile.ZipFile(base_apk) as zin:
        infos = zin.infolist()
        drop |= {i.filename for i in infos
                 if re.match(r"META-INF/.*\.(SF|RSA|DSA|EC)$", i.filename, re.I)}
        old_www = [i.filename for i in infos
                   if i.filename.startswith("assets/apps/%s/www" % APPID)]

        arsc_new = patch_app_name(zin.read("resources.arsc"), old_name, APP_NAME)
        print("   resources.arsc 应用名 %r -> %r" % (old_name, APP_NAME))

        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zo:
            for info in infos:
                n = info.filename
                if n in drop or n in old_www:
                    continue
                if n == "resources.arsc":
                    data = arsc_new
                elif n in icons:
                    data = icons[n]
                else:
                    data = zin.read(n)
                # 保留原压缩方式（resources.arsc 一般是不压缩存储的）
                zo.writestr(info, data, compress_type=info.compress_type)

            for f in sorted(www.rglob("*")):
                if f.is_file():
                    rel = "assets/apps/%s/www/" % APPID + f.relative_to(www).as_posix()
                    zo.writestr(rel, f.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)

    print("  写入 %s（%.1f MB）" % (out.name, out.stat().st_size / 1024 / 1024))


# ---------------------------------------------------------------- 签名

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError("命令失败：%s\n%s\n%s" % (" ".join(map(str, cmd)), r.stdout, r.stderr))
    return (r.stdout or "") + (r.stderr or "")


def ensure_keystore():
    if KS_FILE.exists():
        return
    KS_FILE.parent.mkdir(parents=True, exist_ok=True)
    run(["keytool", "-genkeypair", "-v", "-keystore", str(KS_FILE), "-storetype", "PKCS12",
         "-alias", KS_ALIAS, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10950",
         "-storepass", KS_PASS, "-keypass", KS_PASS,
         "-dname", "CN=EPanel, OU=Evelynal, O=Evelynal, C=CN"])
    print("  生成签名证书 %s" % KS_FILE)


# ---------------------------------------------------------------- HBuilderX 工程

def build_hbuilder(www, icon1024, app_name):
    proj = BUILD / "hbuilder" / "EPanel"
    if proj.exists():
        shutil.rmtree(proj)
    proj.mkdir(parents=True)
    for f in www.iterdir():
        if f.is_file():
            shutil.copy2(f, proj / f.name)
        else:
            shutil.copytree(f, proj / f.name)

    icondir = proj / "unpackage" / "res" / "icons"
    icondir.mkdir(parents=True, exist_ok=True)
    for size, fname in ICON_SET_1024.items():
        (icondir / fname).write_bytes(png_bytes(size, icon1024))
    (proj / "icon.png").write_bytes(png_bytes(192, icon1024))

    manifest = {
        "@platforms": ["android", "iPhone", "iPad"],
        "id": APPID,
        "name": app_name,
        "version": {"name": VERSION_NAME, "code": 300},
        "description": "通用面板工作台",
        "icons": {"72": "icon.png"},
        "launch_path": "index.html",
        "developer": {"name": "Evelynal", "email": "", "url": ""},
        "permissions": {
            "Console": {"description": "跟踪调试输出日志"},
            "Device": {"description": "访问设备信息（含屏幕常亮）"},
            "Events": {"description": "应用扩展事件"},
            "Runtime": {"description": "访问运行期环境（退出应用）"},
            "Storage": {"description": "管理应用本地数据"},
            "Webview": {"description": "窗口管理（软键盘模式等）"},
            "Navigator": {"description": "浏览器信息"},
            "XMLHttpRequest": {"description": "跨域网络访问"},
            "NativeObj": {"description": "原生对象"}
        },
        "plus": {
            "splashscreen": {"autoclose": True, "waiting": True},
            "popGesture": "none",
            "runmode": "normal",
            "distribute": {
                "google": {
                    "packagename": "top.evelynal.epanel",
                    "permissions": [
                        '<uses-permission android:name="android.permission.INTERNET" />'
                    ]
                },
                "orientation": ["portrait-primary", "landscape-primary", "landscape-secondary"]
            }
        },
        "fullscreen": False
    }
    (proj / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=4),
                                        encoding="utf-8")
    print("  HBuilderX 工程 -> %s" % proj)


# ---------------------------------------------------------------- 主流程

def main():
    global APP_NAME, VERSION_NAME
    ap = argparse.ArgumentParser(description="把 EPanel 打包成 Android APK")
    ap.add_argument("--base", default=str(BASE_APK_DEFAULT), help="用作外壳的旧 APK")
    ap.add_argument("--name", default=APP_NAME, help="应用名（桌面图标下显示的名字）")
    ap.add_argument("--old-name", default=OLD_APP_NAME, help="外壳 APK 里当前的应用名")
    ap.add_argument("--version", default=VERSION_NAME, help="只影响产物文件名")
    ap.add_argument("--no-sign", action="store_true", help="只重打包不签名（调试用）")
    args = ap.parse_args()

    APP_NAME = args.name
    VERSION_NAME = args.version

    base = pathlib.Path(args.base)
    if not base.exists():
        print("找不到外壳 APK：%s" % base)
        return 2
    for tool in (ZIPALIGN, APKSIGNER):
        if not tool.exists():
            print("缺少工具：%s" % tool)
            return 2

    BUILD.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")

    print("1) 生成图标")
    icon1024 = make_icon(1024)
    icons = {path: png_bytes(size, icon1024) for path, size in ICON_SIZES.items()}
    for path, size in ICON_SIZES.items():
        print("   %-36s %4dpx  %6d B" % (path, size, len(icons[path])))

    print("2) 整理网页资源")
    www = build_www(base, APP_NAME)

    print("3) 打进 APK 外壳")
    unsigned = BUILD / ("EPanel-%s-unsigned.apk" % VERSION_NAME)
    repack(base, www, icons, unsigned, args.old_name)

    if args.no_sign:
        print("\n完成（未签名）：%s" % unsigned)
        return 0

    print("4) 对齐 + 签名")
    aligned = BUILD / ("EPanel-%s-aligned.apk" % VERSION_NAME)
    final = BUILD / ("EPanel-%s-%s.apk" % (VERSION_NAME, stamp))
    run([str(ZIPALIGN), "-p", "-f", "4", str(unsigned), str(aligned)])
    ensure_keystore()
    run(["java", "--enable-native-access=ALL-UNNAMED", "-jar", str(APKSIGNER), "sign",
         "--ks", str(KS_FILE), "--ks-key-alias", KS_ALIAS,
         "--ks-pass", "pass:" + KS_PASS, "--key-pass", "pass:" + KS_PASS,
         "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--v3-signing-enabled", "true",
         "--out", str(final), str(aligned)])

    print("5) 校验签名")
    out = run(["java", "--enable-native-access=ALL-UNNAMED", "-jar", str(APKSIGNER),
               "verify", "--verbose", "--print-certs", str(final)])
    for line in out.splitlines():
        if re.search(r"Verified using|Number of signers|SHA-256|DN:", line):
            print("   " + line.strip())

    print("6) 生成 HBuilderX 工程（想走官方云打包时用）")
    build_hbuilder(www, icon1024, APP_NAME)

    for tmp in (unsigned, aligned):
        try:
            tmp.unlink()
        except OSError:
            pass

    print("\n=== 打包完成 ===")
    print("APK      : %s" % final)
    print("大小     : %.2f MB" % (final.stat().st_size / 1024 / 1024))
    print("应用名   : %s" % APP_NAME)
    print("签名证书 : %s（密码 %s，别名 %s）" % (KS_FILE, KS_PASS, KS_ALIAS))
    print("\n注意：签名证书和旧版不同，装之前需要先卸载手机上的旧版。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""生成测试用音乐文件：真实 MP3 / FLAC 结构 + 内嵌元数据与歌词。

- MP3：ID3v2.3 标签（TIT2/TPE1/TALB/USLT/APIC）+ 若干静音 MPEG1 Layer3 帧
- MP3（UTF-8 编码歌词，ID3v2.4 用法）：验证编码分支
- MP3（纯文本歌词，非 LRC）：验证整段歌词
- FLAC：fLaC + STREAMINFO + VORBIS_COMMENT(LYRICS) + 无音频帧
- 另有一个非音频文件与一层子目录，验证递归扫描与过滤
"""
import os
import struct
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent / "fixtures" / "music"

LRC_SYNC = """[ti:光盘与光]
[ar:测试歌手]
[al:结构之美]
[00:00.50]第一句：光盘的螺旋轨道
[00:03.00]第二句：凹坑与平面之差
[00:06.50]第三句：激光读出的 0 与 1
[00:10.00]第四句：这就是数字的载体
"""

LRC_PLAIN = """这是一段没有任何时间戳的歌词
第二行用来验证整段歌词的显示
第三行结束
"""


def lrc_long(n=40, step=0.8):
    """长歌词：用来验证自动滚动 / 当前句定位 / 放大动画"""
    out = ["[ti:长歌词]", "[ar:测试歌手]", "[al:结构之美]"]
    for i in range(n):
        t = i * step
        mm = int(t // 60)
        ss = t - mm * 60
        out.append("[%02d:%05.2f]第 %d 句歌词内容用于验证滚动" % (mm, ss, i + 1))
    return "\n".join(out) + "\n"


# ---------------- ID3v2 ----------------

def id3_text_frame(fid, text, enc=3):
    if enc == 1:
        data = b"\xff\xfe" + text.encode("utf-16-le")
        raw = b"\x01" + data
    else:
        raw = b"\x03" + text.encode("utf-8")
    return fid.encode("ascii") + struct.pack(">I", len(raw)) + b"\x00\x00" + raw


def id3_uslt(lyrics, lang=b"chi", desc="", enc=3):
    if enc == 1:
        body = b"\x01" + lang + b"\xff\xfe" + desc.encode("utf-16-le") + b"\x00\x00" \
               + b"\xff\xfe" + lyrics.encode("utf-16-le")
    else:
        body = b"\x03" + lang + desc.encode("utf-8") + b"\x00" + lyrics.encode("utf-8")
    return b"USLT" + struct.pack(">I", len(body)) + b"\x00\x00" + body


def id3_apic(png_bytes, mime="image/png", enc=0):
    body = bytes([enc]) + mime.encode("ascii") + b"\x00" + b"\x03" \
           + b"cover" + b"\x00" + png_bytes
    return b"APIC" + struct.pack(">I", len(body)) + b"\x00\x00" + body


def tiny_png():
    # 1x1 透明 PNG
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def id3_build(frames, version=3):
    body = b"".join(frames) + b"\x00" * 64        # 一点 padding
    size = len(body)
    syncsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3" + bytes([version, 0]) + b"\x00" + syncsafe + body


def mp3_frames(count=1):
    """MPEG1 Layer3, 128kbps, 44.1kHz 的静音帧（单帧 1152 采样 ≈ 26.1ms）"""
    header = b"\xff\xfb\x90\x00"
    frame_len = 417
    return (header + b"\x00" * (frame_len - 4)) * count


MP3_FRAME_COUNT = 130      # ≈ 3.4 秒，够验证进度与歌词同步


def write_mp3(path, title, artist, album, lyrics=None, plain_lyrics=None,
              enc=3, apic=False, with_audio=True, frames=MP3_FRAME_COUNT):
    frames_list = [id3_text_frame("TIT2", title, enc), id3_text_frame("TPE1", artist, enc),
                   id3_text_frame("TALB", album, enc)]
    if lyrics:
        frames_list.append(id3_uslt(lyrics, enc=enc))
    if plain_lyrics:
        frames_list.append(id3_uslt(plain_lyrics, enc=enc))
    if apic:
        frames_list.append(id3_apic(tiny_png()))
    blob = id3_build(frames_list, 3)
    if with_audio:
        blob += mp3_frames(frames)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)


# ---------------- FLAC ----------------

def flac_build(comments, duration_seconds=3):
    sr = 44100
    total = sr * duration_seconds
    # STREAMINFO: min/max block(2+2) min/max frame(3+3) 然后 8 字节打包
    packed = (sr << 44) | (1 << 41) | (15 << 36) | total   # 1ch, 16bit
    streaminfo = struct.pack(">HH", 4096, 4096) + b"\x00" * 3 + b"\x00" * 3 \
        + packed.to_bytes(8, "big")
    blocks = b"\x00" + len(streaminfo).to_bytes(3, "big") + streaminfo

    vendor = b"EPanel test fixture"
    vc = struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", len(comments))
    for c in comments:
        raw = c.encode("utf-8")
        vc += struct.pack("<I", len(raw)) + raw
    blocks += b"\x84" + len(vc).to_bytes(3, "big") + vc      # 0x80|4 = 最后一个块是 VORBIS_COMMENT
    return b"fLaC" + blocks


def main():
    if ROOT.exists():
        import shutil
        shutil.rmtree(ROOT)

    a = ROOT / "专辑甲"
    b = ROOT / "album-b" / "disc 1"

    write_mp3(a / "01 - 光盘与光 - 测试歌手.mp3", "光盘与光", "测试歌手", "结构之美",
              lyrics=LRC_SYNC, enc=3, apic=True)
    write_mp3(a / "02 - 无歌词的歌 - 测试歌手.mp3", "无歌词的歌", "测试歌手", "结构之美")
    write_mp3(a / "03 - 整段歌词 - 另一位.mp3", "整段歌词", "另一位", "结构之美",
              plain_lyrics=LRC_PLAIN, enc=1)

    c = ROOT / "专辑乙"
    write_mp3(c / "05 - 长歌词 - 测试歌手.mp3", "长歌词", "测试歌手", "结构之美",
              lyrics=lrc_long(), enc=3,
              frames=int(40 * 0.8 / 0.02612) + 20)     # ≈ 32 秒，够滚很多屏

    flac = flac_build([
        "TITLE=FLAC 里的歌词",
        "ARTIST=测试歌手",
        "ALBUM=结构之美",
        "LYRICS=" + LRC_SYNC,
    ])
    b.mkdir(parents=True, exist_ok=True)
    (b / "04 - flac 测试.flac").write_bytes(flac)

    (ROOT / "cover.jpg").write_bytes(b"\xff\xd8\xff\xe0not-audio")
    (ROOT / "readme.txt").write_text("这不是音频", encoding="utf-8")

    n = sum(1 for _ in ROOT.rglob("*") if _.is_file())
    print("fixtures 生成于", ROOT)
    print("文件数", n)
    for p in sorted(ROOT.rglob("*")):
        if p.is_file():
            print("  ", p.relative_to(ROOT), p.stat().st_size, "bytes")


if __name__ == "__main__":
    main()

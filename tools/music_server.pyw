# -*- coding: utf-8 -*-
"""双击启动音乐服务（不弹黑窗口）用的入口 —— .pyw 用 pythonw 跑，不会有控制台。

真正干活的还是同目录的 music_server.py。因为没有控制台，**日志会写到同目录的
music_server.log**（用记事本打开就能看），排查问题时先看它。

音乐目录怎么定（按优先级）：
  1. 环境变量 EPANEL_MUSIC_DIR
  2. 同目录下的 music_dir.txt（里面只写一行目录路径）
  3. 没配的话就用这个 tools 目录 —— 那样基本扫不到歌，日志里会提醒你去改

端口：环境变量 EPANEL_MUSIC_PORT，默认 8000。

⚠️ 别同时开两个 —— 端口被占的那个会启动失败，日志里会写清楚是谁占着。
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

sys.argv = ["music_server.py"] + sys.argv[1:]


def resolve_dir():
    d = os.environ.get("EPANEL_MUSIC_DIR", "").strip()
    if d:
        return d
    cfg = os.path.join(HERE, "music_dir.txt")
    if os.path.isfile(cfg):
        try:
            with open(cfg, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        return line
        except Exception:
            pass
    return HERE


def main():
    import music_server
    md = resolve_dir()
    if not any(a in ("--dir", "-d") for a in sys.argv[1:]):
        sys.argv += ["--dir", md]
    if not any(a in ("--port", "-p") for a in sys.argv[1:]):
        sys.argv += ["--port", os.environ.get("EPANEL_MUSIC_PORT", "8000")]
    # 双击启动默认带托盘：没有黑窗口，但右下角有图标可以复制地址 / 打开日志 / 关闭服务
    if "--no-tray" not in sys.argv[1:] and "--tray" not in sys.argv[1:]:
        sys.argv.append("--tray")
    sys.argv = [a for a in sys.argv if a != "--no-tray"]
    music_server.out("")
    music_server.out("  音乐目录用的是：%s" % md)
    if os.path.abspath(md) == os.path.abspath(HERE):
        music_server.out("  ⚠ 这看着不像音乐目录。要改的话：在 %s 里" % HERE)
        music_server.out("     建一个 music_dir.txt，第一行写上你的音乐目录路径。")
    return music_server.main()


if __name__ == "__main__":
    sys.exit(main())

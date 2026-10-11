# -*- coding: utf-8 -*-
"""音乐播放器模块端到端测试

1. 起 tools/music_server.py 提供局域网共享（CORS + Range + /__epanel/list）
2. 面板扫描目录 → 预读标签 → 播放 → 读内嵌歌词 → 同步高亮
3. 再用 --plain 模式起一遍，验证"只有目录 HTML"时也能爬出来
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "D:/Software/WorkBuddy/ms-playwright"

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "music"
PY = sys.executable
URL = (ROOT / "index.html").as_uri()

PORT_HELPER = 8791
PORT_PLAIN = 8792


def wait_port(port, timeout=12):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.4):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def start_server(port, plain=False):
    args = [PY, str(ROOT / "tools" / "music_server.py"),
            "--dir", str(FIXTURES), "--port", str(port), "--quiet"]
    if plain:
        args.append("--plain")
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if not wait_port(port):
        out = p.stdout.read().decode("utf-8", "replace") if p.stdout else ""
        raise RuntimeError("服务未起来\n" + out)
    return p


def add_card_and_reload(pg, base):
    pg.evaluate("""(base) => {
      EP.state.cards.push({
        id: 'c_music', pageId: 'p_main', moduleId: 'musicPlayer', title: '音乐播放器',
        settings: { baseUrl: base, autoNext: true, prefetch: true, showCover: true, lyricOffset: 0 },
        layout: { w: 6, hMode: 'auto', h: 0 }, collapsed: false, order: 9
      });
      EP.store.saveCards();
    }""", base)
    pg.reload()
    pg.wait_for_timeout(700)


def card(pg, expr):
    # 注意：包一层括号，否则多行表达式会被 ASI 变成 return; → undefined
    return pg.evaluate("""(expr) => {
      const c = [...document.querySelectorAll('.card')].find(
        x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
      if (!c) return '__NO_CARD__';
      return (new Function('c', 'return (' + expr + ')'))(c);
    }""", expr)


def wait_items(pg, n, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        cnt = card(pg, "c.querySelectorAll('.mp-item').length")
        if cnt == n:
            return True
        pg.wait_for_timeout(250)
    return False


def main():
    errs = []
    helper = start_server(PORT_HELPER, plain=False)
    plain = None
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            pg = b.new_page(viewport={"width": 1280, "height": 950})
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errs.append("console.error: " + m.text)
                  if m.type == "error" else None)

            pg.goto(URL)
            pg.wait_for_timeout(700)

            print("== 阶段 1：EPanel 音乐服务（/__epanel/list）==")
            add_card_and_reload(pg, "http://127.0.0.1:%d/" % PORT_HELPER)

            ok = wait_items(pg, 5)
            print("列表 5 首:", ok)
            if not ok:
                print("  实际:", card(pg, "c.querySelectorAll('.mp-item').length"),
                      card(pg, "c.querySelector('.mp-view').textContent.slice(0,120)"))
                raise SystemExit(1)

            # 等预读把标题补全
            pg.wait_for_timeout(2500)
            print("曲目:", json.dumps(card(pg, """
              [...c.querySelectorAll('.mp-item')].map(x => x.querySelector('.n').textContent)
            """), ensure_ascii=False))
            print("数量提示:", card(pg, "c.querySelector('.mp-count').textContent"))

            # 播放第一首
            pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelectorAll('.mp-item')[0].click();
            }""")
            pg.wait_for_timeout(1500)
            print("标题:", card(pg, "c.querySelector('.mp-title').textContent"))
            print("副标题:", card(pg, "c.querySelector('.mp-sub').textContent"))
            print("标签:", card(pg, "[...c.querySelectorAll('.mp-tags .badge')].map(x=>x.textContent)"))
            print("封面有图:", card(pg, "/data:image/.test(c.querySelector('.mp-cover').style.backgroundImage)"))

            # 切到歌词
            pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelectorAll('.mp-tabs .chip')[1].click();
            }""")
            pg.wait_for_timeout(400)
            print("歌词行数:", card(pg, "c.querySelectorAll('.mp-ly p').length"))
            print("歌词文本:", json.dumps(card(pg, """
              [...c.querySelectorAll('.mp-ly p')].map(x => x.textContent)
            """), ensure_ascii=False))
            print("当前高亮行:", card(pg, """
              (() => { const i = [...c.querySelectorAll('.mp-ly p')].findIndex(x => x.classList.contains('on'));
                       return i >= 0 ? c.querySelectorAll('.mp-ly p')[i].textContent : '无'; })()
            """))
            print("是否为逐句歌词:", card(pg, "!!c.querySelector('.mp-ly.synced')"))

            # 歌词高亮要跟着播放推进（3.4 秒的测试音频，等 1.5 秒应至少进到第二句）
            before = card(pg, """
              (() => { const i = [...c.querySelectorAll('.mp-ly p')].findIndex(x => x.classList.contains('on'));
                       return i; })()
            """)
            pg.wait_for_timeout(1600)
            after = card(pg, """
              (() => { const i = [...c.querySelectorAll('.mp-ly p')].findIndex(x => x.classList.contains('on'));
                       return i; })()
            """)
            print("高亮行推进:", before, "->", after, "OK" if after > before else "未推进")

            print("== 阶段 1b：歌词版式（居中 / 当前句靠上 / 放大 / 平滑滚动）==")
            click_by_title = """() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelectorAll('.mp-tabs .chip')[0].click();      // 先回到列表页
              const items = [...c.querySelectorAll('.mp-item')];
              const hit = items.find(x => /长歌词/.test(x.querySelector('.n').textContent));
              if (!hit) return false;
              hit.click();
              return true;
            }"""
            print("找到长歌词:", pg.evaluate(click_by_title))
            # 切到歌词页
            pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelectorAll('.mp-tabs .chip')[1].click();
            }""")
            pg.wait_for_timeout(1600)
            # 跳到中段，避开开头 target 被 clamp 到 0 的区间
            pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelectorAll('.mp-ly p')[20].click();
            }""")
            pg.wait_for_timeout(1400)
            # 暂停后再测，避免测量瞬间正好在换句动画中间
            pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              c.querySelector('.mp-play').click();
            }""")
            pg.wait_for_timeout(800)
            layout = card(pg, """
              (() => {
                const body = c.querySelector('.card-body');
                const main = c.querySelector('.mp-main');
                const panel = c.querySelector('.mp-panel');
                const ctrl = c.querySelector('.mp-ctrl');
                const ps = [...c.querySelectorAll('.mp-ly p')];
                const on = ps.findIndex(x => x.classList.contains('on'));
                const node = ps[on];
                const cs = getComputedStyle(ps[0]);
                const onCs = getComputedStyle(node);
                const bcs = getComputedStyle(body);
                const bb = body.getBoundingClientRect();
                const pad = parseFloat(bcs.paddingTop) + parseFloat(bcs.paddingBottom);
                return {
                  行数: ps.length,
                  当前句: on,
                  textAlign: cs.textAlign,
                  面板高度: panel.clientHeight,
                  面板高占比: +((node.offsetTop + node.offsetHeight / 2) - panel.scrollTop) / panel.clientHeight,
                  scrollTop: Math.round(panel.scrollTop),
                  当前句scale: onCs.transform,
                  非当前句opacity: cs.opacity,
                  面板滚动宽: panel.scrollWidth,
                  面板可视宽: panel.clientWidth,
                  overflowX: getComputedStyle(panel).overflowX,
                  横条占位: panel.offsetHeight - panel.clientHeight,
                  主区高: Math.round(main.getBoundingClientRect().height),
                  卡片体高: Math.round(bb.height),
                  卡片内边距: pad,
                  底部剩余: Math.round(bb.bottom - parseFloat(bcs.paddingBottom) - ctrl.getBoundingClientRect().bottom)
                };
              })()
            """)
            print(json.dumps(layout, ensure_ascii=False, indent=2))
            h = layout["面板高度"]
            pos = layout["面板高占比"]
            print("水平居中:", layout["textAlign"] == "center")
            print("当前句在面板中间:", 0.4 <= pos <= 0.6, "(%.0f%% 处)" % (pos * 100))
            print("无横向滚动条:",
                  layout["overflowX"] == "hidden" and layout["横条占位"] <= 3,
                  "(overflow-x=%s, 占位=%dpx)" % (layout["overflowX"], layout["横条占位"]))
            print("主区域填满卡片:",
                  abs(layout["主区高"] - (layout["卡片体高"] - layout["卡片内边距"])) <= 2,
                  "(主区 %d / 可用 %d)" % (layout["主区高"], layout["卡片体高"] - layout["卡片内边距"]))
            print("底部不留空:", abs(layout["底部剩余"]) <= 2, layout["底部剩余"])
            print("已滚动过:", layout["scrollTop"] > 0)
            print("当前句被放大:", "1.1" in layout["当前句scale"] or "1.09" in layout["当前句scale"])
            print("非当前句变淡:", float(layout["非当前句opacity"]) < 1)

            # 平滑滚动：跳到很靠后的一句，采样 scrollTop 看是不是渐变而不是瞬移
            anim = pg.evaluate("""() => new Promise(resolve => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              const panel = c.querySelector('.mp-panel');
              const ps = c.querySelectorAll('.mp-ly p');
              ps[30].click();
              const vals = [], t0 = performance.now();
              (function tick() {
                vals.push(Math.round(panel.scrollTop));
                if (performance.now() - t0 < 1700) requestAnimationFrame(tick);
                else resolve({ samples: vals.length,
                               distinct: new Set(vals).size,
                               first: vals[0], last: vals[vals.length - 1] });
              })();
            })""")
            print("滚动采样:", json.dumps(anim, ensure_ascii=False))
            print("是渐变而非瞬移:", anim["distinct"] > 5)
            # 把卡片滚进视口再截图，否则歌词面板在屏幕外
            def shot(name):
                pg.evaluate("""() => {
                  const c = [...document.querySelectorAll('.card')].find(
                    x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
                  if (c) c.scrollIntoView({ block: 'center' });
                }""")
                pg.wait_for_timeout(250)
                pg.screenshot(path=str(ROOT / "tests" / name))

            shot("_shot_music_long.png")

            print("== 阶段 1c：卡片高度设为固定时，歌词区跟着填满 ==")
            print("持久化的卡片状态:", pg.evaluate("""() => {
              const x = EP.state.cards.find(k => k.moduleId === 'musicPlayer');
              const ls = JSON.parse(localStorage.getItem('ep.cards') || '[]');
              const y = ls.find(k => k.moduleId === 'musicPlayer');
              return { 内存: x && x.settings && x.settings.state ? x.settings.state.tab : null,
                       localStorage: y && y.settings && y.settings.state ? y.settings.state.tab : null };
            }"""))
            pg.evaluate("""() => {
              EP.state.cards.forEach(x => {
                if (x.moduleId === 'musicPlayer') { x.layout.hMode = 'fixed'; x.layout.h = 560; }
              });
              EP.store.saveCards();
            }""")
            pg.reload()
            pg.wait_for_timeout(2600)
            fixed = card(pg, """
              (() => {
                const body = c.querySelector('.card-body');
                const main = c.querySelector('.mp-main');
                const panel = c.querySelector('.mp-panel');
                const bcs = getComputedStyle(body);
                const bb = body.getBoundingClientRect();
                const pad = parseFloat(bcs.paddingTop) + parseFloat(bcs.paddingBottom);
                return {
                  卡片高: Math.round(c.getBoundingClientRect().height),
                  主区高: Math.round(main.getBoundingClientRect().height),
                  可用高: Math.round(bb.height - pad),
                  面板高度: panel.clientHeight,
                  当前标签: (c.querySelector('.mp-tabs .chip.active') || {}).textContent,
                  面板内容: (c.querySelector('.mp-view').firstChild || {}).className,
                  面板滚动宽: panel.scrollWidth,
                  面板可视宽: panel.clientWidth,
                  overflowX: getComputedStyle(panel).overflowX,
                  横条占位: panel.offsetHeight - panel.clientHeight
                };
              })()
            """)
            print(json.dumps(fixed, ensure_ascii=False))
            print("歌词区填满卡片:", abs(fixed["主区高"] - fixed["可用高"]) <= 2,
                  "(主区 %d / 可用 %d)" % (fixed["主区高"], fixed["可用高"]))
            print("比自适应模式更高:", fixed["面板高度"] > layout["面板高度"],
                  "(%d > %d)" % (fixed["面板高度"], layout["面板高度"]))
            print("无横向滚动条:",
                  fixed["overflowX"] == "hidden" and fixed["横条占位"] <= 3,
                  "(overflow-x=%s, 占位=%dpx)" % (fixed["overflowX"], fixed["横条占位"]))
            print("重新挂载后仍停在歌词页:", str(fixed["面板内容"]).startswith("mp-ly"),
                  fixed["面板内容"])
            shot("_shot_music_fixed.png")

            print("== 阶段 1d：歌词字号滑块（卡片设置）==")
            size0 = card(pg, """(() => {
              const ly = c.querySelector('.mp-ly');
              return ly ? getComputedStyle(ly).fontSize : null;
            })()""")
            print("  默认歌词字号:", size0, "（比改之前的 14px 大:", size0 == "16px", "）")

            def open_card_settings(title_re):
                # 卡片右上角的「尺寸与更多」按钮只在编辑模式下才有
                if not pg.evaluate("() => EP.ui.edit"):
                    pg.click("#btnEdit")
                    pg.wait_for_timeout(400)
                pg.evaluate("""(re) => {
                  const c = [...document.querySelectorAll('.card')].find(
                    x => new RegExp(re).test((x.querySelector('.card-title')||{}).textContent||''));
                  const btns = [...c.querySelector('.card-actions').querySelectorAll('button')];
                  btns[btns.length - 1].click();
                }""", title_re)
                pg.wait_for_timeout(300)
                pg.evaluate("""() => {
                  const t = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '卡片设置');
                  if (t) t.click();
                }""")
                pg.wait_for_timeout(350)

            def set_slider(value):
                return pg.evaluate("""(v) => {
                  const d = document.querySelector('.dialog');
                  if (!d) return null;
                  const r = d.querySelector('input[type="range"]');
                  if (!r) return null;
                  r.value = String(v);
                  r.dispatchEvent(new Event('input', { bubbles: true }));
                  return { min: r.min, max: r.max, val: r.value,
                           label: (r.closest('.field').querySelector('label')||{}).textContent };
                }""", value)

            def click_dialog(label):
                pg.evaluate("""(lb) => {
                  const d = document.querySelector('.dialog');
                  const t = [...d.querySelectorAll('.dialog-ft button')].find(b => b.textContent.trim() === lb);
                  if (t) t.click();
                }""", label)
                pg.wait_for_timeout(450)

            open_card_settings("音乐播放器")
            info = set_slider(24)
            print("  滑块:", json.dumps(info, ensure_ascii=False))
            pg.wait_for_timeout(300)
            live = card(pg, """(() => {
              const ly = c.querySelector('.mp-ly');
              return ly ? getComputedStyle(ly).fontSize : null;
            })()""")
            print("  拖动实时预览:", live, "OK" if live == "24px" else "没生效")
            click_dialog("取消")
            back = card(pg, """(() => {
              const ly = c.querySelector('.mp-ly');
              return ly ? getComputedStyle(ly).fontSize : null;
            })()""")
            print("  取消后还原:", back, "OK" if back == "16px" else "没还原")

            open_card_settings("音乐播放器")
            set_slider(26)
            pg.wait_for_timeout(250)
            click_dialog("保存")
            saved = card(pg, """(() => {
              const x = EP.state.cards.find(k => k.moduleId === 'musicPlayer');
              const ly = c.querySelector('.mp-ly');
              const ps = [...c.querySelectorAll('.mp-ly p')];
              const on = ps.findIndex(p => p.classList.contains('on'));
              const panel = c.querySelector('.mp-panel');
              return { 设置值: x.settings.lyricSize,
                       实际字号: ly ? getComputedStyle(ly).fontSize : null,
                       高亮行: on,
                       面板scrollTop: Math.round(panel.scrollTop),
                       面板高: panel.clientHeight,
                       行高: ps.length ? Math.round(ps[0].getBoundingClientRect().height) : 0 };
            })()""")
            print("  保存后:", json.dumps(saved, ensure_ascii=False))
            print("  重新挂载后高亮行还在:", saved["高亮行"] >= 0)
            print("  字号变大后行高跟着变高:", saved["行高"] > 24)
            shot("_shot_music_font.png")

            print("== 阶段 1e：内核泛化后，按钮网格的尺寸滑块仍要实时预览 ==")
            open_card_settings("快捷按钮")
            set_slider(120)
            pg.wait_for_timeout(250)
            mid = pg.evaluate("""() => {
              const x = EP.state.cards.find(k => k.moduleId === 'buttonGrid');
              return x.settings.size;
            }""")
            print("  拖动中 card.settings.size:", mid, "OK" if mid == 120 else "没生效")
            click_dialog("取消")
            after = pg.evaluate("""() => {
              const x = EP.state.cards.find(k => k.moduleId === 'buttonGrid');
              return x.settings.size;
            }""")
            print("  取消后 size 被清掉:", after in (None, 0, False), after)

            # 音频状态 + 进度
            audio = pg.evaluate("""() => {
              const c = [...document.querySelectorAll('.card')].find(
                x => /音乐播放器/.test((x.querySelector('.card-title')||{}).textContent||''));
              return { t1: c.querySelector('.mp-t1').textContent, t2: c.querySelector('.mp-t2').textContent,
                       seek: c.querySelector('.mp-seek').value };
            }""")
            print("进度显示:", json.dumps(audio, ensure_ascii=False))
            pg.screenshot(path=str(ROOT / "tests" / "_shot_music_lyrics.png"))

            print("== 阶段 2：FLAC / 编码分支直接验证 ==")
            meta = pg.evaluate("""() => {
              const base = 'http://127.0.0.1:%d/';
              const list = [
                ['mp3-uslt-utf8', base + encodeURIComponent('专辑甲/01 - 光盘与光 - 测试歌手.mp3')],
                ['mp3-no-lyrics', base + encodeURIComponent('专辑甲/02 - 无歌词的歌 - 测试歌手.mp3')],
                ['mp3-uslt-utf16', base + encodeURIComponent('专辑甲/03 - 整段歌词 - 另一位.mp3')],
                ['flac-vorbis', base + encodeURIComponent('album-b/disc 1/04 - flac 测试.flac')]
              ];
              return Promise.all(list.map(function (item) {
                return EP.musicMeta.read(item[1], { lyrics: true })
                  .then(function (t) {
                    return { id: item[0], container: t.container, title: t.title, artist: t.artist,
                             album: t.album, src: t.lyricsSource,
                             synced: t.lrc ? t.lrc.synced : null,
                             lines: t.lrc ? t.lrc.lines.length : 0,
                             first: t.lrc && t.lrc.lines[0] ? t.lrc.lines[0].text : '',
                             cover: t.cover ? t.cover.mime : null, err: null };
                  })
                  .catch(function (e) { return { id: item[0], err: e.message }; });
              }));
            }""" % PORT_HELPER)
            for m in meta:
                print("  ", json.dumps(m, ensure_ascii=False))

            print("== 阶段 3：只给目录 HTML（--plain）==")
            plain = start_server(PORT_PLAIN, plain=True)
            pg.reload()
            pg.wait_for_timeout(600)
            pg.evaluate("""() => {
              EP.state.cards.forEach(x => { if (x.moduleId === 'musicPlayer') x.settings.baseUrl = 'http://127.0.0.1:%d/'; });
              EP.store.saveCards();
            }""" % PORT_PLAIN)
            pg.reload()
            pg.wait_for_timeout(800)
            ok2 = wait_items(pg, 5, timeout=20)
            print("目录解析出 5 首:", ok2)
            print("来源提示:", card(pg, "c.querySelector('.mp-count').textContent"))
            print("曲名:", json.dumps(card(pg, """
              [...c.querySelectorAll('.mp-item')].map(x => x.querySelector('.n').textContent)
            """), ensure_ascii=False))

            print("== 阶段 4：地址不通时的失败路径 ==")
            pg.evaluate("""() => {
              EP.state.cards.forEach(x => { if (x.moduleId === 'musicPlayer') x.settings.baseUrl = 'http://127.0.0.1:8799/'; });
              EP.store.saveCards();
            }""")
            pg.reload()
            pg.wait_for_timeout(3500)
            print("设置区可见:", card(pg, "!c.querySelector('.mp-setup').hidden"))
            print("播放区隐藏:", card(pg, "c.querySelector('.mp-main').style.display === 'none'"))
            print("错误提示:", card(pg, "c.querySelector('.mp-setup-msg').textContent"))
            print("地址已回填:", card(pg, "c.querySelector('.mp-url').value"))
            pg.screenshot(path=str(ROOT / "tests" / "_shot_music_error.png"))

            pg.screenshot(path=str(ROOT / "tests" / "_shot_music.png"))
            # --plain 下探测 /__epanel/list 会 404；阶段 4 故意指向死端口会 ERR_CONNECTION_REFUSED
            noise = ("404 (Not Found)", "ERR_CONNECTION_REFUSED")
            real = [e for e in errs if not any(n in e for n in noise)]
            print("ERRORS:", real)
            if len(real) != len(errs):
                print("(已忽略 %d 条预期内的网络噪音)" % (len(errs) - len(real)))
            b.close()
    finally:
        for s in (helper, plain):
            if s:
                s.terminate()
                try:
                    s.wait(timeout=5)
                except Exception:
                    s.kill()


if __name__ == "__main__":
    main()

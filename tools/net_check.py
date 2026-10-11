#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EPanel 局域网连通性自检 —— 手机连不上电脑上的服务时跑这个。

它会回答三个问题：
  1. 手机上到底该填哪个地址？（电脑常有好几张网卡，虚拟网卡/VPN 的地址手机永远连不上）
  2. Windows 防火墙有没有挡着？
  3. 本机上服务是不是真的在监听？

用法：
    python tools/net_check.py                 # 默认查 8000 端口
    python tools/net_check.py --port 8791
"""

import argparse
import csv
import io
import ipaddress
import os
import re
import socket
import subprocess
import sys

# 网卡名里出现这些词，基本可以断定手机连不上（虚拟网卡 / VPN / 隧道）
VIRTUAL_HINTS = (
    "vmware", "virtualbox", "vethernet", "hyper-v", "wsl", "docker", "loopback",
    "tap-", "tun", "clash", "wireguard", "tailscale", "zerotier", "openvpn",
    "parallels", "npcap", "bluetooth", "vpn", "teredo", "isatap", "6to4",
)
# 名字里出现这些，更像是真的物理网卡
PHYSICAL_HINTS = ("以太网", "ethernet", "wlan", "wi-fi", "wifi", "无线", "本地连接")


def ps(cmd, timeout=25):
    """跑一段 PowerShell，返回 stdout（失败返回空串）。

    中文 Windows 上 PowerShell 默认按 GBK 输出，直接 utf-8 解码会炸，
    所以这里先要求它输出 UTF-8，再逐种编码兜底。
    """
    if os.name != "nt":
        return ""
    full = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + cmd
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", full],
                           capture_output=True, timeout=timeout,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        return ""
    raw = r.stdout or b""
    if isinstance(raw, str):
        return raw
    for enc in ("utf-8", "mbcs", "cp936", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def csv_rows(text):
    if not text.strip():
        return []
    try:
        return list(csv.DictReader(io.StringIO(text)))
    except Exception:
        return []


def list_adapters():
    """[(ip, 网卡名, 网卡描述)]，拿不到名字就留空"""
    out, seen = [], set()
    rows = csv_rows(ps(
        "Get-NetIPAddress -AddressFamily IPv4 | "
        "Select-Object IPAddress,InterfaceAlias,PrefixOrigin | ConvertTo-Csv -NoTypeInformation"))
    for r in rows:
        ip = (r.get("IPAddress") or "").strip()
        name = (r.get("InterfaceAlias") or "").strip()
        if ip and ip not in seen:
            seen.add(ip)
            out.append((ip, name, ""))
    if not out:                       # 兜底：拿不到 PowerShell 就用 hostname 解析
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if ip not in seen:
                    seen.add(ip)
                    out.append((ip, "", ""))
        except Exception:
            pass
    return out


def classify(ip, name):
    """返回 (类别, 建议, 原因)。建议: 'ok' 推荐用 / 'maybe' 也许 / 'no' 别用"""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "未知", "no", "地址格式不认识"
    low = (name or "").lower()
    if addr.is_loopback:
        return "回环", "no", "只有本机能用"
    if addr.is_link_local:            # 169.254.x.x
        return "自动私有地址", "no", "没拿到路由器分配的 IP，网络没连好"
    if any(h in low for h in VIRTUAL_HINTS):
        return "虚拟网卡 / VPN", "no", "网卡名像虚拟网卡或代理隧道，手机连不上"
    if str(addr).startswith("198.18.") or str(addr).startswith("198.19."):
        return "代理假 IP", "no", "198.18/19 是 Clash 之类代理工具用的假地址，手机永远连不上"
    if str(addr).startswith("100.") and 64 <= int(str(addr).split(".")[1]) <= 127:
        return "运营商级 NAT", "maybe", "Tailscale / 运营商 NAT 段，手机多半连不上"
    if addr.is_private:
        if any(h in low for h in PHYSICAL_HINTS) or not low:
            return "局域网", "ok", ""
        return "私网地址", "maybe", "不确定是不是虚拟网卡"
    return "公网地址", "maybe", "不像局域网地址"


def firewall_report(port):
    lines = []
    rows = csv_rows(ps("Get-NetConnectionProfile | "
                       "Select-Object Name,InterfaceAlias,NetworkCategory | "
                       "ConvertTo-Csv -NoTypeInformation"))
    cats = []
    for r in rows:
        alias = (r.get("InterfaceAlias") or "").strip()
        cat = (r.get("NetworkCategory") or "").strip()
        if cat:
            cats.append((alias, cat))
            lines.append("  当前网络「%s」被 Windows 认成：%s" % (alias, cat))
    prof = csv_rows(ps("Get-NetFirewallProfile | "
                       "Select-Object Name,Enabled,DefaultInboundAction | "
                       "ConvertTo-Csv -NoTypeInformation"))
    for r in prof:
        act = (r.get("DefaultInboundAction") or "").strip()
        lines.append("  防火墙 %s 配置：启用=%s 默认入站=%s%s" % (
            (r.get("Name") or "").strip(), (r.get("Enabled") or "").strip(), act,
            "（NotConfigured 实际等同于 Block）" if act == "NotConfigured" else ""))

    rules = csv_rows(ps(
        "Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow | "
        "Where-Object { $_.DisplayName -like '*python*' -or $_.DisplayName -like '*EPanel*' } | "
        "ForEach-Object { $p = ($_ | Get-NetFirewallApplicationFilter).Program; "
        "[pscustomobject]@{ Name = $_.DisplayName; Profile = $_.Profile; Program = $p } } | "
        "ConvertTo-Csv -NoTypeInformation"))
    programs = set()
    for r in rules:
        prog = (r.get("Program") or "").strip()
        programs.add(prog)
        lines.append("  放行规则：%s（%s）→ %s" % ((r.get("DisplayName") or "").strip(),
                                                (r.get("Profile") or "").strip(),
                                                prog or "任意程序"))
    cur = sys.executable
    if programs and cur and not any(p.lower() == cur.lower() for p in programs if p):
        lines.append("  ⚠ 没有找到当前这个 python 的放行规则（现在跑的是 %s）" % cur)
        lines.append("    —— 防火墙的放行是按「可执行文件路径」算的，换了个 python 就等于没放行")

    blocked_profiles = any(
        (r.get("Name") or "").strip() in ("Public", "Private")
        and (r.get("DefaultInboundAction") or "").strip() in ("Block", "NotConfigured")
        for r in prof)
    public_on = any(cat == "Public" for _, cat in cats)
    verdict = None
    if rules:
        verdict = "有放行规则了。还是连不上就按下面 2~4 步查"
    elif public_on and blocked_profiles:
        verdict = "很可能被挡了：当前网络被认成「公用」，公网配置默认拒绝入站，而且没找到放行规则"
    elif blocked_profiles:
        verdict = "没找到放行规则，默认入站是拒绝的 —— 先按下面第 1 步放行端口试试"
    return lines, verdict, (cats[0][0] if cats else "")


def adapter_status():
    """{网卡名: (状态, 速率, 介质状态)} —— 光有 IP 不代表网卡真的连着"""
    out = {}
    rows = csv_rows(ps("Get-NetAdapter | "
                       "Select-Object Name,Status,LinkSpeed,MediaConnectionState | "
                       "ConvertTo-Csv -NoTypeInformation"))
    for r in rows:
        name = (r.get("Name") or "").strip()
        if name:
            out[name] = ((r.get("Status") or "").strip(),
                         (r.get("LinkSpeed") or "").strip(),
                         (r.get("MediaConnectionState") or "").strip())
    return out


def gateway_of(ip):
    """拿到某个 IPv4 地址所在网卡的默认网关"""
    rows = csv_rows(ps("Get-NetIPConfiguration | "
                       "Select-Object InterfaceAlias,IPv4Address,IPv4DefaultGateway | "
                       "ConvertTo-Csv -NoTypeInformation"))
    for r in rows:
        addrs = r.get("IPv4Address") or ""
        if ip in addrs:
            gw = r.get("IPv4DefaultGateway") or ""
            m = re.search(r"(\d+\.\d+\.\d+\.\d+)", gw)
            return m.group(1) if m else ""
    return ""


def ping(host, timeout_ms=1200):
    if not host:
        return None
    try:
        r = subprocess.run(["ping", "-n", "1", "-w", str(timeout_ms), host],
                           capture_output=True, timeout=6,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        raw = r.stdout or b""
        txt = raw.decode("mbcs", "replace") if isinstance(raw, bytes) else raw
        if "TTL=" in txt.upper() or "ttl=" in txt:
            return True
        if re.search(r"(无法访问|超时|timed out|unreachable|100% loss|丢失 = 100)", txt):
            return False
        return None
    except Exception:
        return None
def local_listen(port):
    """本机上服务是不是真的在监听（顺便看看监听在哪个地址）"""
    hits = []
    txt = ps("Get-NetTCPConnection -State Listen -LocalPort %d -ErrorAction SilentlyContinue | "
             "Select-Object LocalAddress,OwningProcess | ConvertTo-Csv -NoTypeInformation" % port)
    for r in csv_rows(txt):
        hits.append(((r.get("LocalAddress") or "").strip(), (r.get("OwningProcess") or "").strip()))
    if not hits:
        try:
            s = socket.socket()
            s.settimeout(0.5)
            s.connect(("127.0.0.1", port))
            s.close()
            hits.append(("127.0.0.1", "?"))
        except Exception:
            pass
    return hits


def main():
    ap = argparse.ArgumentParser(description="EPanel 局域网连通性自检")
    ap.add_argument("--port", "-p", type=int, default=8000, help="服务端口，默认 8000")
    args = ap.parse_args()
    port = args.port

    print("")
    print("  EPanel 连通性自检（端口 %d）" % port)
    print("  " + "=" * 52)

    print("\n【1】本机监听情况")
    hits = local_listen(port)
    if not hits:
        print("  ✗ 端口 %d 上没有服务在监听 —— 先把 music_server.py 跑起来" % port)
    else:
        for addr, pid in hits:
            flag = "（所有网卡，正确）" if addr in ("0.0.0.0", "::") else "（只绑了这一个地址）"
            print("  ✓ %s:%d  进程 %s %s" % (addr, port, pid, flag))
        if all(a not in ("0.0.0.0", "::") for a, _ in hits):
            print("    ⚠ 服务只绑定了本机地址，手机连不上。启动时不要加 --host 127.0.0.1")

    print("\n【2】手机上该填哪个地址")
    st = adapter_status()
    best, best_gw_ok = None, None
    for ip, name, _ in list_adapters():
        kind, advice, why = classify(ip, name)
        mark = {"ok": "✓ 推荐", "maybe": "△ 也许", "no": "✗ 别用"}[advice]
        label = ("%s" % name) if name else "(无网卡名)"
        print("  %-8s http://%s:%d/   %s" % (mark, ip, port, label))
        if why:
            print("           └ %s：%s" % (kind, why))
        if advice == "ok":
            a = st.get(name)
            if a:
                warn = "" if a[0].lower() == "up" else "   ← 网卡没连着，这个地址肯定是死的"
                print("           网卡状态：%s / %s / %s%s" % (a[0], a[1], a[2], warn))
                if a[0].lower() != "up":
                    continue
            gw = gateway_of(ip)
            if gw:
                ok = ping(gw)
                txt = ("能 ping 通" if ok else
                       ("ping 不通 —— 这段网络可能已经断了（网线松了 / 路由器重启中）"
                        if ok is False else "测不出来"))
                print("           网关 %s：%s" % (gw, txt))
                if best is None:
                    best_gw_ok = ok
            print("           手机 IP 前三位要是 %s.x 才能用这个" % ".".join(ip.split(".")[:3]))
            if best is None:
                best = ip
    if best:
        print("\n  手机浏览器先试这个：")
        print("    http://%s:%d/__epanel/ping" % (best, port))
        print("  能看到 {\"ok\": true, ...} 就说明网络通了（内容不重要，能打开就行）")
        print("  面板里填：http://%s:%d/" % (best, port))
        print("  ⭐ 不知道填哪个：看手机「设置 → WLAN → 当前网络详情 → IP 地址」，")
        print("     手机 IP 前三位和哪个地址一样就填哪个。都对不上 = 不在同一个网络。")
    else:
        print("\n  ✗ 没找到像样的局域网地址。检查电脑是不是没连上 WiFi / 网线。")

    print("\n【3】Windows 防火墙")
    lines, verdict, alias = firewall_report(port)
    for l in lines:
        print(l)
    if verdict:
        print("  → %s" % verdict)
    print("")
    print("  还连不上就按这个顺序做（命令要用【管理员】PowerShell 跑）：")
    print("    1) 放行端口：")
    print('       netsh advfirewall firewall add rule name="EPanel 音乐服务 %d" '
          'dir=in action=allow protocol=TCP localport=%d' % (port, port))
    if alias:
        print("    2) 把这个网络改成「专用」（家用网络才这么干）：")
        print('       Set-NetConnectionProfile -InterfaceAlias "%s" -NetworkCategory Private' % alias)
    print("    3) 路由器后台关掉「AP 隔离 / 客户端隔离」（开了的话同一 WiFi 的设备互相也看不到）")
    print("    4) 如果电脑上开着 Clash / 其它 VPN 的 TUN 模式，先退出它再试一次")
    print("       —— TUN 模式会抢走局域网流量，是这类问题的高发原因")
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())

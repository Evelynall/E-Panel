/* EPanel 辅助库：音频元数据与内嵌歌词解析
 * ------------------------------------------------------------
 * 这不是卡片模块（不调用 EP.modules.register），只挂 window.EP.musicMeta。
 * 供 modules/musicPlayer.js 使用，也可以被其它模块复用。
 *
 * 支持：
 *   MP3  —— ID3v2.2 / 2.3 / 2.4：TIT2/TPE1/TALB/TRCK、USLT(ULT) 歌词、
 *           SYLT(SLT) 同步歌词、TXXX(描述含 lyric) 歌词、APIC(PIC) 封面
 *   FLAC —— VORBIS_COMMENT（TITLE/ARTIST/ALBUM/LYRICS…）、PICTURE 封面、STREAMINFO 时长
 * 其它格式（m4a / ogg / wav…）返回空标签，但依然可以播放。
 *
 * 关键设计：歌词只读文件头部（默认 1.5MB），而不是整首歌。
 *   - 用 Range 请求（Range 属于 CORS 安全请求头，不会触发预检）
 *   - 如果 ID3 标签比预读窗口还大，且服务器支持 Range(206)，再按精确长度补一次
 *   - 服务器不支持 Range 时（返回 200 全量），直接拿到的就是整个文件，同样能解析
 */
(function () {
  'use strict';
  var EP = window.EP = window.EP || {};

  var AUDIO_EXT = {
    mp3: 1, mp2: 1, mp1: 1, flac: 1, m4a: 1, mp4: 1, aac: 1,
    ogg: 1, oga: 1, opus: 1, wav: 1, webm: 1, mka: 1
  };

  /* ================= 基础工具 ================= */

  function extOf(name) {
    var m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function isAudio(name) { return !!AUDIO_EXT[extOf(name)]; }
  function canReadTags(name) {
    var e = extOf(name);
    return e === 'mp3' || e === 'mp2' || e === 'flac';
  }

  function be32(u8, o) { return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; }
  function le32(u8, o) { return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0; }

  function latin1(u8, s, e) {
    var out = '';
    for (var i = s; i < e && i < u8.length; i++) out += String.fromCharCode(u8[i]);
    return out;
  }

  function utf16(u8, s, e, big) {
    var out = '';
    if (e > u8.length) e = u8.length;
    for (var i = s; i + 1 < e; i += 2) {
      out += String.fromCharCode(big ? ((u8[i] << 8) | u8[i + 1]) : (u8[i] | (u8[i + 1] << 8)));
    }
    return out;
  }

  function utf8(u8, s, e) {
    if (e > u8.length) e = u8.length;
    if (typeof window.TextDecoder === 'function') {
      try { return new window.TextDecoder('utf-8').decode(u8.subarray(s, e)); } catch (err) { /* 落到手写解码 */ }
    }
    var out = '', i = s;
    while (i < e) {
      var c = u8[i++];
      if (c < 0x80) { out += String.fromCharCode(c); }
      else if (c < 0xC0) { /* 非法首字节，跳过 */ }
      else if (c < 0xE0) { out += String.fromCharCode(((c & 0x1F) << 6) | (u8[i++] & 0x3F)); }
      else if (c < 0xF0) { out += String.fromCharCode(((c & 0x0F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F)); }
      else {
        var cp = ((c & 0x07) << 18) | ((u8[i++] & 0x3F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return out;
  }

  // ID3 文本编码字节：0=ISO-8859-1 1=UTF-16(含BOM) 2=UTF-16BE 3=UTF-8
  function decode(u8, s, e, enc) {
    if (enc === 0) return latin1(u8, s, e);
    if (enc === 1) {
      if (e - s >= 2) {
        if (u8[s] === 0xFF && u8[s + 1] === 0xFE) return utf16(u8, s + 2, e, false);
        if (u8[s] === 0xFE && u8[s + 1] === 0xFF) return utf16(u8, s + 2, e, true);
      }
      return utf16(u8, s, e, false);
    }
    if (enc === 2) return utf16(u8, s, e, true);
    return utf8(u8, s, e);
  }

  // 找到以 \0 结尾的字符串的结束位置
  function nulEnd(u8, s, e, enc) {
    var wide = (enc === 1 || enc === 2), i = s;
    if (e > u8.length) e = u8.length;
    if (wide) {
      if (enc === 1 && i + 1 < e) {
        if ((u8[i] === 0xFF && u8[i + 1] === 0xFE) || (u8[i] === 0xFE && u8[i + 1] === 0xFF)) i += 2;
      }
      while (i + 1 < e && !(u8[i] === 0 && u8[i + 1] === 0)) i += 2;
      return i;
    }
    while (i < e && u8[i] !== 0) i++;
    return i;
  }

  function strEnd(u8, e, enc) { return e + ((enc === 1 || enc === 2) ? 2 : 1); }

  // 去除 ID3 的"非同步"（0xFF 0x00 → 0xFF）
  function deunsync(u8) {
    var out = new Uint8Array(u8.length), n = 0;
    for (var i = 0; i < u8.length; i++) {
      out[n++] = u8[i];
      if (u8[i] === 0xFF && u8[i + 1] === 0x00) i++;
    }
    return out.subarray(0, n);
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\u0000+$/, '').trim();
  }

  function toBase64(u8) {
    var CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '', i = 0, n = u8.length;
    for (; i + 2 < n; i += 3) {
      var v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += CH[(v >> 18) & 63] + CH[(v >> 12) & 63] + CH[(v >> 6) & 63] + CH[v & 63];
    }
    var rem = n - i;
    if (rem === 1) { var a = u8[i] << 16; out += CH[(a >> 18) & 63] + CH[(a >> 12) & 63] + '=='; }
    else if (rem === 2) { var b = (u8[i] << 16) | (u8[i + 1] << 8); out += CH[(b >> 18) & 63] + CH[(b >> 12) & 63] + CH[(b >> 6) & 63] + '='; }
    return out;
  }

  /* ================= 网络（Range 预读） ================= */

  function readRange(url, start, end, opt) {
    opt = opt || {};
    return new window.Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      try { xhr.open('GET', url, true); } catch (e) { reject(e); return; }
      try { xhr.responseType = 'arraybuffer'; } catch (e2) { /* 极老内核忽略 */ }
      xhr.timeout = opt.timeout || 15000;
      // Range 是 CORS 安全请求头（简单区间写法），不会触发预检
      try { xhr.setRequestHeader('Range', 'bytes=' + start + '-' + end); } catch (e3) { /* ignore */ }
      xhr.onload = function () {
        resolve({
          status: xhr.status,
          buf: xhr.response || null,
          contentType: (xhr.getResponseHeader && xhr.getResponseHeader('Content-Type')) || '',
          contentRange: (xhr.getResponseHeader && xhr.getResponseHeader('Content-Range')) || ''
        });
      };
      xhr.onerror = function () { reject(new Error('网络异常，或被跨域(CORS)策略拒绝')); };
      xhr.ontimeout = function () { reject(new Error('请求超时')); };
      try { xhr.send(null); } catch (e4) { reject(e4); }
    });
  }

  function probeRange(url, opt) {
    return readRange(url, 0, 0, opt).then(function (r) { return r.status === 206; })
      ['catch'](function () { return false; });
  }

  /* ================= ID3v2（MP3） ================= */

  function parseId3(u8, final) {
    var out = { container: 'id3' };
    if (u8.length < 10) return out;
    if (!(u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33)) return out;   // 'ID3'
    var ver = u8[3];
    if (ver < 2 || ver > 4) return out;
    var flags = u8[5];
    var size = ((u8[6] & 0x7F) << 21) | ((u8[7] & 0x7F) << 14) | ((u8[8] & 0x7F) << 7) | (u8[9] & 0x7F);
    var total = 10 + size;
    if (total > u8.length && !final) { out.__needMore = total; return out; }

    var body = u8.subarray(10, Math.min(total, u8.length));
    if (flags & 0x80) body = deunsync(body);

    var idLen = (ver === 2) ? 3 : 4;
    var hdrLen = idLen + (ver === 2 ? 3 : 4) + (ver === 2 ? 0 : 2);
    var frames = {};
    var p = 0;

    while (p + hdrLen <= body.length) {
      if (body[p] === 0) break;                       // 进入 padding
      var id = latin1(body, p, p + idLen);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      var fsz;
      if (ver === 2) {
        fsz = (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5];
      } else if (ver === 4) {
        fsz = ((body[p + 4] & 0x7F) << 21) | ((body[p + 5] & 0x7F) << 14) | ((body[p + 6] & 0x7F) << 7) | (body[p + 7] & 0x7F);
      } else {
        fsz = be32(body, p + 4);
      }
      if (!fsz) break;
      var fflags = (ver === 2) ? 0 : ((body[p + idLen + 4] << 8) | body[p + idLen + 5]);
      var dStart = p + hdrLen;
      var dEnd = Math.min(dStart + fsz, body.length);
      var data = body.subarray(dStart, dEnd);
      // 2.4：帧级非同步 / 数据长度指示
      if (ver === 4 && (fflags & 0x02)) data = deunsync(data);
      if (ver === 4 && (fflags & 0x01) && data.length > 4) data = data.subarray(4);
      // 压缩或加密帧无法解析，跳过
      if (!(ver === 4 && (fflags & 0x0C))) {
        (frames[id] = frames[id] || []).push(data);
      }
      p = dStart + fsz;
    }

    function first() {
      for (var i = 0; i < arguments.length; i++) {
        var a = frames[arguments[i]];
        if (a && a.length) return a[0];
      }
      return null;
    }
    function textOf() {
      var d = first.apply(null, arguments);
      if (!d || !d.length) return '';
      return clean(decode(d, 1, d.length, d[0]));
    }

    out.title = textOf('TIT2', 'TT2');
    out.artist = textOf('TPE1', 'TP1');
    out.album = textOf('TALB', 'TAL');
    out.track = textOf('TRCK', 'TRK');
    out.year = textOf('TDRC', 'TYER', 'TYE');

    // 歌词：USLT 优先，其次 SYLT，再退回 TXXX(描述含 lyric)
    var uslt = first('USLT', 'ULT');
    if (uslt && uslt.length > 4) {
      var enc = uslt[0];
      var e1 = nulEnd(uslt, 4, uslt.length, enc);
      out.lyrics = clean(decode(uslt, strEnd(uslt, e1, enc), uslt.length, enc));
      out.lyricsSource = 'USLT';
    }
    if (!out.lyrics) {
      var sylt = first('SYLT', 'SLT');
      if (sylt && sylt.length > 6) {
        var lines = parseSylt(sylt);
        if (lines && lines.length) {
          out.sylt = lines;
          out.lyricsSource = 'SYLT';
        }
      }
    }
    if (!out.lyrics && !out.sylt && frames.TXXX) {
      for (var ti = 0; ti < frames.TXXX.length; ti++) {
        var d = frames.TXXX[ti];
        if (!d || d.length < 2) continue;
        var enc2 = d[0];
        var de = nulEnd(d, 1, d.length, enc2);
        var desc = clean(decode(d, 1, de, enc2));
        if (!/lyric/i.test(desc)) continue;
        var val = clean(decode(d, strEnd(d, de, enc2), d.length, enc2));
        if (val) { out.lyrics = val; out.lyricsSource = 'TXXX:' + desc; break; }
      }
    }

    var apic = first('APIC', 'PIC');
    if (apic && apic.length > 4 && !out.__skipCover) {
      var pic = parseApic(apic, ver === 2);
      if (pic) out.coverData = pic;
    }
    return out;
  }

  function parseApic(d, isV2) {
    var enc = d[0], p = 1, i, mime;
    if (isV2) {
      mime = latin1(d, 1, 4).replace(/\u0000/g, '');
      p = 4;
      p += 1;                                  // picture type
    } else {
      for (i = p; i < d.length && d[i] !== 0; i++) { /* 找 mime 结尾 */ }
      mime = latin1(d, p, i);
      p = i + 1;
      p += 1;                                  // picture type
    }
    var e = nulEnd(d, p, d.length, enc);
    p = strEnd(d, e, enc);
    if (p >= d.length) return null;
    return { mime: mime || 'image/jpeg', data: d.subarray(p) };
  }

  // SYLT：enc(1) lang(3) tsFormat(1) contentType(1) descriptor(\0) 之后是 文本(\0)+时间(4)
  function parseSylt(d) {
    var enc = d[0], tsFmt = d[4];
    var p = 6;
    var e = nulEnd(d, p, d.length, enc);
    p = strEnd(d, e, enc);
    var lines = [];
    while (p < d.length) {
      var e2 = nulEnd(d, p, d.length, enc);
      var txt = clean(decode(d, p, e2, enc));
      p = strEnd(d, e2, enc);
      if (p + 4 > d.length) break;
      var t = be32(d, p);
      p += 4;
      if (txt) lines.push({ t: (tsFmt === 2) ? t / 1000 : null, text: txt });
    }
    if (!lines.length) return null;
    // tsFormat=1 是 MPEG 帧序，无法换算成秒，只能当纯文本用
    if (tsFmt !== 2) lines.forEach(function (l) { l.t = null; });
    return lines;
  }

  /* ================= FLAC ================= */

  function parseFlac(u8, final) {
    var out = { container: 'flac' };
    if (u8.length < 8) return out;
    if (!(u8[0] === 0x66 && u8[1] === 0x4C && u8[2] === 0x61 && u8[3] === 0x43)) return out;  // 'fLaC'
    var p = 4;
    while (p + 4 <= u8.length) {
      var b = u8[p];
      var last = !!(b & 0x80), type = b & 0x7F;
      var len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
      var s = p + 4, e = s + len;
      if (e > u8.length) {
        if (!final) out.__needMore = Math.min(e, 12 * 1024 * 1024);
        break;
      }
      if (type === 0) {
        var sr = (u8[s + 10] << 12) | (u8[s + 11] << 4) | (u8[s + 12] >> 4);
        var total = ((u8[s + 13] & 0x0F) * 0x100000000) + (((u8[s + 14] << 24) | (u8[s + 15] << 16) | (u8[s + 16] << 8) | u8[s + 17]) >>> 0);
        if (sr > 0 && total > 0) out.duration = total / sr;
      } else if (type === 4) {
        parseVorbis(u8, s, e, out);
      } else if (type === 6) {
        parseFlacPicture(u8, s, e, out);
      }
      p = e;
      if (last) break;
    }
    return out;
  }

  function parseVorbis(u8, s, e, out) {
    var p = s;
    if (p + 4 > e) return;
    var vl = le32(u8, p); p += 4;
    if (vl > e - p) return;
    p += vl;
    if (p + 4 > e) return;
    var n = le32(u8, p); p += 4;
    for (var i = 0; i < n && p + 4 <= e; i++) {
      var l = le32(u8, p); p += 4;
      if (!l || l > e - p) break;
      var kv = utf8(u8, p, p + l);
      p += l;
      var eq = kv.indexOf('=');
      if (eq < 0) continue;
      var k = kv.slice(0, eq).toUpperCase().replace(/\s+/g, '');
      var v = kv.slice(eq + 1);
      if (k === 'LYRICS' || k === 'UNSYNCEDLYRICS') { if (!out.lyrics) { out.lyrics = v; out.lyricsSource = 'Vorbis:' + k; } }
      else if (k === 'TITLE') out.title = v;
      else if (k === 'ARTIST') out.artist = v;
      else if (k === 'ALBUM') out.album = v;
      else if (k === 'TRACKNUMBER') out.track = v;
      else if (k === 'DATE') out.year = v;
    }
  }

  function parseFlacPicture(u8, s, e, out) {
    if (out.coverData) return;
    var p = s + 4;
    if (p + 4 > e) return;
    var ml = be32(u8, p); p += 4;
    if (ml > e - p) return;
    var mime = latin1(u8, p, p + ml); p += ml;
    if (p + 4 > e) return;
    var dl = be32(u8, p); p += 4;
    if (dl > e - p) return;
    p += dl + 16;                                  // 描述 + w/h/depth/colors
    if (p + 4 > e) return;
    var pl = be32(u8, p); p += 4;
    if (!pl || pl > e - p) return;
    out.coverData = { mime: mime || 'image/jpeg', data: u8.subarray(p, p + pl) };
  }

  /* ================= LRC ================= */

  function toSec(mm, ss, frac) {
    var t = parseInt(mm, 10) * 60 + parseInt(ss, 10);
    if (frac) t += parseInt(frac, 10) / Math.pow(10, String(frac).length);
    return t;
  }

  function parseLrc(text) {
    var meta = {}, stamped = [], plain = [];
    if (!text) return { synced: false, lines: [], meta: meta, plain: '' };
    var raw = String(text).split(/\r\n|\r|\n/);
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      var re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      var m, stamps = [], last = 0;
      while ((m = re.exec(line))) { stamps.push(toSec(m[1], m[2], m[3])); last = re.lastIndex; }
      if (stamps.length) {
        var rest = line.slice(last).replace(/\s+$/, '');
        for (var k = 0; k < stamps.length; k++) stamped.push({ t: stamps[k], text: rest });
      } else {
        var mm = /^\s*\[([a-zA-Z#]+):([^\]]*)\]\s*$/.exec(line);
        if (mm) meta[mm[1].toLowerCase()] = mm[2].trim();
        else if (line.trim()) plain.push(line.replace(/\s+$/, ''));
      }
    }
    if (stamped.length) {
      var off = parseFloat(meta.offset);
      if (isFinite(off) && off) stamped.forEach(function (l) { l.t -= off / 1000; });
      stamped.sort(function (a, b) { return a.t - b.t; });
      return { synced: true, lines: stamped, meta: meta, plain: '' };
    }
    return {
      synced: false, meta: meta,
      lines: plain.map(function (t) { return { t: null, text: t }; }),
      plain: plain.join('\n')
    };
  }

  /* ================= 对外：读取一个音频文件的元数据 ================= */

  function parseContainer(u8, ext, final, opt) {
    var out = null;
    if (u8.length >= 3 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) out = parseId3(u8, final);
    else if (u8.length >= 4 && u8[0] === 0x66 && u8[1] === 0x4C && u8[2] === 0x61 && u8[3] === 0x43) out = parseFlac(u8, final);
    else if (ext === 'mp3' || ext === 'mp2') out = parseId3(u8, final);
    else if (ext === 'flac') out = parseFlac(u8, final);
    else out = { container: '' };
    if (opt && opt.cover === false) out.coverData = null;
    return out;
  }

  function finish(out, opt) {
    var res = {
      container: out.container || '',
      title: clean(out.title),
      artist: clean(out.artist),
      album: clean(out.album),
      track: clean(out.track),
      year: clean(out.year),
      duration: out.duration || 0,
      lyricsSource: out.lyricsSource || (out.sylt ? 'SYLT' : ''),
      lyrics: '',
      lrc: null,
      cover: null
    };
    if (out.sylt && out.sylt.length) {
      var lines = out.sylt.filter(function (l) { return l.text; });
      var synced = lines.length > 0 && lines[0].t !== null;
      res.lrc = { synced: !!synced, lines: lines, meta: {}, plain: '' };
    } else if (out.lyrics) {
      res.lyrics = out.lyrics;
      res.lrc = parseLrc(out.lyrics);
    }
    if (out.coverData && out.coverData.data && out.coverData.data.length && !(opt && opt.cover === false)) {
      res.cover = {
        mime: out.coverData.mime,
        dataUrl: 'data:' + out.coverData.mime + ';base64,' + toBase64(out.coverData.data),
        size: out.coverData.data.length
      };
    }
    return res;
  }

  /**
   * 读取音频元数据（含歌词、封面）
   * @param {string} url
   * @param {object} [opt] { lyrics:false 只读头部 64KB | headBytes | cover:false | timeout }
   * @returns {Promise<object>} { title, artist, album, track, duration, lyrics, lrc, cover }
   */
  function read(url, opt) {
    opt = opt || {};
    var ext = opt.ext || extOf(url);
    var head = opt.headBytes || (opt.lyrics === false ? 65536 : 1572864);
    return readRange(url, 0, head - 1, opt).then(function (r) {
      var complete = (r.status !== 206);           // 服务器忽略 Range，给的就是整个文件
      var u8 = new Uint8Array(r.buf || new ArrayBuffer(0));
      var out = parseContainer(u8, ext, complete, opt);
      if (out.__needMore && !complete) {
        var to = Math.min(out.__needMore, 12 * 1024 * 1024);
        return readRange(url, 0, to - 1, opt).then(function (r2) {
          var u82 = new Uint8Array(r2.buf || new ArrayBuffer(0));
          return finish(parseContainer(u82, ext, true, opt), opt);
        });
      }
      delete out.__needMore;
      return finish(out, opt);
    });
  }

  EP.musicMeta = {
    extOf: extOf,
    isAudio: isAudio,
    canReadTags: canReadTags,
    read: read,
    readRange: readRange,
    probeRange: probeRange,
    parseLrc: parseLrc,
    toBase64: toBase64
  };
})();

import { webContents } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { appDataDir, Logger } from '../global'
import { ResourcePackManager } from '../resourcepack/resourcepack'

/**
 * 收集文本替换诊断信息。
 *
 * 直接在游戏页面的 wasm 堆里查找每条规则的原文（UTF-8 / UTF-16LE），
 * 并把 probe 关键词附近的字符串提取出来，写入用户数据目录的 text-diag.json。
 */
export async function collectTextDiagnostics(): Promise<string> {
  const rules =
    ResourcePackManager && typeof ResourcePackManager.getTextReplacements === 'function'
      ? ResourcePackManager.getTextReplacements()
      : []
  const probes =
    ResourcePackManager && typeof ResourcePackManager.getTextProbes === 'function'
      ? ResourcePackManager.getTextProbes()
      : []

  const target = webContents
    .getAllWebContents()
    .find(wc =>
      /(maj-soul\.com|mahjongsoul\.com|majsoul\.com|yo-star\.com)/i.test(
        wc.getURL()
      )
    )

  let data: any = { error: '未找到游戏页面（请先启动游戏并进入大厅）' }
  if (target) {
    try {
      data = await target.executeJavaScript(
        buildDiagnosticScript(rules, probes),
        true
      )
    } catch (error) {
      data = { error: String(error) }
    }
  }

  const file = path.join(appDataDir, 'text-diag.json')
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ...data,
        rulesConfigured: rules.length,
        probesConfigured: probes.length,
        page: target ? target.getURL() : ''
      },
      null,
      2
    ),
    'utf-8'
  )
  Logger.info(`[Majsoul] 文本诊断已写入 ${file}`)
  return file
}

function buildDiagnosticScript(
  rules: Array<{ from: string; to: string }>,
  probes: string[]
): string {
  return `(function () {
  var RULES = ${JSON.stringify(rules)};
  var PROBES = ${JSON.stringify(probes)};
  var out = {
    time: new Date().toISOString(),
    heap: { available: false, size: 0 },
    rules: [],
    probes: {}
  };
  try {
    if (typeof unityInstance === 'undefined' || !unityInstance) {
      out.error = 'unityInstance 未就绪';
      return out;
    }
    var m = unityInstance.Module;
    var h = m && (m.HEAPU8 || (m.asm && m.asm.HEAPU8));
    if (!h) {
      out.error = '无法读取游戏内存';
      return out;
    }
    out.heap.available = true;
    out.heap.size = h.length;
    var enc = new TextEncoder();
    var dec = new TextDecoder('utf-8', { fatal: false });

    function countBytes(pat) {
      var first = pat[0], plen = pat.length, pos = 0, c = 0;
      while (true) {
        pos = h.indexOf(first, pos);
        if (pos < 0 || pos + plen > h.length) break;
        var ok = true;
        for (var j = 1; j < plen; j++) {
          if (h[pos + j] !== pat[j]) { ok = false; break; }
        }
        if (ok) { c++; pos += plen; } else pos += 1;
      }
      return c;
    }

    function utf16Bytes(text) {
      var arr = [];
      for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        arr.push(code & 0xff, (code >> 8) & 0xff);
      }
      return new Uint8Array(arr);
    }

    function expand(pos, len) {
      var start = pos, end = pos + len, limit = 4096;
      while (start > 0 && pos - start < limit) {
        var b = h[start - 1];
        if (b === 0) break;
        start--;
      }
      while (end < h.length && end - pos < len + limit) {
        var b2 = h[end];
        if (b2 === 0) break;
        end++;
      }
      try { return dec.decode(h.subarray(start, end)).trim(); } catch (e) { return ''; }
    }

    function expandUtf16(pos, len) {
      var start = pos, end = pos + len, limit = 4096;
      while (start >= 2 && pos - start < limit) {
        if (h[start - 2] === 0 && h[start - 1] === 0) break;
        start -= 2;
      }
      while (end + 1 < h.length && end - pos < len + limit) {
        if (h[end] === 0 && h[end + 1] === 0) break;
        end += 2;
      }
      try {
        var dec16 = new TextDecoder('utf-16le', { fatal: false });
        return dec16.decode(h.subarray(start, end)).trim();
      } catch (e) {
        return '';
      }
    }

    for (var r = 0; r < RULES.length; r++) {
      var from = RULES[r].from;
      var to = RULES[r].to;
      var a = enc.encode(from);
      var b = enc.encode(to);
      var u = utf16Bytes(from);
      out.rules.push({
        from: from,
        to: to,
        bytes: a.length,
        toBytes: b.length,
        matches: countBytes(a),
        matchesNew: countBytes(b),
        matchesUtf16: from.length > 1 ? countBytes(u) : 0,
        tooLong: b.length > a.length
      });
    }

    out.probesUtf16 = {};
    for (var p = 0; p < PROBES.length; p++) {
      var probe = PROBES[p];
      var pat = enc.encode(probe);
      if (!pat.length) continue;
      var first = pat[0], plen = pat.length, pos = 0, list = [];
      while (true) {
        pos = h.indexOf(first, pos);
        if (pos < 0 || pos + plen > h.length) break;
        var ok = true;
        for (var j = 1; j < plen; j++) {
          if (h[pos + j] !== pat[j]) { ok = false; break; }
        }
        if (ok) {
          var text = expand(pos, plen);
          if (text && list.indexOf(text) < 0 && list.length < 60) list.push(text);
          pos += plen;
        } else pos += 1;
      }
      out.probes[probe] = list;

      var upat = utf16Bytes(probe);
      var ufirst = upat[0], ufirst2 = upat[1], ulen = upat.length;
      var upos = 0, ulist = [];
      while (true) {
        upos = h.indexOf(ufirst, upos);
        if (upos < 0 || upos + ulen > h.length) break;
        if (h[upos + 1] !== ufirst2) { upos += 1; continue; }
        var uok = true;
        for (var uj = 2; uj < ulen; uj++) {
          if (h[upos + uj] !== upat[uj]) { uok = false; break; }
        }
        if (uok) {
          var utext = expandUtf16(upos, ulen);
          if (utext && ulist.indexOf(utext) < 0 && ulist.length < 60) ulist.push(utext);
          upos += ulen;
        } else upos += 2;
      }
      out.probesUtf16[probe] = ulist;
    }
  } catch (e) {
    out.error = String(e);
  }
  return out;
})()`
}

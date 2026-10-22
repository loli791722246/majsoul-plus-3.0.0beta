export interface TextReplacement {
  from: string
  to: string
}

/**
 * 生成注入到游戏页面的文本替换脚本。
 *
 * 新版客户端把语音台词、角色名等放在加密的 Lua 表里，正常手段改不了。
 * 但游戏运行时会把 Lua 表解密后放在 wasm 堆（unityInstance.Module.HEAPU8）里，
 * 因此可以在内存中查找原文的 UTF-8 字节并就地替换。
 *
 * 关键点：wasm 堆可能有 512MB，一次性全量扫描会卡住游戏主线程
 * （表现为「正在初始化游戏资源」非常慢）。所以扫描按 4MB 分片，
 * 每片之间让出主线程，避免长时间占用。
 */
export function buildTextReplacerScript(
  replacements: TextReplacement[],
  probes: string[] = []
): string {
  const map = JSON.stringify(
    replacements
      .filter(item => item && typeof item.from === 'string' && item.from)
      .map(item => ({ from: item.from, to: String(item.to) }))
  )

  return `;(function () {
  if (window.__majsoulPlusTextReplacer) return;
  window.__majsoulPlusTextReplacer = true;
  var MAP = ${map};
  var encoder = new TextEncoder();

  function utf16Bytes(text) {
    var arr = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      arr.push(code & 0xff, (code >> 8) & 0xff);
    }
    return new Uint8Array(arr);
  }

  var entries = [];
  for (var i = 0; i < MAP.length; i++) {
    try {
      var from = MAP[i].from;
      var to = MAP[i].to;
      if (!from) continue;
      var a = encoder.encode(from);
      var b = encoder.encode(to);
      if (b.length > a.length) {
        console.warn('[majsoul-plus] 文本过长已跳过: ' + from);
        continue;
      }
      var padded = new Uint8Array(a.length);
      padded.fill(0x20);
      padded.set(b);

      var u16a = null;
      var u16b = null;
      try {
        var ua = utf16Bytes(from);
        var ub = utf16Bytes(to);
        if (ub.length <= ua.length) {
          var padded16 = new Uint8Array(ua.length);
          for (var q = 0; q < padded16.length; q += 2) padded16[q] = 0x20;
          padded16.set(ub, 0);
          u16a = ua;
          u16b = padded16;
        }
      } catch (e) {}

      entries.push({ a: a, b: padded, u16a: u16a, u16b: u16b, from: from });
    } catch (e) {}
  }
  if (!entries.length) return;

  function getHeap() {
    try {
      if (typeof unityInstance === 'undefined' || !unityInstance) return null;
      var m = unityInstance.Module;
      if (!m) return null;
      return m.HEAPU8 || (m.asm && m.asm.HEAPU8) || null;
    } catch (e) {
      return null;
    }
  }

  var CHUNK = 4 * 1024 * 1024;
  var OVERLAP = 128;
  var sweep = null;
  var replaced = 0;

  function scanWindow(heap, start, end) {
    for (var k = 0; k < entries.length; k++) {
      var e = entries[k];
      var pat = e.a;
      var out = e.b;
      var plen = pat.length;
      if (!plen) continue;
      var first = pat[0];
      var pos = start;
      while (pos < end) {
        pos = heap.indexOf(first, pos);
        if (pos < 0 || pos >= end) break;
        if (pos + plen <= heap.length) {
          var ok = true;
          for (var j = 1; j < plen; j++) {
            if (heap[pos + j] !== pat[j]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            heap.set(out, pos);
            replaced++;
            pos += plen;
            continue;
          }
        }
        pos += 1;
      }

      if (e.u16a) {
        var upat = e.u16a;
        var uout = e.u16b;
        var ulen = upat.length;
        var upos = start;
        while (upos < end) {
          upos = heap.indexOf(upat[0], upos);
          if (upos < 0 || upos >= end) break;
          if (upos + ulen <= heap.length && heap[upos + 1] === upat[1]) {
            var uok = true;
            for (var uj = 2; uj < ulen; uj++) {
              if (heap[upos + uj] !== upat[uj]) {
                uok = false;
                break;
              }
            }
            if (uok) {
              heap.set(uout, upos);
              replaced++;
              upos += ulen;
              continue;
            }
          }
          upos += 2;
        }
      }
    }
  }

  function step() {
    var heap = getHeap();
    if (!heap) {
      setTimeout(step, 2000);
      return;
    }
    if (!sweep) sweep = { pos: 0, length: heap.length };
    var end = Math.min(sweep.pos + CHUNK, sweep.length);
    try {
      scanWindow(heap, sweep.pos, end);
    } catch (e) {}

    if (end >= sweep.length) {
      sweep = null;
      console.log('[majsoul-plus] 文本替换扫描完成，累计替换 ' + replaced + ' 处');
    } else {
      sweep.pos = Math.max(end - OVERLAP, sweep.pos + 1);
      setTimeout(step, 15);
    }
  }

  function startSweep() {
    if (sweep) return;
    step();
  }

  // 游戏加载 / 更新期间隔很久再开始，避免和资源初始化抢主线程
  [15000, 45000, 90000, 150000, 220000].forEach(function (t) {
    setTimeout(function () {
      try {
        startSweep();
      } catch (e) {}
    }, t);
  });

  try {
    window.__majsoulPlusScan = startSweep;
  } catch (e) {}
})();`
}

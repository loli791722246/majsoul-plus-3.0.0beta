/* eslint-disable */
// 文本替换注入脚本的逻辑测试（模拟 wasm 堆，含 UTF-8 与 UTF-16LE）
const vm = require('vm')
const { buildTextReplacerScript } = require('../dist/mitm/text-replacer')

const heap = new Uint8Array(65536)
const enc = new TextEncoder()
heap.set(enc.encode('prefix-获得语音-suffix'), 100)
heap.set(enc.encode('xx一姬yy'), 1000)
heap.set(Buffer.from('一姬', 'utf16le'), 3000)

const sandbox = {
  window: {},
  unityInstance: { Module: { HEAPU8: heap } },
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Buffer,
  console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  fetch: () => Promise.resolve(),
  JSON,
  Date
}

const script = buildTextReplacerScript([
  { from: '获得语音', to: '取得语音' },
  { from: '一姬', to: '泠鸢' },
  { from: '这条很长', to: '短' }
])
vm.runInNewContext(script, sandbox)

if (typeof sandbox.window.__majsoulPlusScan !== 'function') {
  console.log('FAIL: no scan entry')
  process.exit(1)
}
sandbox.window.__majsoulPlusScan()

const text = Buffer.from(heap).toString('utf-8')
const utf16 = Buffer.from(heap).toString('utf16le')
const ok =
  text.includes('取得语音') &&
  text.includes('泠鸢yy') &&
  !text.includes('获得语音') &&
  utf16.includes('泠鸢')
console.log('result', ok)
process.exit(ok ? 0 : 1)

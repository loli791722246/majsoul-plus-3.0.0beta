/* eslint-disable */
const vm = require('vm')
const { buildTextReplacerScript } = require('../dist/mitm/text-replacer')
const { planLongText } = require('../dist/majsoul/text-long')

function run(rule, text) {
  const plan = planLongText([rule])
  const heap = new Uint8Array(4096)
  const encoded = Buffer.from(text, 'utf8')
  heap.set(encoded, 100)
  const sandbox = {
    window: {},
    unityInstance: { Module: { HEAPU8: heap } },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    fetch: () => Promise.resolve(),
    JSON,
    Date
  }
  vm.runInNewContext(buildTextReplacerScript(plan.effective, []), sandbox)
  sandbox.window.__majsoulPlusScan()
  const expected = Buffer.from(plan.effective[0].to, 'utf8')
  return {
    ok: Buffer.from(heap.slice(100, 100 + expected.length)).equals(expected),
    expected
  }
}

const a = run({ from: '一姬', to: '橘爱丽丝' }, '一姬')
const b = run({ from: 'A姬', to: '泠鸢yousa' }, 'A姬')
console.log('6B', a.ok, a.expected.length, '4B', b.ok, b.expected.length)
process.exit(a.ok && b.ok && a.expected.length === 6 && b.expected.length === 4 ? 0 : 1)

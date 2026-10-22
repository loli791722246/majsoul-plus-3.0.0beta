/* eslint-disable */
const assert = require('assert')
const { planLongText } = require('../dist/majsoul/text-long')

const plan = planLongText([{ from: '一姬', to: '橘爱丽丝' }])
console.log('[long] 6B', JSON.stringify(plan.effective), JSON.stringify(plan.compose))
assert.strictEqual(Buffer.byteLength(plan.effective[0].to, 'utf8'), 6)
assert.strictEqual(plan.compose[0].text + plan.compose[1].text, '橘爱丽丝')

const plan4 = planLongText([{ from: 'A姬', to: '泠鸢yousa' }])
console.log('[long] 4B', JSON.stringify(plan4.effective), JSON.stringify(plan4.compose))
assert.strictEqual(Buffer.byteLength(plan4.effective[0].to, 'utf8'), 4)
assert.strictEqual(plan4.effective[0].to.endsWith('\u0001'), true)

const plan5 = planLongText([{ from: 'A姬B', to: '泠鸢yousa' }])
console.log('[long] 5B', JSON.stringify(plan5.effective), JSON.stringify(plan5.compose))
assert.strictEqual(Buffer.byteLength(plan5.effective[0].to, 'utf8'), 5)
assert.strictEqual(plan5.effective[0].to.endsWith('\u00ad'), true)

const plan2 = planLongText([{ from: 'ab', to: '泠鸢yousa' }])
assert.strictEqual(plan2.compose.length, 0)

console.log('[long] ok')

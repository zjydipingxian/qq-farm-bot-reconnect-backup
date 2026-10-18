import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

function loadOptionsBuilder() {
  const source = readFileSync(new URL('../src/utils/reconnect-account-options.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports)
  return module.exports.buildReconnectAccountOptions
}

test('binding options distinguish accounts that share the same farm nickname', () => {
  const buildReconnectAccountOptions = loadOptionsBuilder()
  const options = buildReconnectAccountOptions([
    { id: 'wx-account-10001', name: '开心农场', platform: 'wx' },
    { id: 'qq-account-20002', name: '开心农场', platform: 'qq', uin: 12345678 },
  ])

  assert.deepEqual(options.map(option => option.value), ['wx-account-10001', 'qq-account-20002'])
  assert.notEqual(options[0].label, options[1].label)
  assert.match(options[0].label, /开心农场.*微信.*wx-account-10001/)
  assert.match(options[1].label, /开心农场.*QQ.*12345678/)
})

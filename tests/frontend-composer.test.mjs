import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../src/composerRouting.ts', import.meta.url), 'utf8'))
const module = new SourceTextModule(source)
await module.link(() => { throw new Error('Routing should not depend on browser state') })
await module.evaluate()
const { composerSendMode } = module.namespace

test('a confirmation after switching to direct image mode continues through the Agent', () => {
  for (const text of ['继续', '继续执行。', '确认', '开始吧', 'go ahead', 'Continue!', 'OK']) {
    assert.equal(composerSendMode('image', text, false, false), 'agent')
    assert.equal(composerSendMode('video', text, false, false), 'agent')
  }
})

test('a selected skill or attached document is never silently dropped by direct mode', () => {
  assert.equal(composerSendMode('image', '链式感知公司的品牌设计', true, false), 'agent')
  assert.equal(composerSendMode('video', '按附件制作', false, true), 'agent')
})

test('complete visual prompts retain the explicitly selected generator', () => {
  assert.equal(composerSendMode('image', '科技公司 Logo，蓝色几何链环，白底', false, false), 'image')
  assert.equal(composerSendMode('video', 'A bird flies from a rainy branch', false, false), 'video')
  assert.equal(composerSendMode('agent', '继续', false, false), 'agent')
})

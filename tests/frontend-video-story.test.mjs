import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'
const source = stripTypeScriptTypes(await readFile(new URL('../src/videoStory.ts', import.meta.url), 'utf8'))
const module = new SourceTextModule(source)
await module.link(() => { throw new Error('Script parsing must be independent of UI and model availability') })
await module.evaluate()
const { scriptShots, validateShots, isVideoScript } = module.namespace

test('long multi-episode scripts never enter one-shot generation', () => {
  assert.equal(isVideoScript('## 第一集\n【画面】\n地铁\n## 第二集\n【画面】\n小院'), true)
  assert.equal(isVideoScript('A suitcase in a subway station'), false)
  assert.equal(isVideoScript('长'.repeat(701)), true)
})
test('all screenplay scenes and narration remain in source order without truncation', () => {
  const source = '## 第一集：地铁\n【画面】\n女人拖着箱子。\n【旁白】\n她走进空荡的车站。\n【画面钩子】\n远处一盏灯熄灭。\n## 第二集：小院\n【画面】\n推开生锈铁门。\n【全剧终】'
  const shots = scriptShots(source)
  assert.equal(shots.length, 3)
  assert.equal(shots[0].prompt, '女人拖着箱子。')
  assert.equal(shots[0].narration, '她走进空荡的车站。')
  assert.match(shots[1].title, /第一集/)
  assert.match(shots[2].title, /第二集/)
  assert.equal(validateShots(shots), null)
})
test('paragraph-only scripts remain editable separate shots', () => {
  assert.equal(scriptShots('雨夜的地铁。\n\n荒凉的小院。').length, 2)
})
test('too long shots and batches fail visibly rather than silently dropping text', () => {
  assert.match(validateShots([{ title: 'a', prompt: '长'.repeat(901), narration: '', duration: 5 }]), /拆分/)
  assert.match(validateShots(Array.from({ length: 61 }, () => ({ prompt: '场景', narration: '', duration: 5 }))), /60/)
  assert.match(validateShots([{ title: 'a', prompt: '场景', narration: '长'.repeat(151), duration: 5 }]), /旁白/)
})
test('explicit camera cuts become separate shots and narration is retained exactly once', () => {
  const shots = scriptShots('## 一集\n【画面】\n全景：空车站。\n中景：女人拖行李。\n特写：她看手表。\n**旁白**：末班车已经离开。她却还在等人。')
  assert.equal(shots.length, 3)
  assert.equal(shots.map((s) => s.narration).join(''), '末班车已经离开。她却还在等人。')
  assert.match(shots[2].prompt, /特写/)
})

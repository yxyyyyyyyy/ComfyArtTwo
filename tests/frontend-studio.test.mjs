import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'

const module = new SourceTextModule(stripTypeScriptTypes(await readFile(new URL('../src/studio/story.ts', import.meta.url), 'utf8')))
await module.link(() => { throw new Error('Studio draft handling must work without the editor or generation service') })
await module.evaluate()
const { reviseDraft, rolesOf, scenesOf, studioView, formatDuration } = module.namespace

test('revising a screenplay preserves finished film, production IDs, original script and archived work', () => {
  const meta = {
    videoStory: { source: '第一版原稿', result: '/view?filename=final-v2.mp4', production: { id: 'episode-01' } },
    videoStoryArchive: [{ source: '早期方案' }], brandKit: 'original-kit',
    studioDraft: { source: '旧修订', castNotes: { 角色甲: '蓝色上衣，背包' } },
  }
  const next = reviseDraft(meta, { source: '新修订稿：她没有赶上列车。' })
  assert.deepEqual(next.videoStory, meta.videoStory)
  assert.deepEqual(next.videoStoryArchive, meta.videoStoryArchive)
  assert.equal(next.brandKit, 'original-kit')
  assert.equal(next.studioDraft.castNotes.角色甲, '蓝色上衣，背包')
  assert.equal(next.studioDraft.source, '新修订稿：她没有赶上列车。')
  assert.equal(meta.studioDraft.source, '旧修订')
})

test('characters sharing a voice stay distinct and every dialogue cue is counted', () => {
  const roles = rolesOf([
    { id: '01', title: '车站', narration: [{ role: '旁白', speaker: 'Uncle_Fu', text: '列车进站。' }, { role: '角色乙', speaker: 'Uncle_Fu', text: '下一站见。' }] },
    { id: '02', title: '隧道', narration: [{ role: '旁白', speaker: 'Uncle_Fu', text: '歌声停止了。' }] },
  ])
  assert.equal(roles.length, 2)
  assert.equal(roles[0].cues, 2)
  assert.equal(roles[1].cues, 1)
  assert.equal(roles[1].name, '角色乙')
})

test('both episode and short-shot projects expose their actual scenes without inventing dialogue', () => {
  const episode = [{ id: 'a', title: '第一场', narration: [] }]
  assert.deepEqual(scenesOf({ production: { scenes: episode }, shots: [{ title: '归档镜头' }] }), episode)
  const scenes = scenesOf({ shots: [{ title: '空车站', narration: '' }, { title: '来电', narration: '电话再也没有接通。' }] })
  assert.equal(scenes.length, 2)
  assert.equal(scenes[0].narration.length, 0)
  assert.equal(scenes[1].narration[0].text, '电话再也没有接通。')
})

test('unknown routes and unverified video duration have explicit fallbacks', () => {
  assert.equal(studioView('film'), 'film')
  assert.equal(studioView('unknown'), 'overview')
  assert.equal(studioView(null), 'overview')
  assert.equal(formatDuration(undefined), '时长待确认')
  assert.equal(formatDuration(Infinity), '时长待确认')
  assert.equal(formatDuration(360), '06:00')
})

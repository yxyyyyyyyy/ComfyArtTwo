import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule } from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../src/filmDirector.ts', import.meta.url), 'utf8'))
const module = new SourceTextModule(source)
await module.link(() => { throw new Error('Director validation must not require a generation service') })
await module.evaluate()
const { parseDirection, directorInstructions } = module.namespace
const story = new SourceTextModule(stripTypeScriptTypes(await readFile(new URL('../src/videoStory.ts', import.meta.url), 'utf8')))
await story.link(() => { throw new Error('Shot validation must be independent') })
await story.evaluate()
const draft = () => ({ visualBible: '2D animation. Lin wears a blue coat, short black hair.', shots: Array.from({ length: 6 }, (_, i) => ({ title: `镜头 ${i + 1}`, scene: 'office', action: '拿起杯子，喝一口', camera: '中景缓慢跟随', prompt: 'Lin picks up a white cup in an office and takes a sip.', narration: '她喝了一口水。', continuePrevious: i > 0 })) })

test('automatic shots keep visible actions, identity and narration with a fixed sample budget', () => {
  const result = parseDirection(draft(), 30)
  assert.equal(result.shots.length, 6)
  assert.equal(result.shots.reduce((n, s) => n + s.duration, 0), 30)
  assert.match(result.shots[2].prompt, /blue coat/)
  assert.match(result.shots[2].prompt, /拿起杯子/)
  assert.equal(result.shots[2].narration, '她喝了一口水。')
  assert.match(directorInstructions(30), /exactly 6 shots/)
})

test('incomplete plans are rejected rather than silently dropping source material or shots', () => {
  const d = draft(); d.shots.pop()
  assert.throws(() => parseDirection(d, 30), /实际返回 5/)
  assert.throws(() => parseDirection(null, 30), /不完整/)
  const missing = draft(); delete missing.shots[2].action
  assert.throws(() => parseDirection(missing, 30), /镜头 3/)
})

test('end-frame continuity cannot cross scenes or refer to a nonexistent previous shot', () => {
  const first = draft(); first.shots[0].continuePrevious = true
  assert.equal(parseDirection(first, 30).shots[0].continuePrevious, false)
  const moved = draft(); moved.shots[2].scene = 'street'
  assert.equal(parseDirection(moved, 30).shots[2].continuePrevious, false)
  const absent = draft(); delete absent.shots[0].continuePrevious
  assert.equal(parseDirection(absent, 30).shots[0].continuePrevious, false)
})

test('long narration cannot silently inflate the duration of an action shot', () => {
  const d = draft(); d.shots[4].narration = '长'.repeat(17)
  assert.throws(() => parseDirection(d, 30), /旁白太长/)
})

test('detailed character continuity survives planning and the generation preflight', () => {
  const d = draft(); d.visualBible = 'Lin wears a blue coat and has short black hair. Zhou wears a cream shirt. '.repeat(12)
  const plan = parseDirection(d, 30)
  assert.ok(plan.shots[0].prompt.length > 900)
  assert.equal(story.namespace.validateShots(plan.shots), null)
  assert.ok(plan.shots[0].prompt.includes(d.visualBible))
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../src/workflows.ts', import.meta.url), 'utf8'))
const module = new SourceTextModule(source)
await module.link(() => new SyntheticModule(['loadWorkflow'], function () {
  this.setExport('loadWorkflow', async (name) =>
    JSON.parse(await readFile(new URL('../workflows/' + name, import.meta.url), 'utf8')))
}))
await module.evaluate()
const workflows = module.namespace

test('512p video stays on the model grid and retains the existing default', () => {
  assert.equal(Object.keys(workflows.VIDEO_AREAS)[0], '768p')
  assert.deepEqual(workflows.videoSize(16 / 9, workflows.VIDEO_AREAS['512p']), [896, 512])
  for (const dimension of workflows.videoSize(1, workflows.VIDEO_AREAS['512p'])) {
    assert.equal(dimension % 32, 0)
  }
})

test('text-to-video uses the verified eight-step Turbo path', async () => {
  const { graph, result } = await workflows.t2vGraph('Morning coffee', 16 / 9, 5, workflows.VIDEO_AREAS['512p'])
  assert.equal(result, '92')
  assert.equal(graph['131'].inputs.prompt, 'Morning coffee')
  assert.equal(graph['131'].inputs.width, 896)
  assert.equal(graph['131'].inputs.height, 512)
  assert.equal(graph['133'].inputs.value, 5)
  assert.equal(graph['139'].inputs.value, true)
  assert.equal(graph['138'].inputs.value, 8)
})

test('image-to-video preserves its first frame and uses eight-step Turbo', async () => {
  const { graph } = await workflows.imageToVideoGraph('coffee.png', 'Rising steam', 1, 5, null, workflows.VIDEO_AREAS['512p'])
  assert.equal(graph['114'].inputs.image, 'coffee.png')
  assert.equal(graph['105:104'].inputs.prompt, 'Rising steam')
  assert.equal(graph['105:126'].inputs.value, true)
  assert.equal(graph['105:125'].inputs.value, 8)
})

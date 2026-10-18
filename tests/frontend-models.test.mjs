import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { SourceTextModule, SyntheticModule } from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../src/models.ts', import.meta.url), 'utf8'))

async function modelsWith(inventory, paths = {}) {
  const dependencies = {
    tldraw: { atom: (_name, initial) => {
      let value = initial
      return { get: () => value, set: (next) => { value = next } }
    } },
    './comfy': {
      api: async (path) => ({ ok: true, json: async () => inventory[path.split('/').pop()] ?? [] }),
      loadModelPaths: async () => paths,
      readUserJson: async (_path, fallback) => fallback,
      writeUserJson: async () => {},
    },
    './i18n': { t: (key) => key },
  }
  const module = new SourceTextModule(source)
  await module.link((name) => {
    const exports = dependencies[name]
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    })
  })
  await module.evaluate()
  await module.namespace.loadModels()
  return module.namespace
}

test('a main model without its text encoder or VAE stays unavailable', async () => {
  const models = await modelsWith({
    diffusion_models: ['qwen_image_2.1_int8_convrot.safetensors', 'z_image_turbo_bf16.safetensors'],
    text_encoders: ['qwen_3_4b.safetensors'],
    vae: ['ae.safetensors'],
  })
  assert.equal(models.isInstalled('qwen-image-2.1-t2i.api.json'), false)
  assert.deepEqual(models.agentModels(false).map((model) => model.id), ['z-image-turbo-t2i.api.json'])
})

test('a file in the wrong category cannot satisfy a missing VAE', async () => {
  const models = await modelsWith({
    diffusion_models: ['z_image_turbo_bf16.safetensors', 'ae.safetensors'],
    text_encoders: ['qwen_3_4b.safetensors'],
    vae: [],
  })
  assert.equal(models.isInstalled('z-image-turbo-t2i.api.json'), false)
})

test('complete models in subfolders remain usable', async () => {
  const models = await modelsWith({
    diffusion_models: ['images/z_image_turbo_bf16.safetensors'],
    text_encoders: ['qwen/qwen_3_4b.safetensors'],
    vae: ['flux/ae.safetensors'],
  }, {
    'z_image_turbo_bf16.safetensors': 'images/z_image_turbo_bf16.safetensors',
    'qwen_3_4b.safetensors': 'qwen/qwen_3_4b.safetensors',
    'ae.safetensors': 'flux/ae.safetensors',
  })
  assert.equal(models.isInstalled('z-image-turbo-t2i.api.json'), true)
})

test('availability covers every weight referenced by each generation workflow', async () => {
  const models = await modelsWith({})
  for (const model of [...models.IMAGE_MODELS, ...models.VIDEO_MODELS]) {
    const graph = JSON.parse(await readFile(new URL('../workflows/' + model.id, import.meta.url), 'utf8'))
    const required = new Set(Object.values(model.files).flat())
    for (const node of Object.values(graph)) {
      for (const value of Object.values(node.inputs)) {
        if (typeof value === 'string' && value.endsWith('.safetensors')) {
          assert.ok(required.has(value), `${model.label} does not check ${value}`)
        }
      }
    }
  }
})

test('video reference and motion capabilities require their optional weights', async () => {
  const empty = await modelsWith({})
  assert.deepEqual(empty.videoCapabilitiesAtom.get(), { references: false, motion: false })
  const references = await modelsWith({ diffusion_models: ['minimax_h3_ref2va_pruned_int8_convrot.safetensors'] })
  assert.deepEqual(references.videoCapabilitiesAtom.get(), { references: true, motion: false })
  const motion = await modelsWith({
    diffusion_models: ['minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'rt_detr_v4-x-hgnet_fp16.safetensors'],
    model_patches: ['minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors'],
    checkpoints: ['sdpose_wholebody_fp16.safetensors'],
  })
  assert.deepEqual(motion.videoCapabilitiesAtom.get(), { references: true, motion: true })
})

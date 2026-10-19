import { loadWorkflow, type PromptGraph, type RefKind } from './comfy'

const seed = () => Math.floor(Math.random() * 2 ** 31)

export interface Built { graph: PromptGraph; result: string }

export function annotated(src: string): string {
  const q = new URL(src, location.origin).searchParams
  const sub = q.get('subfolder')
  return `${sub ? `${sub}/` : ''}${q.get('filename')} [${q.get('type') || 'input'}]`
}

const MODEL_SCALE = 4

export async function upscaleGraph(image: string, w: number, h: number, factor: number): Promise<Built> {
  const g = await loadWorkflow('upscale-ultrasharp-4x.api.json')
  g['1'].inputs.image = image
  if (factor > MODEL_SCALE) {
    g['5'] = { class_type: 'ImageScaleBy', inputs: { image: ['1', 0], upscale_method: 'lanczos', scale_by: factor / MODEL_SCALE } }
    g['3'].inputs.image = ['5', 0]
  } else if (factor < MODEL_SCALE) {
    g['5'] = { class_type: 'ImageScale', inputs: { image: ['3', 0], upscale_method: 'lanczos', width: Math.round(w * factor), height: Math.round(h * factor), crop: 'disabled' } }
    g['4'].inputs.images = ['5', 0]
  }
  return { graph: g, result: '4' }
}

const REFINE_LONG = 2048
const snap16 = (v: number) => Math.max(16, Math.round(v / 16) * 16)

export async function creativeUpscaleGraph(image: string, factor: number, w: number, h: number, style: string, strength: number): Promise<Built> {
  const g = await upscaleGraph(image, w, h, MODEL_SCALE).then((b) => b.graph)
  const t2i = await loadWorkflow('qwen-image-2.1-t2i.api.json')
  const k = Math.min(factor, REFINE_LONG / Math.max(w, h))
  const [tw, th] = [Math.round(w * factor), Math.round(h * factor)]
  for (const id of ['1', '3', '4', '6', '7', '8']) g[`r${id}`] = t2i[id]
  g.r5 = { class_type: 'ImageScale', inputs: { image: ['3', 0], upscale_method: 'lanczos', width: snap16(w * k), height: snap16(h * k), crop: 'disabled' } }
  g.r9 = { class_type: 'VAEEncode', inputs: { pixels: ['r5', 0], vae: ['r4', 0] } }
  g.r6.inputs = { ...g.r6.inputs, prompt: `Highly detailed, sharp, clean high resolution image${style ? `, ${style}` : ''}.`, clip: ['r3', 0] }
  g.r7.inputs = { ...g.r7.inputs, seed: seed(), denoise: strength, model: ['r1', 0], positive: ['r6', 0], negative: ['r6', 1], latent_image: ['r9', 0] }
  g.r8.inputs = { samples: ['r7', 0], vae: ['r4', 0] }
  g['4'].inputs.images = ['r8', 0]
  if (snap16(w * k) !== tw || snap16(h * k) !== th) {
    g.r10 = { class_type: 'ImageScale', inputs: { image: ['r8', 0], upscale_method: 'lanczos', width: tw, height: th, crop: 'disabled' } }
    g['4'].inputs.images = ['r10', 0]
  }
  return { graph: g, result: '4' }
}

export const VIDEO_TARGETS: [string, number][] = [['1080p', 1920], ['2K', 2560], ['4K', 3840]]
const even = (v: number) => Math.round(v / 2) * 2

export function cutoutVideoGraph(video: string): Built {
  const graph: PromptGraph = {
    v1: { class_type: 'LoadVideo', inputs: { file: video } },
    v2: { class_type: 'GetVideoComponents', inputs: { video: ['v1', 0] } },
    v3: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    v4: { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['v3', 0], image: ['v2', 0] } },
    v5: { class_type: 'MaskToImage', inputs: { mask: ['v4', 0] } },
    v6: { class_type: 'ImageBlend', inputs: { image1: ['v2', 0], image2: ['v5', 0], blend_factor: 1, blend_mode: 'multiply' } },
    v7: { class_type: 'CreateVideo', inputs: { images: ['v6', 0], audio: ['v2', 1], fps: ['v2', 2] } },
    v8: { class_type: 'SaveVideo', inputs: { video: ['v7', 0], filename_prefix: 'comfyart/video', format: 'auto', codec: 'auto' } },
  }
  return { graph, result: 'v8' }
}

export async function upscaleVideoGraph(video: string, w: number, h: number, long: number): Promise<Built> {
  const k = long / Math.max(w, h)
  const graph: PromptGraph = {
    v1: { class_type: 'LoadVideo', inputs: { file: video } },
    v2: { class_type: 'GetVideoComponents', inputs: { video: ['v1', 0] } },
    v3: { class_type: 'ImageScaleBy', inputs: { image: ['v2', 0], upscale_method: 'area', scale_by: k / 4 } },
    v4: { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } },
    v5: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['v4', 0], image: ['v3', 0] } },
    v6: { class_type: 'ImageScale', inputs: { image: ['v5', 0], upscale_method: 'lanczos', width: even(w * k), height: even(h * k), crop: 'disabled' } },
    v7: { class_type: 'CreateVideo', inputs: { images: ['v6', 0], audio: ['v2', 1], fps: ['v2', 2] } },
    v8: { class_type: 'SaveVideo', inputs: { video: ['v7', 0], filename_prefix: 'comfyart/video', format: 'auto', codec: 'auto' } },
  }
  return { graph, result: 'v8' }
}

export async function cutoutGraph(image: string): Promise<Built> {
  const g = await loadWorkflow('cutout-birefnet.api.json')
  g['17'].inputs.image = image
  return { graph: g, result: '18' }
}

export async function eraseGraph(image: string, mask: string): Promise<Built> {
  const g = await loadWorkflow('erase-lama.api.json')
  g['1'].inputs.image = image
  g['2'].inputs.image = mask
  g['5'].inputs.seed = seed()
  return { graph: g, result: '6' }
}

export async function expandGraph(image: string, pads: { l: number; t: number; r: number; b: number }, prompt: string): Promise<Built> {
  const g = await loadWorkflow('outpaint-qwen-image-2.1.api.json')
  g['11'].inputs.image = image
  for (const id of ['21', '27']) Object.assign(g[id].inputs, { left: pads.l, top: pads.t, right: pads.r, bottom: pads.b })
  g['25'].inputs.string_b = prompt
  g['7'].inputs.seed = seed()
  return { graph: g, result: '9' }
}

export async function editGraph(image: string, prompt: string): Promise<Built> {
  const g = await loadWorkflow('edit-qwen-image-2.1.api.json')
  g['11'].inputs.image = image
  g['6'].inputs.prompt = prompt
  g['7'].inputs.seed = seed()
  return { graph: g, result: '9' }
}

export async function moveGraph(image: string, mask: string, from: Crop, to: { x: number; y: number }): Promise<Built> {
  const g = await loadWorkflow('erase-lama.api.json')
  g['1'].inputs.image = image
  g['2'].inputs.image = mask
  g['5'].inputs.seed = seed()
  g['7'] = { class_type: 'GrowMask', inputs: { mask: ['2', 0], expand: 12, tapered_corners: true } }
  g['5'].inputs.mask = ['7', 0]
  g['8'] = { class_type: 'ImageCrop', inputs: { image: ['1', 0], width: from.w, height: from.h, x: from.x, y: from.y } }
  g['9'] = { class_type: 'CropMask', inputs: { mask: ['2', 0], x: from.x, y: from.y, width: from.w, height: from.h } }
  g['10'] = { class_type: 'ImageCompositeMasked', inputs: { destination: ['5', 0], source: ['8', 0], x: Math.max(0, to.x), y: Math.max(0, to.y), resize_source: false, mask: ['9', 0] } }
  g['6'].inputs.images = ['10', 0]
  return { graph: g, result: '6' }
}

export async function styleGraph(image: string, style: string, ref: string | null): Promise<Built> {
  const g = await loadWorkflow('edit-qwen-image-2.1.api.json')
  g['11'].inputs.image = image
  if (ref) {
    g['12'] = { class_type: 'LoadImage', inputs: { image: ref } }
    g['6'].inputs['images.image_2'] = ['12', 0]
  }
  g['6'].inputs.prompt = ref
    ? 'Redraw image 1 in the visual style of image 2: palette, brushwork, texture and rendering. Keep the composition, subjects and layout of image 1.'
    : `Redraw this image in ${style} style. Keep the composition, subjects and layout unchanged.`
  g['7'].inputs.seed = seed()
  return { graph: g, result: '9' }
}

export interface Crop { x: number; y: number; w: number; h: number }

export async function touchGraph(image: string, crop: Crop, mask: string, prompt: string): Promise<Built> {
  const g = await loadWorkflow('edit-qwen-image-2.1.api.json')
  g['20'] = { class_type: 'LoadImage', inputs: { image } }
  g['11'] = { class_type: 'ImageCrop', inputs: { image: ['20', 0], width: crop.w, height: crop.h, x: crop.x, y: crop.y } }
  g['21'] = { class_type: 'ImageScale', inputs: { image: ['8', 0], upscale_method: 'bicubic', width: crop.w, height: crop.h, crop: 'disabled' } }
  g['22'] = { class_type: 'LoadImageMask', inputs: { image: mask, channel: 'alpha' } }
  g['23'] = { class_type: 'ImageCompositeMasked', inputs: { destination: ['20', 0], source: ['21', 0], x: crop.x, y: crop.y, resize_source: false, mask: ['22', 0] } }
  g['6'].inputs.prompt = prompt
  g['7'].inputs.seed = seed()
  g['9'].inputs.images = ['23', 0]
  return { graph: g, result: '9' }
}

const AZIMUTHS: [number, string][] = [
  [0, 'front view'], [45, 'front-right quarter view'], [90, 'right side view'], [135, 'back-right quarter view'],
  [180, 'back view'], [225, 'back-left quarter view'], [270, 'left side view'], [315, 'front-left quarter view'],
]

export function anglePrompt(horizontal: number, vertical: number, zoom: number): string {
  const az = ((horizontal % 360) + 360) % 360
  const azKw = AZIMUTHS.reduce((best, cur) => {
    const d = (a: number) => Math.min(Math.abs(az - a), 360 - Math.abs(az - a))
    return d(cur[0]) < d(best[0]) ? cur : best
  })[1]
  const elKw = vertical <= -15 ? 'low-angle shot' : vertical <= 15 ? 'eye-level shot' : vertical <= 45 ? 'elevated shot' : 'high-angle shot'
  const distKw = zoom >= 7 ? 'close-up' : zoom >= 3 ? 'medium shot' : 'wide shot'
  return `<qma> ${azKw} ${elKw} ${distKw}`
}

export async function anglesGraph(image: string, horizontal: number, vertical: number, zoom: number): Promise<Built> {
  const g = await loadWorkflow('multiangle-qwen-image-2.1.api.json')
  g['11'].inputs.image = image
  g['6'].inputs.prompt = anglePrompt(horizontal, vertical, zoom)
  g['7'].inputs.seed = seed()
  return { graph: g, result: '9' }
}

export async function layersGraph(image: string, layers: number, prompt: string): Promise<Built> {
  const g = await loadWorkflow('layers-qwen-image-layered.api.json')
  g['74'].inputs.image = image
  g['82'].inputs.largest_size = 1024
  g['116'].inputs.value = prompt || 'An image with a foreground subject and a background.'
  g['83:118'].inputs.layers = layers
  g['83:3'].inputs.seed = seed()
  return { graph: g, result: '60' }
}

const snap32 = (v: number) => Math.max(32, Math.round(v / 32) * 32)
export const VIDEO_AREAS: Record<string, number> = { '768p': 1344 * 768, '384p': 672 * 384, '512p': 896 * 512, '1080p': 1920 * 1088 }
const H3_AREA = VIDEO_AREAS['768p']

export function videoSize(aspect: number, area = H3_AREA): [number, number] {
  return [snap32(Math.sqrt(area * aspect)), snap32(Math.sqrt(area / aspect))]
}

const MOTION = 'Subtle seamless motion. Keep the composition, text and layout unchanged.'

export async function t2vGraph(prompt: string, aspect: number, duration: number, area = H3_AREA): Promise<Built> {
  const g = await loadWorkflow('t2v-minimax-h3.api.json')
  const [w, h] = videoSize(aspect, area)
  Object.assign(g['131'].inputs, { prompt, width: w, height: h })
  g['133'].inputs.value = duration
  g['129'].inputs.noise_seed = seed()
  return { graph: g, result: '92' }
}

async function i2vGraph(prompt: string, aspect: number, duration: number, area = H3_AREA): Promise<PromptGraph> {
  const g = await loadWorkflow('i2v-minimax-h3.api.json')
  const [w, h] = videoSize(aspect, area)
  Object.assign(g['105:104'].inputs, { prompt, width: w, height: h })
  g['105:111'].inputs.value = duration
  g['105:15'].inputs.noise_seed = seed()
  return g
}

export async function imageToVideoGraph(image: string | null, prompt: string, aspect: number, duration: number, last: string | null, area: number): Promise<Built> {
  const g = await i2vGraph(prompt || MOTION, aspect, duration, area)
  if (image) g['114'].inputs.image = image
  else {
    delete g['114']
    delete g['105:104'].inputs.first_frame
  }
  if (last) {
    g.last = { class_type: 'LoadImage', inputs: { image: last } }
    g['105:104'].inputs.last_frame = ['last', 0]
  }
  return { graph: g, result: '92' }
}

export interface MediaRef { file: string; kind: RefKind }

export const MAX_VIDEO_REF_KINDS: Record<RefKind, number> = { image: 9, video: 3, audio: 3 }
const H3_TAGS: Record<RefKind, string> = { image: 'Picture', video: 'Video', audio: 'Audio' }

function refLead(refs: MediaRef[]): string {
  const tags = (kind: RefKind) => refs.filter((r) => r.kind === kind).map((_, i) => `<${H3_TAGS[kind]} ${i + 1}>`)
  const images = tags('image')
  const others = [...tags('video'), ...tags('audio')]
  return [
    images.length && `Use ${images.join(', ')} as the reference${images.length > 1 ? 's' : ''} and keep ${images.length > 1 ? 'them' : 'it'} exactly as shown.`,
    others.length && `Use ${others.join(', ')} as reference${others.length > 1 ? 's' : ''}.`,
  ].filter(Boolean).join(' ')
}

export async function r2vGraph(refs: MediaRef[], prompt: string, aspect: number, duration: number, area: number): Promise<Built> {
  const g = await loadWorkflow('r2v-minimax-h3.api.json')
  const [w, h] = videoSize(aspect, area)
  Object.assign(g['136'].inputs, { prompt: [refLead(refs), prompt].filter(Boolean).join('\n'), width: w, height: h })
  delete g['137']
  const count: Record<RefKind, number> = { image: 0, video: 0, audio: 0 }
  refs.forEach(({ file, kind }, i) => {
    const n = count[kind]++
    if (kind === 'image') {
      g[`r${i}`] = { class_type: 'LoadImage', inputs: { image: file } }
      g['136'].inputs[`ref_images.ref_image_${n}`] = [`r${i}`, 0]
    } else if (kind === 'video') {
      g[`r${i}`] = { class_type: 'LoadVideo', inputs: { file } }
      g[`c${i}`] = { class_type: 'GetVideoComponents', inputs: { video: [`r${i}`, 0] } }
      g['136'].inputs[`ref_videos.ref_video_${n}`] = [`c${i}`, 0]
    } else {
      g[`r${i}`] = { class_type: 'LoadAudio', inputs: { audio: file } }
      g['136'].inputs[`ref_audios.ref_audio_${n}`] = [`r${i}`, 0]
    }
  })
  g['132'].inputs.value = duration
  g['129'].inputs.noise_seed = seed()
  return { graph: g, result: '92' }
}

export async function motionGraph(image: string, video: string, prompt: string, aspect: number, duration: number, area: number): Promise<Built> {
  const built = await r2vGraph([{ file: image, kind: 'image' }], `${prompt ? `${prompt}\n` : ''}The character from <Picture 1> performs exactly the body motion of the control pose video.`, aspect, duration, area)
  Object.assign(built.graph, {
    m1: { class_type: 'LoadVideo', inputs: { file: video } },
    m2: { class_type: 'Video Slice', inputs: { video: ['m1', 0], start_time: 0, duration, strict_duration: false } },
    m3: { class_type: 'GetVideoComponents', inputs: { video: ['m2', 0] } },
    m4: { class_type: 'ResizeImageMaskNode', inputs: { input: ['m3', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1024, scale_method: 'lanczos' } },
    m5: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdpose_wholebody_fp16.safetensors' } },
    m6: { class_type: 'UNETLoader', inputs: { unet_name: 'rt_detr_v4-x-hgnet_fp16.safetensors', weight_dtype: 'default' } },
    m7: { class_type: 'RTDETR_detect', inputs: { model: ['m6', 0], image: ['m4', 0], threshold: 0.5, class_name: 'person', max_detections: 2 } },
    m8: { class_type: 'SDPoseKeypointExtractor', inputs: { model: ['m5', 0], vae: ['m5', 2], image: ['m4', 0], batch_size: 16, bboxes: ['m7', 0] } },
    m9: { class_type: 'SDPoseDrawKeypoints', inputs: { keypoints: ['m8', 0], draw_body: true, draw_hands: true, draw_face: true, draw_feet: true, stick_width: 4, face_point_size: 2, score_threshold: 0.5, draw_head: true } },
    m10: { class_type: 'ModelPatchLoader', inputs: { name: 'minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors' } },
    m11: { class_type: 'MiniMaxH3FunControlNetApply', inputs: { model: ['127', 0], model_patch: ['m10', 0], vae: ['119', 0], strength: 1, start_percent: 0, end_percent: 1, control_video: ['m9', 0] } },
  })
  built.graph['124'].inputs.model = ['m11', 0]
  built.graph['126'].inputs.model = ['m11', 0]
  return built
}

export async function lipSyncGraph(image: string, audio: string, prompt: string, aspect: number, seconds: number, area: number): Promise<Built> {
  const g = await i2vGraph(`${prompt || 'The person talks naturally to the camera.'} The lips move in sync with the speech.`, aspect, seconds, area)
  g['114'].inputs.image = image
  g.s1 = { class_type: 'LoadAudio', inputs: { audio } }
  g.s2 = { class_type: 'MiniMaxH3AddGuide', inputs: { positive: ['105:104', 0], latent: ['105:104', 1], vae: ['105:11', 0], audio_vae: ['105:24', 0], audio: ['s1', 0], frame_idx: 0 } }
  g['105:16'].inputs.conditioning = ['s2', 0]
  return { graph: g, result: '92' }
}

const MOTION_LONG = 768
const MOTION_SECONDS = 3

export async function animateGraph(image: string, width: number, height: number, prompt: string, loop: boolean): Promise<Built> {
  const g = await i2vGraph(prompt || MOTION, width / height, MOTION_SECONDS)
  g['114'].inputs.image = image
  if (loop) g['105:104'].inputs.last_frame = ['114', 0]
  delete g['92']
  delete g['105:91']
  const k = Math.min(1, MOTION_LONG / Math.max(width, height))
  g.a1 = { class_type: 'ImageScale', inputs: { image: ['105:10', 0], upscale_method: 'lanczos', width: Math.round(width * k), height: Math.round(height * k), crop: 'disabled' } }
  g.a2 = { class_type: 'SaveAnimatedWEBP', inputs: { images: ['a1', 0], filename_prefix: 'comfyart/motion', fps: 24, lossless: false, quality: 85, method: 'default' } }
  return { graph: g, result: 'a2' }
}

export async function extendGraph(video: string, width: number, height: number, prompt: string, duration: number): Promise<Built> {
  const g = await i2vGraph(prompt || 'Continue the shot naturally.', width / height, duration)
  delete g['114']
  Object.assign(g, {
    v1: { class_type: 'LoadVideo', inputs: { file: video } },
    v2: { class_type: 'GetVideoComponents', inputs: { video: ['v1', 0] } },
    v3: { class_type: 'ImageFromBatch', inputs: { image: ['v2', 0], batch_index: -1, length: 1 } },
    v4: { class_type: 'ImageFromBatch', inputs: { image: ['105:10', 0], batch_index: 1, length: 4096 } },
    v5: { class_type: 'ImageBatch', inputs: { image1: ['v2', 0], image2: ['v4', 0] } },
    v6: { class_type: 'AudioConcat', inputs: { audio1: ['v10', 0], audio2: ['105:23', 0], direction: 'after' } },
    v7: { class_type: 'GetImageSize', inputs: { image: ['v2', 0] } },
    v8: { class_type: 'ComfyMathExpression', inputs: { expression: 'a / b', 'values.a': ['v7', 2], 'values.b': ['v2', 2] } },
    v9: { class_type: 'EmptyAudio', inputs: { duration: ['v8', 0], sample_rate: 44100, channels: 2 } },
    v10: { class_type: 'AudioMerge', inputs: { audio1: ['v9', 0], audio2: ['v2', 1], merge_method: 'add' } },
  })
  g['105:104'].inputs.first_frame = ['v3', 0]
  Object.assign(g['105:91'].inputs, { images: ['v5', 0], audio: ['v6', 0], fps: ['v2', 2] })
  return { graph: g, result: '92' }
}

export function samGraph(image: string, target: { text: string } | { x: number; y: number } | { points: { x: number; y: number }[] }): Built {
  const graph: PromptGraph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sam3.1_multiplex_fp16.safetensors' } },
    '2': { class_type: 'LoadImage', inputs: { image } },
    '4': { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], threshold: 0.4, refine_iterations: 2, individual_masks: false } },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'PreviewImage', inputs: { images: ['5', 0] } },
  }
  if ('text' in target) {
    graph['3'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: target.text } }
    graph['4'].inputs.conditioning = ['3', 0]
  } else {
    const points = 'points' in target ? target.points : [target]
    graph['4'].inputs.positive_coords = JSON.stringify(points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })))
  }
  return { graph, result: '6' }
}

export interface Scene { prompt: string; duration: number }

const SCENE_NODES = ['105:104', '105:107', '105:111', '105:15', '105:16', '105:14', '105:10', '105:23']

export async function storyboardGraph(scenes: Scene[], aspect: number, firstFrame: string | null): Promise<Built> {
  const t = await loadWorkflow('i2v-minimax-h3.api.json')
  const [w, h] = videoSize(aspect)
  const g: PromptGraph = {}
  for (const [id, node] of Object.entries(t)) if (!SCENE_NODES.includes(id) && id !== '114') g[id] = node
  if (firstFrame) g['114'] = { class_type: 'LoadImage', inputs: { image: firstFrame } }
  const local = (i: number, id: string) => `s${i}:${id}`
  scenes.forEach((scene, i) => {
    for (const id of SCENE_NODES) {
      const inputs = Object.fromEntries(Object.entries(t[id].inputs).map(([k, v]) => [k, Array.isArray(v) && SCENE_NODES.includes(String(v[0])) ? [local(i, String(v[0])), v[1]] : v]))
      g[local(i, id)] = { class_type: t[id].class_type, inputs }
    }
    const node = g[local(i, '105:104')].inputs
    Object.assign(node, { prompt: scene.prompt, width: w, height: h })
    delete node.first_frame
    if (i > 0) {
      g[`last${i}`] = { class_type: 'ImageFromBatch', inputs: { image: [local(i - 1, '105:10'), 0], batch_index: -1, length: 1 } }
      node.first_frame = [`last${i}`, 0]
    } else if (firstFrame) node.first_frame = ['114', 0]
    g[local(i, '105:111')].inputs.value = scene.duration
    g[local(i, '105:15')].inputs.noise_seed = seed()
  })
  let frames: [string, number] = [local(0, '105:10'), 0]
  let audio: [string, number] = [local(0, '105:23'), 0]
  for (let i = 1; i < scenes.length; i++) {
    g[`trim${i}`] = { class_type: 'ImageFromBatch', inputs: { image: [local(i, '105:10'), 0], batch_index: 1, length: 4096 } }
    g[`join${i}`] = { class_type: 'ImageBatch', inputs: { image1: frames, image2: [`trim${i}`, 0] } }
    g[`audio${i}`] = { class_type: 'AudioConcat', inputs: { audio1: audio, audio2: [local(i, '105:23'), 0], direction: 'after' } }
    frames = [`join${i}`, 0]
    audio = [`audio${i}`, 0]
  }
  Object.assign(g['105:91'].inputs, { images: frames, audio })
  return { graph: g, result: '92' }
}

export function samBoxesGraph(image: string, boxes: Crop[]): Built {
  const graph: PromptGraph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sam3.1_multiplex_fp16.safetensors' } },
    '2': { class_type: 'LoadImage', inputs: { image } },
  }
  let batch: [string, number] | null = null
  boxes.forEach((b, i) => {
    graph[`d${i}`] = { class_type: 'SAM3_Detect', inputs: { model: ['1', 0], image: ['2', 0], threshold: 0.4, refine_iterations: 2, individual_masks: false, bboxes: { x: b.x, y: b.y, width: b.w, height: b.h } } }
    graph[`m${i}`] = { class_type: 'MaskToImage', inputs: { mask: [`d${i}`, 0] } }
    if (batch) graph[`b${i}`] = { class_type: 'ImageBatch', inputs: { image1: batch, image2: [`m${i}`, 0] } }
    batch = batch ? [`b${i}`, 0] : [`m${i}`, 0]
  })
  graph['9'] = { class_type: 'PreviewImage', inputs: { images: batch! } }
  return { graph, result: '9' }
}

import { atom } from 'tldraw'

import { api, loadModelPaths, readUserJson, writeUserJson } from './comfy'
import { t } from './i18n'

export interface ModelDef {
  id: string
  label: string
  desc: string
  files: Record<string, string[]>
  video?: boolean
  refs?: 'qwen' | 'latent'
  prompt?: string
  steps?: [string, Record<string, number>]
  sizes?: string[]
  vae?: string
  caption?: string
  control?: string
  negative?: [string, string]
  lora?: string
}

export const IMAGE_MODELS: ModelDef[] = [
  {
    id: 'qwen-image-2.1-t2i.api.json', label: 'Qwen Image 2.1', desc: t('models.highOverallQualityAccurateChinese'),
    files: { diffusion_models: ['qwen_image_2.1_int8_convrot.safetensors'], text_encoders: ['qwen3vl_8b_int8_convrot.safetensors'], vae: ['qwen_image_2.1_vae_bf16.safetensors'] },
    refs: 'qwen', prompt: 'prompt', steps: ['7', { fast: 12, standard: 25, high: 40 }], sizes: ['5'], vae: '4', lora: 'qwen-image-2.1',
  },
  {
    id: 'z-image-turbo-t2i.api.json', label: 'Z-Image Turbo', desc: t('models.fast8StepGenerationGreat'),
    files: { diffusion_models: ['z_image_turbo_bf16.safetensors'], text_encoders: ['qwen_3_4b.safetensors'], vae: ['ae.safetensors'] },
    prompt: 'text', sizes: ['5'], vae: '3', lora: 'z-image',
  },
  {
    id: 'flux2-klein-9b-t2i.api.json', label: 'Flux.2 Klein 9B', desc: t('models.fast4StepGenerationSupports'),
    files: { diffusion_models: ['flux-2-klein-9b-nvfp4.safetensors'], text_encoders: ['qwen_3_8b_fp8mixed.safetensors'], vae: ['flux2-vae.safetensors'] },
    refs: 'latent', prompt: 'text', sizes: ['5', '13'], vae: '3', lora: 'flux2-klein',
  },
  {
    id: 'qwen-image-2512-t2i.api.json', label: 'Qwen Image 2512', desc: t('models.solidDetailAndCompositionSupports'),
    files: { diffusion_models: ['qwen_image_2512_fp8_e4m3fn.safetensors'], text_encoders: ['qwen_2.5_vl_7b_fp8_scaled.safetensors'], vae: ['qwen_image_vae.safetensors'] },
    prompt: 'text', steps: ['7', { fast: 20, standard: 30, high: 50 }], sizes: ['5'], vae: '3', control: 'Qwen-Image-2512-Fun-Controlnet-Union-2602.safetensors', negative: ['10', 'text'], lora: 'qwen-image',
  },
  {
    id: 'ideogram4-t2i.api.json', label: 'Ideogram 4', desc: t('models.greatAtLayoutLogosAnd'),
    files: { diffusion_models: ['ideogram4_fp8_scaled.safetensors', 'ideogram4_unconditional_fp8_scaled.safetensors'], text_encoders: ['qwen3vl_8b_fp8_scaled.safetensors'], vae: ['flux2-vae.safetensors'] },
    prompt: 'text', caption: 'ideogram4-caption.json',
    steps: ['13', { fast: 12, standard: 20, high: 48 }], sizes: ['5', '13'], vae: '3',
  },
]

export const VIDEO_MODELS: ModelDef[] = [
  { id: 't2v-minimax-h3.api.json', label: 'MiniMax H3', desc: t('models.syncedAudioAndVideoSupports'),
    files: { diffusion_models: ['minimax_h3_fl2va_pruned_int8_convrot.safetensors'], text_encoders: ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'], vae: ['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors'], loras: ['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'] }, video: true },
]

export const isVideo = (workflow: string) => VIDEO_MODELS.some((m) => m.id === workflow)
export const modelOf = (workflow: string) => [...IMAGE_MODELS, ...VIDEO_MODELS].find((m) => m.id === workflow)

export interface ModelPrefs { auto: boolean; enabled: string[] }

const FILE = 'comfyart/models.json'
const ALL = [...IMAGE_MODELS, ...VIDEO_MODELS].map((m) => m.id)

export const modelPrefsAtom = atom<ModelPrefs>('model prefs', { auto: true, enabled: ALL })
export const installedAtom = atom<string[] | null>('installed models', null)
export const videoCapabilitiesAtom = atom('video capabilities', { references: false, motion: false })

export async function loadModels() {
  const models = [...IMAGE_MODELS, ...VIDEO_MODELS]
  const categories = [...new Set([...models.flatMap((m) => Object.keys(m.files)), 'model_patches', 'checkpoints'])]
  const [prefs, paths, folders] = await Promise.all([
    readUserJson<ModelPrefs | null>(FILE, null), loadModelPaths(),
    Promise.all(categories.map(async (category) => {
      const response = await api(`/models/${category}`)
      const names: string[] = response.ok ? await response.json() : []
      return [category, names] as const
    })),
  ])
  if (prefs) modelPrefsAtom.set(prefs)
  const available = Object.fromEntries(folders)
  const present = (required: Record<string, string[]>) => Object.entries(required).every(([category, files]) =>
    files.every((file) => available[category].includes(file) || available[category].includes(paths[file])))
  installedAtom.set(models.filter((m) => present(m.files)).map((m) => m.id))
  const references = present({ diffusion_models: ['minimax_h3_ref2va_pruned_int8_convrot.safetensors'] })
  videoCapabilitiesAtom.set({ references, motion: references && present({
    model_patches: ['minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors'],
    checkpoints: ['sdpose_wholebody_fp16.safetensors'], diffusion_models: ['rt_detr_v4-x-hgnet_fp16.safetensors'],
  }) })
}

export async function saveModelPrefs(prefs: ModelPrefs) {
  modelPrefsAtom.set(prefs)
  await writeUserJson(FILE, prefs)
}

export function installedModels(video: boolean): ModelDef[] {
  return (video ? VIDEO_MODELS : IMAGE_MODELS).filter((m) => isInstalled(m.id))
}

export function agentModels(video: boolean): ModelDef[] {
  const { auto, enabled } = modelPrefsAtom.get()
  const list = installedModels(video)
  const picked = auto ? list : list.filter((m) => enabled.includes(m.id))
  return picked.length ? picked : list.length ? list.slice(0, 1) : (video ? VIDEO_MODELS : IMAGE_MODELS).slice(0, 1)
}

export function isInstalled(id: string): boolean {
  const installed = installedAtom.get()
  return !installed || installed.includes(id)
}

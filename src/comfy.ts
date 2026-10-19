import { CLIENT_ID } from './ws'

const POLL_MS = 1500

export type PromptGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export interface ImageRef { filename: string; subfolder: string; type: string; metadata?: { width?: number; height?: number } }

function comfyUser(): string | null {
  try { return localStorage.getItem('Comfy.userId') } catch { return null }
}

export function api(path: string, init?: RequestInit) {
  const user = comfyUser()
  return fetch(`/api${path}`, user ? { ...init, headers: { ...init?.headers, 'Comfy-User': user } } : init)
}

const userFile = (path: string) => `/userdata/${encodeURIComponent(path)}`

export async function readUserText(path: string): Promise<string | null> {
  const res = await api(userFile(path))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`read ${path} failed: ${res.status}`)
  return res.text()
}

export async function readUserJson<T>(path: string, fallback: T): Promise<T> {
  const text = await readUserText(path)
  return text === null ? fallback : JSON.parse(text)
}

export async function writeUserText(path: string, body: string) {
  const res = await api(`${userFile(path)}?overwrite=true&full_info=false`, { method: 'POST', body })
  if (!res.ok) throw new Error(`save ${path} failed: ${res.status}`)
}

export const writeUserJson = (path: string, data: unknown) => writeUserText(path, JSON.stringify(data))

export async function listUserFiles(dir: string, recurse = false): Promise<string[]> {
  const res = await api(`/userdata?dir=${encodeURIComponent(dir)}${recurse ? '&recurse=true&split=false&full_info=false' : ''}`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`list ${dir} failed: ${res.status}`)
  return ((await res.json()) as string[]).map((f) => f.replaceAll('\\', '/'))
}

export async function deleteUserFile(path: string) {
  await api(userFile(path), { method: 'DELETE' })
}

export function viewUrl(ref: ImageRef): string {
  const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type })
  return `/api/view?${q}`
}

export function thumbUrl(src: string, max = 256): string {
  return `/comfyart/thumb?${new URLSearchParams({ url: src, max: String(max) })}`
}

export function refFromUrl(src: string): ImageRef {
  const q = new URL(src, location.origin).searchParams
  return { filename: q.get('filename') ?? '', subfolder: q.get('subfolder') ?? '', type: q.get('type') ?? 'input' }
}

export const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus']
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv']
export type RefKind = 'image' | 'video' | 'audio'

export function refKind(src: string): RefKind {
  const ext = refFromUrl(src).filename.toLowerCase().split('.').pop() ?? ''
  return VIDEO_EXTS.includes(ext) ? 'video' : AUDIO_EXTS.includes(ext) ? 'audio' : 'image'
}

export function mediaMeta(src: string, kind: 'video' | 'audio'): Promise<{ seconds: number; aspect: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind)
    el.preload = 'metadata'
    el.onloadedmetadata = () => resolve({ seconds: el.duration, aspect: el instanceof HTMLVideoElement ? el.videoWidth / el.videoHeight : 1 })
    el.onerror = () => reject(new Error(`cannot read ${src}`))
    el.src = src
  })
}

export async function uploadImage(file: Blob, name: string): Promise<ImageRef> {
  const body = new FormData()
  body.append('image', file, name)
  body.append('subfolder', 'comfyart')
  body.append('type', 'input')
  const res = await api('/upload/image', { method: 'POST', body })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  const data = await res.json()
  return { filename: data.name, subfolder: data.subfolder ?? 'comfyart', type: data.type ?? 'input' }
}

export async function loadWorkflow(name: string): Promise<PromptGraph> {
  const res = await fetch(`/comfyart/workflows/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`workflow ${name} not found`)
  return res.json()
}

let modelPaths: Record<string, string> = {}

export async function loadModelPaths(): Promise<Record<string, string>> {
  const res = await fetch('/comfyart/model-paths')
  modelPaths = res.ok ? await res.json() : {}
  return modelPaths
}

function withModelPaths(prompt: PromptGraph): PromptGraph {
  return Object.fromEntries(Object.entries(prompt).map(([id, node]) => [id, {
    ...node,
    inputs: Object.fromEntries(Object.entries(node.inputs).map(([k, v]) => [k, typeof v === 'string' && v in modelPaths ? modelPaths[v] : v])),
  }]))
}

export async function queuePrompt(prompt: PromptGraph): Promise<string> {
  if (Object.values(prompt).some((node) => node.class_type.startsWith('MiniMaxH3'))) {
    const prep = await api('/comfyart/video/prepare', { method: 'POST' })
    if (!prep.ok) throw new Error((await prep.json()).error ?? `video preparation failed: ${prep.status}`)
  }
  const res = await api('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: withModelPaths(prompt), client_id: CLIENT_ID }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `queue failed: ${res.status}`)
  return String(body.prompt_id)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForOutput<T>(promptId: string, node: string, pick: (out: Record<string, any>) => T | null): Promise<T> {
  const started = Date.now()
  for (;;) {
    const hist = (await (await api(`/history/${promptId}`)).json())[promptId]
    if (hist) {
      const err = (hist.status?.messages ?? []).find((m: any) => m[0] === 'execution_error' || m[0] === 'execution_interrupted')
      if (err) {
        const message = String(err[1]?.exception_message ?? (err[0] === 'execution_interrupted' ? '生成任务已终止，可以重试此镜头。' : 'execution failed')).trim()
        const node = String(err[1]?.node_type ?? err[1]?.node_id ?? '')
        throw new Error(`${node ? `${node}: ` : ''}${message}${message.includes('Fault failed: 2') ? '\n模型权重调入显存失败，本镜头未完成。请重试本镜头；已完成镜头会保留。' : ''}`)
      }
      const value = hist.outputs?.[node] ? pick(hist.outputs[node]) : null
      if (value) return value
      if (hist.status?.completed) throw new Error('the workflow produced no output')
    } else if (Date.now() - started > 30000) {
      const queue = await (await api('/queue')).json()
      if (![...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some((job: unknown[]) => job[1] === promptId)) throw new Error('任务记录已丢失（服务可能已重启）。请重试此镜头；已完成的镜头仍保留。')
    }
    await sleep(POLL_MS)
  }
}

export function waitForImages(promptId: string, node: string): Promise<ImageRef[]> {
  return waitForOutput(promptId, node, (out) => {
    const items = [...(out.images ?? []), ...(out.videos ?? []), ...(out.gifs ?? []), ...(out.audio ?? []), ...(out['3d'] ?? [])]
    return items.length ? items as ImageRef[] : null
  })
}

export function waitForText(promptId: string, node: string): Promise<string> {
  return waitForOutput(promptId, node, (out) => (out.text ? String(out.text.join('')) : null))
}

export type StudioView = 'agent' | 'image' | 'video' | 'overview' | 'script' | 'cast' | 'production' | 'film' | 'canvas'
export const STUDIO_VIEWS: StudioView[] = ['agent', 'image', 'video', 'overview', 'script', 'cast', 'production', 'film', 'canvas']

export function viewMode(view: StudioView): 'agent' | 'image' | 'video' | null {
  return view === 'agent' || view === 'image' || view === 'video' ? view : null
}

export const isCanvasView = (view: StudioView) => view === 'canvas'

export interface StudioDraft { source?: string; direction?: string; castNotes?: Record<string, string> }
export interface StudioCue { role: string; text: string; speaker?: string; tone?: string }
export interface StudioScene { id: string; title: string; narration: StudioCue[] }
export interface StudioPlan {
  source?: string; result?: string; ratio?: string; resolution?: string
  shots?: { title: string; prompt: string; narration: string; src?: string; promptId?: string; error?: string; duration: number }[]
  production?: { id: string; title: string; native_only?: boolean; target_seconds?: number; image_count?: number; scenes: StudioScene[] }
}

export function studioView(value: string | null): StudioView {
  return STUDIO_VIEWS.includes(value as StudioView) ? value as StudioView : 'overview'
}

export function rolesOf(scenes: StudioScene[]) {
  const roles = new Map<string, { name: string; speaker?: string; tone?: string; cues: number; sample: string }>()
  for (const scene of scenes) for (const cue of scene.narration) {
    const role = roles.get(cue.role)
    if (role) role.cues++
    else roles.set(cue.role, { name: cue.role, speaker: cue.speaker, tone: cue.tone, cues: 1, sample: cue.text })
  }
  return [...roles.values()]
}

export function scenesOf(plan?: StudioPlan): StudioScene[] {
  return plan?.production?.scenes ?? plan?.shots?.map((s, i) => ({ id: String(i + 1).padStart(2, '0'), title: s.title, narration: s.narration ? [{ role: '旁白', text: s.narration }] : [] })) ?? []
}

// Draft revisions live separately from an existing generation plan and its finished media.
export function reviseDraft(meta: Record<string, unknown>, patch: Partial<StudioDraft>) {
  return { ...meta, studioDraft: { ...(meta.studioDraft as StudioDraft | undefined), ...patch } }
}

export function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '时长待确认'
  const s = Math.round(seconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

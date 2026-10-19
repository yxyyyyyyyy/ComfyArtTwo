import { api, viewUrl } from '../comfy'
import { listProjects, loadProject, type ProjectEntry } from '../projects'
import type { Production } from '../ui/EpisodeProduction'
import { scenesOf, type StudioPlan } from './story'

export interface StudioProject { entry: ProjectEntry; plan?: StudioPlan; poster?: string; stills: string[]; seconds?: number; warning?: string }

export async function loadStudioProjects(): Promise<StudioProject[]> {
  const entries = await listProjects()
  return Promise.all(entries.slice(0, 12).map(async (entry) => {
    try {
      const snap = await loadProject(entry.id)
      const doc = Object.values(snap?.document.store ?? {}).find((r) => r.typeName === 'document')
      const plan = doc?.typeName === 'document' ? doc.meta.videoStory as StudioPlan | undefined : undefined
      let production: Production | undefined
      if (plan?.production) {
        try {
          const response = await api(`/comfyart/video/production/${encodeURIComponent(plan.production.id)}`, { signal: AbortSignal.timeout(8000) })
          if (response.ok) production = await response.json()
        } catch { /* Saved project and final remain usable while the worker is unreachable. */ }
      }
      const stills = production?.scenes.flatMap((s) => s.panels.map(viewUrl)) ?? entry.covers ?? []
      return { entry, plan, poster: stills[0], stills, seconds: production?.seconds }
    } catch { return { entry, stills: entry.covers ?? [], poster: entry.covers?.[0], warning: '项目详情暂未读取，请打开项目重试。' } }
  }))
}

export function projectSubtitle(project: StudioProject) {
  const scenes = scenesOf(project.plan).length
  return project.warning ? '详情暂未读取' : project.plan?.result ? '成片已就绪' : scenes ? `${scenes} 个场景 · 继续制作` : '创作草稿'
}

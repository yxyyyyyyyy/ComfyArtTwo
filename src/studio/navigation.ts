import { uuid } from '../id'
import { newProject, openProject, projectUrl } from '../projects'
import type { StudioView } from './story'

export const DRAFT_PREFIX = 'mujian.draft.'

export function newCreativeProject(mode: 'agent' | 'image' | 'video' = 'agent') {
  newProject({ studio: mode, mode })
}

export function openStudioProject(id: string, view: StudioView = 'overview') {
  if (view === 'overview') openProject(id)
  else location.assign(projectUrl(id, { studio: view }))
}

export function newStudioProject(source = '', title = '', direction = '', castNotes: Record<string, string> = {}) {
  if (!source.trim()) { newProject({ studio: 'script' }); return }
  const token = uuid()
  sessionStorage.setItem(DRAFT_PREFIX + token, JSON.stringify({ source, title, direction, castNotes }))
  newProject({ studio: 'script', draft: token })
}

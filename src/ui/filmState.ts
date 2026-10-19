import { atom } from 'tldraw'

export const filmOpenAtom = atom<{ source: string; firstFrame?: string; direction?: string } | null>('video workbench', null)
export const filmActivityAtom = atom('video activity', { busy: false, label: '' })

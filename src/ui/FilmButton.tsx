import { useValue, type Editor } from 'tldraw'
import { filmOpenAtom, filmActivityAtom } from './filmState'
import { Icons } from './icons'

export function FilmButton({ editor, className = '' }: { editor: Editor; className?: string }) {
  const activity = useValue(filmActivityAtom)
  const count = useValue('film count', () => {
    const plan = editor.getDocumentSettings().meta.videoStory as { shots?: { src?: string; promptId?: string }[]; production?: unknown; result?: string } | undefined
    if (plan?.production) return plan.result ? '第一集已完成' : '第一集 · 查看进度'
    if (!plan?.shots) return '开始制作'
    return `镜头 ${plan.shots.filter((s) => s.src).length}/${plan.shots.length}${plan.shots.some((s) => s.promptId && !s.src) ? ' · 有任务可接回' : ''}`
  }, [editor])
  return <button type="button" className={`ca-bar__btn ca-film-entry ${className}`} title={activity.label || '剧本 → 分镜 → 动态视频 → 中文配音 → 导出'} onClick={() => filmOpenAtom.set({ source: '' })}>
    <span className="ca-icon">{Icons.video}</span><strong>制作工作台</strong><span>{activity.busy ? activity.label : count}</span>
  </button>
}

import { useEffect, useState } from 'react'
import { openView } from '../projects'
import { Icons } from '../ui/icons'
import { newCreativeProject, openStudioProject } from '../studio/navigation'
import { loadStudioProjects, projectSubtitle, type StudioProject } from '../studio/projectSummary'
import { formatDuration } from '../studio/story'

export function Home() {
  const [projects, setProjects] = useState<StudioProject[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const reload = () => { setError(''); void loadStudioProjects().then(setProjects, () => setError('项目列表暂时无法读取，请检查连接后重试。')) }
  useEffect(reload, [])
  const feature = projects?.find((p) => !p.plan?.production && p.poster) ?? projects?.[0]
  const filtered = projects?.filter((p) => p.entry.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="mj-home-content">
    <header className="mj-home-top"><div><span className="mj-eyebrow">YOUR LOCAL CREATIVE SPACE</span><h1>创作首页</h1></div><label className="mj-search"><span className="ca-icon">{Icons.search}</span><input aria-label="搜索项目" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索你的项目…" /></label></header>
    <section className="mj-hero">
      {feature?.poster && <img className="mj-hero__image" src={feature.poster} alt="创作项目预览" />}
      <div className="mj-hero__shade" /><div className="mj-hero__copy"><span className="mj-eyebrow">FROM IDEAS TO CREATION</span><h2>让灵感，<br />成为作品<span>。</span></h2><p>与 Agent 一起设计，生成图片和视频。<br />把灵感、素材和作品，放进同一张画布。</p><button type="button" className="mj-button mj-button--primary" onClick={() => newCreativeProject()}><span className="ca-icon">{Icons.plus}</span>开始创作<span>↗</span></button></div>
      <div className="mj-hero__caption"><span>MUJIAN / AI CREATIVE WORKSPACE</span>{feature && <button type="button" onClick={() => openStudioProject(feature.entry.id, feature.plan?.production ? 'overview' : 'agent')}>探索创作画布<span>↗</span></button>}</div>
    </section>
    <section className="mj-actions" aria-label="创作入口">{[
      { mode: 'agent' as const, icon: Icons.agent, label: 'Agent 创作', detail: '对话规划，调用工具完成设计' },
      { mode: 'image' as const, icon: Icons.genImage, label: '图片制作', detail: '生成、编辑与处理图片' },
      { mode: 'video' as const, icon: Icons.genVideo, label: '视频制作', detail: '文生视频、图生视频与分镜' },
    ].map((item) => <button type="button" key={item.mode} aria-label={item.label} onClick={() => newCreativeProject(item.mode)}><span className="mj-action-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="mj-action-arrow">↗</span></button>)}</section>
    <section className="mj-recent"><div className="mj-section-title"><div><span className="mj-eyebrow">YOUR RECENT CREATIONS</span><h2>最近的项目 <small>{projects?.length ?? '—'}</small></h2></div><button type="button" className="mj-text-button" onClick={() => openView('projects')}>全部项目 <span>→</span></button></div>
      {error && <div className="mj-error" role="alert">{error}<button type="button" onClick={reload}>重新连接</button></div>}
      {!projects && !error && <div className="mj-empty">正在读取你的创作项目…</div>}
      {projects && !filtered?.length && <div className="mj-empty">{search ? '没有找到这个项目，试试其他名称。' : '第一个作品，从这里开始。'}{!search && <button type="button" className="mj-button" onClick={() => newCreativeProject()}>新建项目</button>}</div>}
      <div className="mj-project-grid">{filtered?.map((p, i) => <article className="mj-project-card" key={p.entry.id}><button type="button" className="mj-project-cover" aria-label={`打开 ${p.entry.name}`} onClick={() => openStudioProject(p.entry.id)}>{p.poster ? <img src={p.poster} alt="" loading="lazy" /> : <span className="mj-cover-placeholder">{Icons.genVideo}</span>}<span className="mj-project-index">PROJECT / {String(i + 1).padStart(2, '0')}</span><span className="mj-project-status" data-done={!!p.plan?.result}>{projectSubtitle(p)}</span>{p.seconds && <span className="mj-project-duration">{formatDuration(p.seconds)}</span>}</button><div className="mj-project-info"><div><h3>{p.entry.name || '未命名项目'}</h3><p>{p.plan?.production ? '漫剧演示案例 · 图片 / 视频 / 配音' : '自由创作 · 画布与本地生成'}</p></div><button type="button" aria-label={`继续 ${p.entry.name}`} onClick={() => openStudioProject(p.entry.id)}>↗</button></div></article>)}</div>
    </section><footer className="mj-home-footer"><span>让每一个灵感，都有实现的空间。</span><span>MUJIAN STUDIO / 本地 AI 创作</span></footer>
  </div>
}

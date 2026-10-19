import { useEffect, useState } from 'react'
import { openView } from '../projects'
import { Icons } from '../ui/icons'
import { newStudioProject, openStudioProject } from '../studio/navigation'
import { loadStudioProjects, projectSubtitle, type StudioProject } from '../studio/projectSummary'
import { formatDuration } from '../studio/story'

export function Home() {
  const [projects, setProjects] = useState<StudioProject[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const reload = () => { setError(''); void loadStudioProjects().then(setProjects, () => setError('项目列表暂时无法读取，请检查连接后重试。')) }
  useEffect(reload, [])
  const latest = projects?.[0]
  const completed = projects?.find((p) => p.plan?.result)
  const feature = completed ?? latest
  const filtered = projects?.filter((p) => p.entry.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="mj-home-content">
    <header className="mj-home-top"><div><span className="mj-eyebrow">YOUR LOCAL CREATIVE SPACE</span><h1>创作首页</h1></div><label className="mj-search"><span className="ca-icon">{Icons.search}</span><input aria-label="搜索项目" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索你的故事…" /></label></header>
    <section className="mj-hero">
      {feature?.poster && <img className="mj-hero__image" src={feature.poster} alt="当前漫剧场景" />}
      <div className="mj-hero__shade" /><div className="mj-hero__copy"><span className="mj-eyebrow">FROM SCRIPT TO SCREEN</span><h2>让故事，<br />有声有色<span>。</span></h2><p>从一段剧本，到一部属于你的漫剧。<br />画面、对白、声音，在这里汇成故事。</p><button type="button" className="mj-button mj-button--primary" onClick={() => newStudioProject()}><span className="ca-icon">{Icons.plus}</span>开始新的故事<span>↗</span></button></div>
      <div className="mj-hero__caption"><span>MUJIAN / LOCAL AI FILM STUDIO</span>{feature && <button type="button" onClick={() => openStudioProject(feature.entry.id, feature.plan?.result ? 'film' : 'overview')}>正在创作 · {feature.entry.name}<span>↗</span></button>}</div>
    </section>
    <section className="mj-actions" aria-label="快速开始"><button type="button" onClick={() => newStudioProject()}><span className="mj-action-icon">{Icons.skill}</span><span><strong>新建漫剧</strong><small>写下故事，开始创作</small></span><span className="mj-action-arrow">↗</span></button><button type="button" disabled={!latest} onClick={() => latest && openStudioProject(latest.entry.id, 'production')}><span className="mj-action-icon">{Icons.genVideo}</span><span><strong>继续制作</strong><small>{latest ? '回到最近的创作进度' : '创建项目后即可继续'}</small></span><span className="mj-action-arrow">↗</span></button><button type="button" disabled={!completed} onClick={() => completed && openStudioProject(completed.entry.id, 'film')}><span className="mj-action-icon">{Icons.video}</span><span><strong>查看成片</strong><small>{completed ? '播放和下载已完成作品' : '你的作品将在这里呈现'}</small></span><span className="mj-action-arrow">↗</span></button></section>
    <section className="mj-recent"><div className="mj-section-title"><div><span className="mj-eyebrow">KEEP YOUR STORY GOING</span><h2>最近的故事 <small>{projects?.length ?? '—'}</small></h2></div><button type="button" className="mj-text-button" onClick={() => openView('projects')}>全部项目 <span>→</span></button></div>
      {error && <div className="mj-error" role="alert">{error}<button type="button" onClick={reload}>重新连接</button></div>}
      {!projects && !error && <div className="mj-empty">正在读取你的创作项目…</div>}
      {projects && !filtered?.length && <div className="mj-empty">{search ? '没有找到这个故事，试试其他名称。' : '第一个故事，从这里开始。'}{!search && <button type="button" className="mj-button" onClick={() => newStudioProject()}>新建漫剧</button>}</div>}
      <div className="mj-project-grid">{filtered?.map((p, i) => <article className="mj-project-card" key={p.entry.id}><button type="button" className="mj-project-cover" aria-label={`打开 ${p.entry.name}`} onClick={() => openStudioProject(p.entry.id)}>{p.poster ? <img src={p.poster} alt="" loading="lazy" /> : <span className="mj-cover-placeholder">{Icons.genVideo}</span>}<span className="mj-project-index">PROJECT / {String(i + 1).padStart(2, '0')}</span><span className="mj-project-status" data-done={!!p.plan?.result}>{projectSubtitle(p)}</span>{p.seconds && <span className="mj-project-duration">{formatDuration(p.seconds)}</span>}</button><div className="mj-project-info"><div><h3>{p.entry.name || '未命名故事'}</h3><p>{p.plan?.production ? '竖屏漫剧 · 画面 / 配音 / 字幕' : '自由创作 · 画布与本地生成'}</p></div><button type="button" aria-label={`继续 ${p.entry.name}`} onClick={() => openStudioProject(p.entry.id)}>↗</button></div></article>)}</div>
    </section><footer className="mj-home-footer"><span>每个故事，都值得被看见。</span><span>MUJIAN STUDIO / 本地 AI 创作</span></footer>
  </div>
}

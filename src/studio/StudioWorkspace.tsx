import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor } from 'tldraw'
import { api, viewUrl } from '../comfy'
import { saveNow, saveStateAtom } from '../autosave'
import { openView } from '../projects'
import { productionStatusAtom } from '../ui/EpisodeProduction'
import { filmActivityAtom, filmOpenAtom } from '../ui/filmState'
import { Icons } from '../ui/icons'
import { StudioSidebar } from './StudioBrand'
import { DRAFT_PREFIX, newStudioProject } from './navigation'
import { formatDuration, reviseDraft, rolesOf, scenesOf, type StudioDraft, type StudioPlan, type StudioView } from './story'
import '../styles/studio.css'

const NAV = [
  ['overview', '项目总览', 'grid'], ['script', '故事剧本', 'skill'], ['cast', '角色与声音', 'mic'],
  ['production', '制作工作台', 'genVideo'], ['film', '成片放映室', 'video'], ['canvas', '高级画布', 'layers'],
] as const

export function StudioWorkspace({ editor, view, onView }: { editor: Editor; view: StudioView; onView: (view: StudioView) => void }) {
  const doc = useValue('studio document', () => editor.getDocumentSettings(), [editor])
  const plan = doc.meta.videoStory as StudioPlan | undefined
  const draft = (doc.meta.studioDraft ?? {}) as StudioDraft
  const status = useValue(productionStatusAtom)
  const job = status?.id === plan?.production?.id ? status?.job : null
  const disconnected = status?.id === plan?.production?.id && status?.disconnected
  const activity = useValue(filmActivityAtom)
  const saved = useValue(saveStateAtom)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const [controlBusy, setControlBusy] = useState(false)
  const [mediaInfo, setMediaInfo] = useState<{ seconds: number; width: number; height: number } | null>(null)
  const imported = useRef(false)
  const scenes = scenesOf(plan)
  const roles = rolesOf(scenes)
  const source = draft.source ?? plan?.source ?? ''
  const hasGenerated = !!plan?.production || !!plan?.result || !!plan?.shots?.some((s) => s.src || s.promptId)
  const result = job?.result ? viewUrl(job.result) : plan?.result
  const scene = job?.scenes[selected]
  const shot = plan?.shots?.[selected]
  const poster = job?.scenes[0]?.panels[0] ? viewUrl(job.scenes[0].panels[0]) : undefined
  const completed = job ? job.clips_done ?? 0 : plan?.shots?.filter((s) => s.src).length ?? 0
  const cues = scenes.reduce((n, s) => n + s.narration.length, 0)
  const label = NAV.find(([id]) => id === view)![1]
  const updateDraft = (patch: Partial<StudioDraft>) => {
    editor.updateDocumentSettings({ meta: reviseDraft(editor.getDocumentSettings().meta, patch) as typeof doc.meta })
  }

  useEffect(() => {
    const url = new URL(location.href)
    const token = url.searchParams.get('draft')
    if (!token || imported.current) return
    imported.current = true
    try {
      const text = sessionStorage.getItem(DRAFT_PREFIX + token)
      if (!text) throw new Error('没有找到待导入的剧本，请重新粘贴原稿。')
      const data = JSON.parse(text)
      if (typeof data.source !== 'string' || typeof data.title !== 'string' || typeof data.direction !== 'string') throw new Error('剧本草稿格式无效。')
      const castNotes = data.castNotes && typeof data.castNotes === 'object' && !Array.isArray(data.castNotes) && Object.values(data.castNotes).every((v) => typeof v === 'string') ? data.castNotes : {}
      editor.updateDocumentSettings({ name: data.title || '未命名漫剧', meta: reviseDraft(editor.getDocumentSettings().meta, { source: data.source, direction: data.direction, castNotes }) as typeof doc.meta })
      void saveNow().then(() => {
        if (saveStateAtom.get().state !== 'saved') { setError('剧本已载入，保存暂未成功；恢复连接后请点击重试保存。'); return }
        sessionStorage.removeItem(DRAFT_PREFIX + token)
        url.searchParams.delete('draft'); history.replaceState(null, '', url)
      })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [editor])

  useEffect(() => {
    document.title = `${doc.name || '未命名漫剧'} · 幕间`
  }, [doc.name])

  useEffect(() => { setSelected((i) => Math.max(0, Math.min(i, scenes.length - 1))) }, [scenes.length])

  const leave = async (action: () => void) => {
    await saveNow()
    if (saveStateAtom.get().state === 'error') { setError('当前修改尚未保存成功，请重试保存后再离开。'); return }
    action()
  }
  const openTask = () => {
    if (plan?.production || plan?.shots?.length) filmOpenAtom.set({ source: '' })
    else if (source.trim()) void prepare()
    else onView('script')
  }
  const prepare = async () => {
    if (!source.trim()) { setError('先写下你的故事或粘贴剧本。'); return }
    if (hasGenerated) {
      await leave(() => { try { newStudioProject(source, `${doc.name} · 修订`, draft.direction ?? '', draft.castNotes) } catch { setError('草稿无法暂存，请检查浏览器存储后重试。') } })
    } else {
      await saveNow()
      if (saveStateAtom.get().state === 'error') { setError('剧本尚未保存成功，请重试保存。'); return }
      filmOpenAtom.set({ source, direction: draft.direction })
      onView('production')
    }
  }
  const control = async (pause: boolean) => {
    if (!plan?.production) return
    setControlBusy(true); setError('')
    try {
      const res = await api(`/comfyart/video/production/${encodeURIComponent(plan.production.id)}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pause }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || '任务操作失败')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setControlBusy(false) }
  }

  const stages = plan?.production ? [
    { key: 'images', label: '剧情画面', count: job ? `${job.images_done ?? 0} 张已生成` : '按场景生成画面' },
    { key: 'voices', label: '角色配音', count: job ? `${job.voices_done ?? 0} / ${job.voices_total ?? cues} 段` : '中文旁白与对白' },
    { key: 'videos', label: '关键动画', count: `${completed} / ${scenes.length} ${plan?.production ? '场景' : '镜头'}` },
    { key: 'render', label: '字幕与成片', count: result ? '已完成，可播放' : job?.render ? `${job.render.done} / ${job.render.total}` : '等待素材完成' },
  ] : [
    { key: 'script', label: '剧本分镜', count: scenes.length ? `${scenes.length} 个镜头已整理` : '先准备故事剧本' },
    { key: 'videos', label: '生成镜头', count: `${completed} / ${scenes.length} 个镜头` },
    { key: 'voices', label: '中文配音', count: result ? '配音阶段已完成' : '合成时处理旁白' },
    { key: 'render', label: '字幕与成片', count: result ? '已完成，可播放' : '等待素材完成' },
  ]
  const phase = job?.status === 'done' || result ? 4 : job ? stages.findIndex((s) => s.key === job.phase) : scenes.length ? activity.busy && /配音|旁白/.test(activity.label) ? 2 : activity.busy && /合成|导出|混音/.test(activity.label) ? 3 : 1 : -1
  const progress = <div className="mj-pipeline">{stages.map((s, i) => <div key={s.key} data-state={phase > i ? 'done' : phase === i ? 'active' : 'waiting'}><span className="mj-pipeline__number">{phase > i ? Icons.check : String(i + 1).padStart(2, '0')}</span><span><strong>{s.label}</strong><small>{s.count}</small></span>{i < 3 && <span className="mj-pipeline__line" />}</div>)}</div>

  return <div className="mj-shell" onKeyDown={(e) => { if (view !== 'canvas') e.stopPropagation() }}>
    <StudioSidebar active={view} onHome={() => void leave(() => openView('home'))} onNew={() => void leave(() => newStudioProject())} items={NAV.map(([id, name, icon]) => ({ id, label: name, icon: Icons[icon], onClick: () => onView(id) }))} />
    <header className="mj-project-header"><div className="mj-breadcrumb"><button type="button" onClick={() => void leave(() => openView('projects'))}>我的项目</button><span>/</span><input aria-label="漫剧项目名称" value={doc.name} placeholder="未命名漫剧" onChange={(e) => editor.updateDocumentSettings({ name: e.target.value })} /></div><div className="mj-header-actions"><button type="button" className="mj-save" data-error={saved.state === 'error' || undefined} onClick={() => void saveNow()} title={saved.error}><i />{saved.state === 'saved' ? '已保存' : saved.state === 'error' ? '重试保存' : '正在保存…'}</button><button type="button" className="mj-button mj-button--primary" onClick={() => result ? onView('film') : hasGenerated ? openTask() : source.trim() ? void prepare() : onView('script')}><span className="ca-icon">{result ? Icons.video : Icons.genVideo}</span>{result ? '播放成片' : hasGenerated ? '继续制作' : '开始制作'}</button></div></header>
    {view !== 'canvas' && <main className="mj-workspace" key={view}>
      <div className="mj-page-heading"><div><span className="mj-eyebrow">{view === 'overview' ? 'STORY IN THE MAKING' : `MUJIAN / ${view.toUpperCase()}`}</span><h1>{label}</h1></div><span className="mj-format">{plan?.ratio ?? '9:16'} <i /> {plan?.production ? '动态漫剧' : '本地创作'}</span></div>
      {error && <div className="mj-error" role="alert">{error}<button type="button" onClick={() => setError('')}>关闭</button></div>}
      {(disconnected || job?.error) && <div className="mj-error" role="alert">{disconnected ? '制作服务暂时断开，正在重连；已完成素材仍可查看。' : job?.error}</div>}

      {view === 'overview' && <>
        <section className="mj-project-hero">{poster && <img src={poster} alt="本集场景" />}<div className="mj-project-hero__shade" /><div><span className="mj-pill">{result ? '成片已就绪' : scenes.length ? '故事正在成形' : '新的故事，即将开场'}</span><h2>{doc.name || '你的下一个故事'}</h2><p>{plan?.production ? `${scenes.length} 个主要场景 · ${cues} 段配音 · 动态漫画与人物动画` : '写好故事，确认画面与对白，再开始制作。'}</p><button type="button" className="mj-button mj-button--primary" onClick={() => onView(result ? 'film' : source ? 'production' : 'script')}><span className="ca-icon">{result ? Icons.video : Icons.genVideo}</span>{result ? '进入成片放映室' : source ? '进入制作工作台' : '开始写剧本'}<span>→</span></button></div><span className="mj-project-hero__foot">A STORY BY YOU / MADE LOCALLY</span></section>
        <div className="mj-stat-row"><div><span>故事场景</span><strong>{scenes.length || '—'}<small>个</small></strong></div><div><span>对白与旁白</span><strong>{cues || '—'}<small>段</small></strong></div><div><span>已生成动画</span><strong>{job ? completed : completed || '—'}<small>段</small></strong></div><div><span>成片时长</span><strong>{formatDuration(job?.seconds)}<small>{result ? '可播放' : '制作后确认'}</small></strong></div></div>
        <div className="mj-section-title"><h2>制作流程</h2><button type="button" className="mj-text-button" onClick={() => onView('production')}>查看制作详情 →</button></div>{progress}
        <div className="mj-section-title"><h2>故事场景</h2><button type="button" className="mj-text-button" onClick={() => onView('script')}>查看剧本 →</button></div>
        {scenes.length ? <div className="mj-scene-grid">{scenes.map((s, i) => <button type="button" key={s.id} className="mj-scene-card" onClick={() => { setSelected(i); onView('production') }}><div>{job?.scenes[i]?.panels[0] ? <img loading="lazy" src={viewUrl(job.scenes[i].panels[0])} alt="" /> : <span className="ca-icon">{Icons.genVideo}</span>}<b>{s.id}</b></div><strong>{s.title}</strong><small>{job?.scenes[i]?.clip || plan?.shots?.[i]?.src ? '动画已完成' : '查看场景与对白'}</small></button>)}</div> : <div className="mj-empty">你的场景将在确认剧本后出现在这里。<button type="button" className="mj-button" onClick={() => onView('script')}>写下第一个场景</button></div>}
      </>}

      {view === 'script' && <div className="mj-writing-layout"><section className="mj-paper"><div className="mj-paper__head"><span>STORY / 剧本原稿</span><span>{source.length.toLocaleString()} 字</span></div><textarea aria-label="故事剧本" className="mj-script-input" value={source} onChange={(e) => updateDraft({ source: e.target.value })} placeholder={'把你的故事粘贴到这里。\n\n【画面】傍晚，地铁站。一个女孩拖着行李箱走进人群。\n【旁白】她没有赶上那班列车。\n\n使用【画面】和【旁白】标记，方便后续检查分镜。'} /><div className="mj-paper__foot"><span>{hasGenerated ? '修订稿单独保存，已有成片与素材保留。' : '输入后自动保存，可以随时回来继续。'}</span><span>01 / STORY</span></div></section><aside className="mj-inspector"><span className="mj-eyebrow">DIRECTOR’S NOTES</span><h2>这次，想讲怎样的故事？</h2><p>先明确人物、氛围和关键情节，再检查每个场景的画面与对白。</p><label className="mj-field">画面风格与创作要求<textarea aria-label="画面风格与创作要求" value={draft.direction ?? ''} onChange={(e) => updateDraft({ direction: e.target.value })} placeholder="例如：都市悬疑，冷灰与暗黄；人物服装保持一致，以阴影和远景表现紧张感。" /></label><div className="mj-note">{hasGenerated ? '本项目已有生成记录。修订稿会带到新项目，再确认分镜和生成设置。' : '下一步先检查分镜、旁白和时长。确认后才提交生成任务。'}</div><button type="button" className="mj-button mj-button--primary" disabled={!source.trim() || activity.busy} onClick={() => void prepare()}>{hasGenerated ? '以修订稿新建项目' : '检查分镜与制作设置'}<span>→</span></button>{hasGenerated && <button type="button" className="mj-text-button" onClick={() => onView('production')}>返回已有制作进度</button>}</aside></div>}

      {view === 'cast' && <><div className="mj-section-intro"><h2>让每个角色，都有自己的声音。</h2><p>以下角色和音色来自本集实际制作记录。创作备注单独保存，便于修订时参考。</p></div>{roles.length ? <div className="mj-cast-grid">{roles.map((role, i) => <article key={role.name} className="mj-cast-card"><div className="mj-cast-card__head"><span className="mj-avatar" style={{ '--avatar-hue': `${(i * 47 + 18) % 360}` } as React.CSSProperties}>{role.name.slice(0, 1)}</span><div><h2>{role.name}</h2><span>{role.cues} 段对白 / 旁白</span></div><span className="mj-cast-number">{String(i + 1).padStart(2, '0')}</span></div><div className="mj-voice-label"><span className="ca-icon">{Icons.mic}</span>{role.speaker ? `本地音色 · ${role.speaker}` : '音色在制作时确认'}</div>{role.tone && <p className="mj-role-tone">{role.tone}</p>}<blockquote>“{role.sample}”</blockquote><label className="mj-field">创作备注<textarea aria-label={`${role.name}的创作备注`} value={draft.castNotes?.[role.name] ?? ''} onChange={(e) => updateDraft({ castNotes: { ...draft.castNotes, [role.name]: e.target.value } })} placeholder="记录角色外貌、服装与表演要求，供修订参考…" /></label><button type="button" className="mj-text-button" onClick={() => { setSelected(scenes.findIndex((s) => s.narration.some((c) => c.role === role.name))); onView('production') }}>在场景中查看 →</button></article>)}</div> : <div className="mj-empty">当前还没有独立的角色配音记录。可以先在剧本中写明人物与对白。<button type="button" className="mj-button" onClick={() => onView('script')}>编辑故事剧本</button></div>}</>}

      {view === 'production' && <>{progress}<div className="mj-production-toolbar"><div><span className="mj-status-dot" data-busy={activity.busy || undefined} /><strong>{disconnected ? '连接中断 · 正在重连' : job?.status === 'done' || result ? '制作完成 · 可以播放成片' : job?.status === 'paused' ? '已暂停 · 素材已保留' : activity.label || '准备好后，开始制作你的故事'}</strong></div><button type="button" className="mj-button" onClick={openTask}>详细任务与设置 ↗</button></div>
        {scenes.length ? <div className="mj-production-layout"><nav className="mj-scene-list" aria-label="制作场景">{scenes.map((s, i) => <button type="button" key={s.id} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>{s.id}</span><div><strong>{s.title}</strong><small>{job?.scenes[i]?.clip || plan?.shots?.[i]?.src ? '✓ 动画已完成' : plan?.shots?.[i]?.error ? '生成中断 · 查看详情' : '场景与对白'}</small></div></button>)}</nav><section className="mj-scene-preview"><div className="mj-scene-preview__head"><span>SCENE / {scenes[selected]?.id}</span><h2>{scenes[selected]?.title}</h2></div>{scene?.clip || shot?.src ? <video key={scene?.clip?.filename ?? shot?.src} className="mj-scene-video" controls preload="metadata" poster={scene?.panels[0] ? viewUrl(scene.panels[0]) : undefined} src={scene?.clip ? viewUrl(scene.clip) : shot?.src} /> : <div className="mj-preview-empty">{Icons.genVideo}<p>本场景的动画将在生成后显示</p></div>}{shot?.prompt && <div className="mj-shot-prompt"><strong>画面描述</strong><p>{shot.prompt}</p></div>}{!!scene?.panels.length && <div className="mj-panel-strip">{scene.panels.map((p) => <a key={p.filename} href={viewUrl(p)} target="_blank" rel="noreferrer" title="查看原始画面"><img src={viewUrl(p)} alt={`${scenes[selected]?.title}的剧情画面`} /></a>)}</div>}</section><aside className="mj-dialogue"><span className="mj-eyebrow">DIALOGUE / 对白与旁白</span>{scenes[selected]?.narration.length ? scenes[selected]?.narration.map((cue, i) => <div key={i}><strong>{cue.role}</strong><p>{cue.text}</p></div>) : <p>在详细任务中编辑本镜头的画面与旁白。</p>}</aside></div> : <div className="mj-empty">先准备剧本，检查场景，再开始生成。<button type="button" className="mj-button mj-button--primary" onClick={() => source.trim() ? void prepare() : onView('script')}>{source.trim() ? '检查分镜与制作设置' : '去写剧本'}</button></div>}
        {job && !result && <div className="mj-production-controls"><span>暂停与继续仅作用于本项目，已完成素材保留。</span><button type="button" className="mj-button" disabled={controlBusy || disconnected} onClick={() => void control(!['paused', 'error', 'review'].includes(job.status))}>{['paused', 'error', 'review'].includes(job.status) ? '继续制作' : '暂停制作'}</button></div>}
      </>}

      {view === 'film' && (result ? <div className="mj-screening-layout"><section className="mj-screening"><div className="mj-screening__top"><span>NOW SHOWING</span><span>{formatDuration(mediaInfo?.seconds ?? job?.seconds)}</span></div><video key={result} aria-label="完整漫剧成片" controls preload="metadata" poster={poster} src={result} onLoadedMetadata={(e) => setMediaInfo({ seconds: e.currentTarget.duration, width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })} /><div className="mj-screening__bottom"><span>{doc.name}</span><span>MUJIAN STUDIO</span></div></section><aside className="mj-inspector mj-film-info"><span className="mj-pill">成片已就绪</span><h2>{doc.name}</h2><p>{plan?.production ? '人物动画片段与动态漫画结合，配有中文角色声音、字幕与氛围音效。' : '你的作品已合成，可在这里完整播放与下载。'}</p><dl><div><dt>时长</dt><dd>{formatDuration(mediaInfo?.seconds ?? job?.seconds)}</dd></div><div><dt>画幅</dt><dd>{plan?.ratio ?? '待读取'}</dd></div><div><dt>分辨率</dt><dd>{mediaInfo ? `${mediaInfo.width} × ${mediaInfo.height}` : '读取视频后显示'}</dd></div><div><dt>场景</dt><dd>{scenes.length} 个</dd></div>{!!cues && <div><dt>配音段落</dt><dd>{cues} 段</dd></div>}</dl><a className="mj-button mj-button--primary" href={result} download><span className="ca-icon">{Icons.export}</span>下载完整视频</a><button type="button" className="mj-button" onClick={() => onView('production')}>查看场景素材</button><button type="button" className="mj-text-button" onClick={() => onView('script')}>修订剧本，制作下一版 →</button></aside></div> : <div className="mj-empty mj-empty--film"><span className="ca-icon">{Icons.video}</span><h2>你的故事，等待开场。</h2><p>成片完成后，你可以在这里播放、查看信息和下载视频。</p><button type="button" className="mj-button mj-button--primary" onClick={() => onView('production')}>查看制作进度 →</button></div>)}
    </main>}
    <div className="mj-live-bar" role="status"><span><i data-busy={activity.busy || undefined} />{disconnected ? '制作服务正在重连' : activity.busy ? activity.label || '正在制作' : result ? '成片已完成 · 随时播放与下载' : '项目已就绪 · 从故事开始'}</span>{result && view === 'film' ? <a href={result} download>下载完整视频 ↓</a> : result ? <button type="button" onClick={() => onView('film')}>播放成片 →</button> : <button type="button" onClick={openTask}>查看制作任务 →</button>}</div>
  </div>
}

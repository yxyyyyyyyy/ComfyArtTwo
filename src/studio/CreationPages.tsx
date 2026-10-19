import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor, type TLImageShape, type TLShapeId } from 'tldraw'
import { cutout, quickEdit, upscale } from '../actions'
import { draftAtom, extraRefsAtom, generateDirect, isRefShape, srcOf, uploadRefs, type DirectSettings, directSettingsAtom, type RefShape } from '../agent'
import { botEnabledAtom, chatIdAtom, chatsAtom, messagesAtom, openChat, stopTurn } from '../bot'
import { api } from '../comfy'
import { DURATIONS, QUALITIES, RATIOS, VIDEO_RATIOS, VIDEO_RESOLUTIONS } from '../generate'
import { errorText, fileSrc, jobOf, mediaAsset } from '../jobs'
import { IMAGE_MODELS, installedModels, isInstalled, VIDEO_MODELS, videoCapabilitiesAtom } from '../models'
import { AssistantBlocks, UserMessage } from '../ui/ChatMessage'
import { Composer } from '../ui/Composer'
import { botSettingsOpenAtom } from '../ui/AgentPicker'
import { filmOpenAtom } from '../ui/filmState'
import { Icons } from '../ui/icons'
import { isVideoScript } from '../videoStory'
import type { StudioView } from './story'

type Mode = 'image' | 'video'
interface Form { prompt?: string; refs?: string[]; editing?: boolean; settings?: DirectSettings }

function useMedia(editor: Editor, kind?: Mode) {
  return useValue('studio project media', () => editor.getCurrentPageShapes().filter((s): s is RefShape => isRefShape(s) && (!kind || s.type === kind)).filter((s) => !!fileSrc(editor, s)), [editor, kind])
}

export function CreationPage({ editor, mode, onView, onError }: { editor: Editor; mode: 'agent' | Mode; onView: (view: StudioView) => void; onError: (message: string) => void }) {
  return mode === 'agent' ? <AgentPage editor={editor} onView={onView} /> : <MediaPage key={mode} editor={editor} mode={mode} onView={onView} onError={onError} />
}

function AgentPage({ editor, onView }: { editor: Editor; onView: (view: StudioView) => void }) {
  const messages = useValue(messagesAtom)
  const chats = useValue(chatsAtom)
  const chatId = useValue(chatIdAtom)
  const enabled = useValue(botEnabledAtom)
  const chat = chats.find((c) => c.id === chatId)
  const media = useMedia(editor)
  const [error, setError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.scrollTo({ top: messages.length ? list.current.scrollHeight : 0 }) }, [messages])
  return <div className="mj-agent-layout">
    <section className="mj-agent-room">
      <div className="mj-room-head"><div><span className="mj-eyebrow">DESIGN WITH AN AGENT</span><h2>把想法交给你的设计搭档</h2></div><button type="button" className="mj-button" onClick={() => void openChat(null).catch((e) => setError(errorText(e)))}>＋ 新建对话</button></div>
      <div className="mj-agent-history"><label>对话记录<select aria-label="Agent 对话记录" value={chatId ?? ''} onChange={(e) => void openChat(e.target.value || null).catch((e) => setError(errorText(e)))}><option value="">新的设计对话</option>{chats.map((c) => <option key={c.id} value={c.id}>{c.title || '未命名对话'}{c.busy ? ' · 正在执行' : ''}</option>)}</select></label><button type="button" className="mj-text-button" onClick={() => botSettingsOpenAtom.set(true)}>Agent 设置 ↗</button></div>
      <div className="mj-agent-messages" ref={list}>
        {!messages.length && <div className="mj-agent-welcome"><span className="mj-eyebrow">YOUR NEXT IDEA STARTS HERE</span><h3>你想创造什么？</h3><p>描述目标、风格与交付要求。Agent 会结合参考素材与技能，规划并调用工具完成设计。</p><div className="mj-agent-starters">{['设计一张科技产品发布海报', '为咖啡品牌设计社交媒体配图', '根据参考素材规划一个短视频'].map((s) => <button type="button" key={s} onClick={() => draftAtom.set(s)}>{s}<span>↗</span></button>)}</div></div>}
        {messages.map((m) => m.role === 'user' ? <UserMessage key={m.id} editor={editor} m={m} /> : <div className="mj-agent-answer" key={m.id}><span className="mj-answer-label">MUJIAN AGENT</span><AssistantBlocks editor={editor} m={m} />{m.status === 'streaming' && <div className="mj-agent-running">正在处理你的设计需求… <button type="button" onClick={() => void stopTurn().catch((e) => setError(errorText(e)))}>停止本次对话</button></div>}</div>)}
      </div>
      {error && <div className="mj-error" role="alert">{error}</div>}
      {enabled === false && <div className="mj-note">先在 Agent 设置中配置并启用服务，再开始设计。<button type="button" className="mj-text-button" onClick={() => botSettingsOpenAtom.set(true)}>打开设置 →</button></div>}
      <div className="mj-agent-editor"><Composer editor={editor} busy={!!chat?.busy} fixedMode="agent" onError={setError} /></div>
    </section>
    <aside className="mj-agent-deliverables"><span className="mj-eyebrow">YOUR PROJECT</span><h2>素材与设计成果</h2><p>本项目的图片与视频集中展示在这里，完整排版可在自由画布中继续编辑。</p><div className="mj-agent-assets">{media.slice(-8).reverse().map((s) => <button type="button" key={s.id} onClick={() => { editor.select(s.id); editor.zoomToSelection(); onView('canvas') }} title="在画布中编辑">{s.type === 'video' ? <video src={fileSrc(editor, s)!} preload="metadata" muted /> : s.type === 'image' ? <img src={fileSrc(editor, s)!} alt="项目素材" /> : <span>{Icons.music}</span>}</button>)}</div>{!media.length && <div className="mj-small-empty">你的参考素材和生成成果将在这里出现。</div>}<button type="button" className="mj-button" onClick={() => onView('canvas')}>打开自由画布 ↗</button></aside>
  </div>
}

function MediaPage({ editor, mode, onView, onError }: { editor: Editor; mode: Mode; onView: (view: StudioView) => void; onError: (message: string) => void }) {
  const video = mode === 'video'
  const doc = useValue('media form document', () => editor.getDocumentSettings(), [editor])
  const forms = (doc.meta.creationForms ?? {}) as Partial<Record<Mode, Form>>
  const form = forms[mode] ?? {}
  const defaults = useValue('media creation settings', () => directSettingsAtom.get()[mode], [mode])
  const settings = form.settings ?? defaults
  const available = useValue('media creation models', () => installedModels(video), [video])
  const capabilities = useValue(videoCapabilitiesAtom)
  const models = available.length ? available : video ? VIDEO_MODELS : IMAGE_MODELS
  const workflow = settings.workflow && models.some((m) => m.id === settings.workflow) ? settings.workflow : models[0].id
  const media = useMedia(editor, mode)
  const allRefs = useMedia(editor)
  const refs = (form.refs ?? []).map((id) => editor.getShape(id as TLShapeId)).filter((s): s is RefShape => !!s && isRefShape(s))
  const jobs = useValue('studio media jobs', () => editor.getCurrentPageShapes().flatMap((s) => { const j = jobOf(s); return j && j.kind === mode ? [j] : [] }), [editor, mode])
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  const [mobileView, setMobileView] = useState<'form' | 'results'>('form')
  const [selected, setSelected] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const chosen = media.find((s) => s.id === selected) ?? media.at(-1)
  const update = (patch: Partial<Form>) => {
    const current = editor.getDocumentSettings()
    editor.updateDocumentSettings({ meta: { ...current.meta, creationForms: { ...(current.meta.creationForms as Record<string, any> ?? {}), [mode]: { ...(current.meta.creationForms as any)?.[mode], ...patch } } } })
  }
  const configure = (patch: DirectSettings) => {
    const all = directSettingsAtom.get()
    const next = { ...settings, ...patch, workflow: patch.workflow ?? workflow }
    directSettingsAtom.set({ ...all, [mode]: next })
    update({ settings: next })
  }
  useEffect(() => { if (settings.workflow !== workflow) configure({ workflow }) }, [workflow])
  useEffect(() => {
    const id = jobs[0]?.id
    if (!id) { setStage(''); return }
    let alive = true; let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const r = await api(`/comfyart/video/render/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) })
        const data = await r.json()
        if (alive) setStage(r.ok ? `${data.stage || '正在生成'}${data.max ? ` · ${data.value}/${data.max} 步` : ''}` : '正在读取任务状态')
      } catch { if (alive) setStage('连接暂时中断，任务编号已保留') }
      finally { polling = false }
    }
    void poll(); const timer = setInterval(() => void poll(), 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [jobs[0]?.id])
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true); setError('')
    try {
      const added = await uploadRefs(editor, Array.from(files))
      extraRefsAtom.set(extraRefsAtom.get().filter((id) => !added.includes(id)))
      update({ refs: form.editing ? added.slice(0, 1) : [...new Set([...(form.refs ?? []), ...added])] })
    } catch (e) { setError(errorText(e)) }
    finally { setUploading(false) }
  }
  const busy = submitting || jobs.length > 0
  const submit = async () => {
    if (busy || !form.prompt?.trim()) return
    setError('')
    if (video && isVideoScript(form.prompt)) { filmOpenAtom.set({ source: form.prompt, firstFrame: refs[0] ? srcOf(editor, refs[0]) ?? undefined : undefined }); return }
    if (!video && form.editing && refs[0]?.type !== 'image') { setError('先选择一张需要编辑的参考图片。'); return }
    setSubmitting(true)
    setMobileView('results')
    try {
      configure({ workflow })
      if (!video && form.editing && refs[0]?.type === 'image') quickEdit(editor, refs[0], form.prompt.trim(), onError)
      else await generateDirect(editor, form.prompt.trim(), [{ refs, prompt: form.prompt.trim() }], video, onError)
    } catch (e) { onError(errorText(e)) }
    finally { setSubmitting(false) }
  }
  const imageAction = (action: 'cutout' | 'upscale') => {
    if (chosen?.type !== 'image' || busy) return
    setError('')
    if (action === 'cutout') cutout(editor, chosen as TLImageShape, onError)
    else upscale(editor, chosen as TLImageShape, 4, onError)
  }
  return <div className={`mj-media-page ${video ? 'mj-video-page' : 'mj-image-page'}`} data-mobile-view={mobileView}>
    <div className="mj-media-switch"><button type="button" aria-pressed={mobileView === 'form'} onClick={() => setMobileView('form')}>创作设置</button><button type="button" aria-pressed={mobileView === 'results'} onClick={() => setMobileView('results')}>作品与预览 {media.length}</button></div>
    {error && mobileView === 'results' && <div className="mj-error mj-media-global-error" role="alert">{error}<button type="button" onClick={() => setMobileView('form')}>返回设置</button></div>}
    <section className="mj-create-form"><div className="mj-create-intro"><span className="mj-eyebrow">{video ? 'MOTION STUDIO' : 'IMAGE STUDIO'}</span><h2>{video ? '让画面动起来' : '把灵感变成画面'}</h2><p>{video ? '设置画幅、时长和参考素材，独立制作你的下一段视频。' : '生成新图，或用文字编辑已有图片。'}</p></div>
      {!video && <div className="mj-create-tabs"><button type="button" aria-pressed={!form.editing} onClick={() => update({ editing: false })}>生成图片</button><button type="button" aria-pressed={!!form.editing} onClick={() => update({ editing: true, refs: form.refs?.slice(0, 1) })}>编辑图片</button></div>}
      <label className="mj-field mj-prompt-label">{video ? '视频画面描述' : form.editing ? '图片修改要求' : '图片画面描述'}<textarea aria-label={video ? '视频画面描述' : '图片画面描述'} value={form.prompt ?? ''} onChange={(e) => update({ prompt: e.target.value })} placeholder={video ? '描述主体、动作、镜头运动与氛围。例如：雨夜街道，镜头缓慢推进，霓虹灯倒映在积水中…' : form.editing ? '例如：将背景改为米白色，保留产品的形状和材质…' : '描述主体、风格、构图、光线与细节…'} /></label>
      <div className="mj-form-heading"><span>参考素材 <small>{refs.length || '可选'}</small></span><button type="button" className="mj-text-button" onClick={() => setPicker(!picker)}>从项目选择 {picker ? '−' : '＋'}</button></div>
      <div className="mj-reference-strip">{refs.map((s) => <div key={s.id}>{s.type === 'image' ? <img src={srcOf(editor, s) ?? ''} alt="生成参考" /> : <span>{s.type === 'video' ? '视频参考' : '音频参考'}</span>}<button type="button" aria-label="移除参考素材" onClick={() => update({ refs: (form.refs ?? []).filter((id) => id !== s.id) })}>×</button></div>)}<button type="button" className="mj-reference-upload" disabled={uploading} onClick={() => file.current?.click()}>{Icons.plus}<span>{uploading ? '上传中' : '上传参考'}</span></button></div>
      <input type="file" ref={file} accept={video && capabilities.references ? 'image/*,video/*,audio/*' : 'image/*'} multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
      {picker && <div className="mj-reference-picker">{allRefs.filter((s) => s.type === 'image' || video && capabilities.references).slice(-40).reverse().map((s) => <button type="button" key={s.id} aria-label={`选择参考 ${mediaAsset(editor, s)?.props.name || s.id}`} aria-pressed={refs.some((r) => r.id === s.id)} onClick={() => update({ refs: refs.some((r) => r.id === s.id) ? (form.refs ?? []).filter((id) => id !== s.id) : form.editing ? [s.id] : [...(form.refs ?? []), s.id] })}>{s.type === 'image' ? <img src={srcOf(editor, s) ?? ''} alt="项目参考图片" /> : <span>{s.type === 'video' ? '视频' : '音频'}</span>}</button>)}{!allRefs.length && <p>项目中还没有素材，可以先上传参考。</p>}</div>}
      {!form.editing && <div className="mj-create-settings"><label>生成模型<select aria-label={video ? '视频生成模型' : '图片生成模型'} value={workflow} onChange={(e) => configure({ workflow: e.target.value })}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}{!isInstalled(m.id) ? ' · 未安装' : ''}</option>)}</select></label><div className="mj-settings-pair"><label>画幅比例<select aria-label={video ? '视频画幅' : '图片画幅'} value={settings.ratio ?? (video ? '16:9' : '1:1')} onChange={(e) => configure({ ratio: e.target.value })}>{(video ? VIDEO_RATIOS : RATIOS).map((r) => <option key={r}>{r}</option>)}</select></label><label>{video ? '视频时长' : '生成数量'}<select aria-label={video ? '视频时长' : '图片数量'} value={video ? settings.duration ?? 5 : settings.count ?? 1} onChange={(e) => configure(video ? { duration: Number(e.target.value) } : { count: Number(e.target.value) })}>{(video ? DURATIONS : [1, 2, 3, 4]).map((n) => <option key={n} value={n}>{n}{video ? ' 秒' : ' 张'}</option>)}</select></label></div><div className="mj-settings-pair"><label>输出尺寸<select aria-label={video ? '视频尺寸' : '图片尺寸'} value={settings.resolution ?? (video ? '768p' : '1K')} onChange={(e) => configure({ resolution: e.target.value })}>{(video ? VIDEO_RESOLUTIONS : ['1K', '2K']).map((r) => <option key={r}>{r}</option>)}</select></label>{!video && models.find((m) => m.id === workflow)?.steps && <label>生成质量<select aria-label="图片质量" value={settings.quality ?? 'standard'} onChange={(e) => configure({ quality: e.target.value })}>{QUALITIES.map(([v, name]) => <option value={v} key={v}>{name}</option>)}</select></label>}</div></div>}
      {!video && form.editing && <div className="mj-note">选择一张图片，描述修改要求。编辑沿用原图尺寸与图片编辑工作流。</div>}
      {error && <div className="mj-error" role="alert">{error}</div>}
      <button type="button" className="mj-button mj-button--primary mj-generate-button" disabled={busy || uploading || !form.prompt?.trim() || !isInstalled(workflow)} onClick={() => void submit()}>{busy ? '正在制作…' : video ? '生成视频' : form.editing ? '应用图片修改' : '生成图片'}<span>↗</span></button>
      {video && <button type="button" className="mj-text-button" onClick={() => filmOpenAtom.set({ source: editor.getDocumentSettings().meta.videoStory ? '' : form.prompt ?? '' })}>多镜头 / 配音字幕制作 →</button>}
      <small className="mj-create-footnote">{video ? '图片参考默认作为首帧，其他参考类型依模型能力启用。' : '生成结果会保存在当前项目，可继续精修或排版。'}</small>
    </section>
    <section className="mj-creation-results"><div className="mj-results-head"><div><span className="mj-eyebrow">{video ? 'VIDEO PREVIEW' : 'YOUR IMAGE COLLECTION'}</span><h2>{video ? '视频预览' : '图片作品'} <small>{media.length}</small></h2></div><button type="button" className="mj-text-button" onClick={() => onView('canvas')}>画布与完整工具 ↗</button></div>
      {jobs.length > 0 && <div className="mj-render-status" role="status"><i />{stage || `正在处理 ${jobs.length} 个任务，已完成素材会自动出现。`}</div>}
      {chosen ? <><div className={`mj-output-preview ${video ? 'mj-output-preview--video' : ''}`}>{video ? <video key={chosen.id} controls preload="metadata" src={fileSrc(editor, chosen)!} /> : <img src={fileSrc(editor, chosen)!} alt="当前项目图片" />}</div><div className="mj-output-actions"><a href={fileSrc(editor, chosen)!} download className="mj-button">下载{video ? '视频' : '图片'}</a>{!video && <><button type="button" className="mj-button" disabled={busy} onClick={() => imageAction('cutout')}>移除背景</button><button type="button" className="mj-button" disabled={busy} onClick={() => imageAction('upscale')}>4× 超分</button></>}<button type="button" className="mj-button" onClick={() => { editor.select(chosen.id); editor.zoomToSelection(); onView('canvas') }}>{video ? '画布编辑' : '精细编辑'}</button></div></> : <div className="mj-creation-empty"><span>{video ? Icons.genVideo : Icons.genImage}</span><h3>{video ? '你的下一段视频，从这里开始。' : '第一张作品，等待你的想象。'}</h3><p>{video ? '描述画面或上传首帧，设置参数后开始生成。' : '写下画面描述，或选择参考图片进行编辑。'}</p><span className="mj-empty-ruler">{video ? 'MOTION / SOUND / STORY' : 'SUBJECT / STYLE / COMPOSITION'}</span></div>}
      {media.length > 0 && <div className="mj-results-gallery">{media.slice().reverse().map((s) => <button type="button" key={s.id} aria-label={`预览${video ? '视频' : '图片'} ${mediaAsset(editor, s)?.props.name ?? ''}`} aria-pressed={chosen?.id === s.id} onClick={() => setSelected(s.id)}>{video ? <video src={fileSrc(editor, s)!} muted preload="metadata" /> : <img src={fileSrc(editor, s)!} alt="项目图片缩略图" />}</button>)}</div>}
      <p className="mj-results-note">展示当前项目中生成或导入的{video ? '视频' : '图片'}，切换页面不会丢失素材。</p>
    </section>
  </div>
}

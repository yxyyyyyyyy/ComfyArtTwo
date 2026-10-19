import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useValue, type Editor, type TLShapeId } from 'tldraw'
import { api, queuePrompt, viewUrl } from '../comfy'
import { saveNow, saveStateAtom } from '../autosave'
import { createGenerator } from '../generate'
import { fileSrc, placeMedia, toMedia } from '../jobs'
import { annotated, imageToVideoGraph, t2vGraph, VIDEO_AREAS } from '../workflows'
import { scriptShots, validateShots, type StoryShot } from '../videoStory'
import { uuid } from '../id'
import { filmOpenAtom, filmActivityAtom } from './filmState'
import { Icons } from './icons'

interface Shot extends StoryShot { promptId?: string; submittedAt?: number }
interface Plan { source: string; shots: Shot[]; ratio: string; resolution: string; voice: boolean; assemblyId?: string; result?: string; firstFrame?: string }
interface Render { status: string; stage?: string; value?: number; max?: number; position?: number; error?: string; outputs?: { filename: string; subfolder: string; type: string }[] }
const pause = () => new Promise((r) => setTimeout(r, 2000))
const friendly = (e: unknown) => e instanceof TypeError || (e instanceof Error && /fetch|network|abort|timeout/i.test(e.message)) ? '连接已中断，任务可能仍在 5090 上执行。保留任务编号，恢复连接后继续查询。' : e instanceof Error ? e.message : String(e)
async function jsonRequest(url: string, body?: unknown) {
  const res = await api(url, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `服务返回错误 ${res.status}`)
  return data
}

// Keep the workbench mounted while minimized so navigation never starts a second render loop.
export function StoryVideoHost({ editor }: { editor: Editor }) {
  const intent = useValue(filmOpenAtom)
  const [request, setRequest] = useState<typeof intent>(null)
  useEffect(() => {
    if (intent && !filmActivityAtom.get().busy) setRequest(intent)
  }, [intent])
  return request && <StoryVideoDialog key={request.source} editor={editor} source={request.source} firstFrame={request.firstFrame} visible={!!intent} onClose={() => filmOpenAtom.set(null)} />
}

export function StoryVideoDialog({ editor, source, firstFrame, visible, onClose }: { editor: Editor; source: string; firstFrame?: string; visible: boolean; onClose: () => void }) {
  const saved = editor.getDocumentSettings().meta.videoStory as unknown as Plan | undefined
  const initial: Plan = source && source !== saved?.source ? { source, shots: scriptShots(source), ratio: '9:16', resolution: '384p', voice: true, firstFrame } : saved ?? { source, shots: [], ratio: '9:16', resolution: '384p', voice: true, firstFrame }
  const [plan, setPlan] = useState<Plan>(initial)
  const live = useRef(plan)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(initial.result ? '成片已完成' : initial.shots.some((s) => s.src) ? '已有镜头已保留 · 可继续制作' : '准备分镜')
  const [error, setError] = useState(initial.shots.some((s) => s.error) ? '上次制作在未完成镜头处中断。已完成镜头保留，可从下方继续。' : '')
  const [selected, setSelected] = useState(Math.max(0, initial.shots.findIndex((s) => !s.src)))
  const [active, setActive] = useState(-1)
  const [stage, setStage] = useState<Render | null>(null)
  const [disconnected, setDisconnected] = useState(false)
  const [lastSeen, setLastSeen] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [phase, setPhase] = useState(initial.result ? 4 : initial.shots.some((s) => s.src || s.promptId) ? 1 : 0)
  const stop = useRef(false)
  const save = (patch: Partial<Plan>) => {
    const next: Plan = JSON.parse(JSON.stringify({ ...live.current, ...patch })); live.current = next; setPlan(next)
    editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, videoStory: next as any } })
  }
  const edit = (index: number, patch: Partial<Shot>) => save({ shots: live.current.shots.map((s, i) => i === index ? { ...s, ...patch } : s), assemblyId: undefined, result: undefined })
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    filmActivityAtom.set({ busy, label: busy ? disconnected ? '连接中断 · 正在重连' : `${status}${stage?.stage ? ` · ${stage.stage}` : ''}${stage?.stage === '视频采样' ? ` ${stage.value}/${stage.max}` : ''}` : '' })
  }, [busy, status, disconnected, stage])
  const place = async (ref: { filename: string; subfolder: string; type: string }, title: string, holder?: string) => {
    const src = viewUrl(ref)
    if (!editor.getCurrentPageShapes().some((shape) => fileSrc(editor, shape) === src)) {
      const m = await toMedia(ref, 'video')
      const h = holder ? editor.getShape(holder as TLShapeId) : null
      const center = editor.getViewportPageBounds().center
      placeMedia(editor, m, title, h?.x ?? center.x, h?.y ?? center.y, 384)
    }
    if (holder && editor.getShape(holder as TLShapeId)) editor.deleteShape(holder as TLShapeId)
    return src
  }
  const readStatus = async (url: string) => {
    for (;;) {
      try {
        const data = await jsonRequest(url)
        setDisconnected(false); setLastSeen(Date.now()); return data
      } catch (e) {
        if (!(e instanceof TypeError) && !(e instanceof DOMException) && !(e instanceof Error && /服务返回错误 50[234]/.test(e.message))) throw e
        setDisconnected(true)
        if (stop.current) throw new Error('已停止等待连接；任务编号和已完成镜头已保留，稍后可继续查询。')
        await pause()
      }
    }
  }
  // Inspect an existing task without submitting anything, including after refresh or a service restart.
  useEffect(() => {
    if (!visible || busy) return
    let cancelled = false
    const inspect = async () => {
      const index = live.current.shots.findIndex((s) => !s.src && s.promptId)
      if (index < 0) return
      try {
        const job: Render = await jsonRequest(`/comfyart/video/render/${live.current.shots[index].promptId}`)
        if (cancelled) return
        setStage(job); setLastSeen(Date.now()); setDisconnected(false)
        if (job.status === 'missing' || job.status === 'error') {
          edit(index, { promptId: undefined, error: job.error }); setError(job.error || '镜头中断，可重试'); setStatus(`镜头 ${index + 1} 已中断`)
        } else setStatus(job.status === 'done' ? '镜头已完成，点击继续取回结果' : `镜头 ${index + 1} 正在服务端执行，点击继续接回进度`)
      } catch { if (!cancelled) setDisconnected(true) }
    }
    void inspect()
    const timer = setInterval(() => void inspect(), 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [visible, busy])
  const assemble = async () => {
    let id = live.current.assemblyId
    setPhase(live.current.voice ? 2 : 3); setActive(-1); setStage(null)
    if (!id) {
      setStatus('提交配音合成任务')
      id = uuid().replaceAll('-', ''); save({ assemblyId: id }); await saveNow()
      try { await jsonRequest('/comfyart/video/assemble', { id, clips: live.current.shots.map((s) => ({ src: s.src, narration: s.narration })), voice: live.current.voice }) }
      catch (e) {
        if (!(e instanceof TypeError) && !(e instanceof DOMException)) { save({ assemblyId: undefined }); throw e }
        setDisconnected(true); await pause()
      }
    }
    for (;;) {
      let job
      try { job = await readStatus(`/comfyart/video/assemble/${id}`) }
      catch (e) { if (e instanceof Error && e.message === 'job not found') save({ assemblyId: undefined }); throw e }
      setPhase(job.status === 'voicing' ? 2 : 3)
      setStatus(`${job.stage || (job.status === 'queued' ? '等待合成资源' : '合成视频')} · ${job.progress ?? 0}/${job.total ?? live.current.shots.length}`)
      if (job.status === 'error') { save({ assemblyId: undefined }); throw new Error(job.error) }
      if (job.status === 'done') {
        const src = await place(job.result, '分镜合成 · ' + (job.narrated ? '中文旁白 / 字幕' : '环境声'))
        save({ result: src }); setPhase(4); setStatus(`成片已完成 · ${job.seconds} 秒${job.narrated ? ' · 中文旁白和字幕' : ' · 原视频声音'}`); await saveNow(); return
      }
      await pause()
    }
  }
  const run = async (mergeOnly = false, one = false) => {
    if (filmActivityAtom.get().busy) return
    const invalid = validateShots(live.current.shots)
    if (invalid) { setError(invalid); return }
    filmActivityAtom.set({ busy: true, label: '准备视频' })
    setBusy(true); setError(''); stop.current = false; setPhase(1)
    try {
      if (!mergeOnly) for (let i = 0; i < live.current.shots.length; i++) {
        if (stop.current) { setStatus('已暂停后续镜头；点击继续即可恢复。'); return }
        const s = live.current.shots[i]
        if (s.src) continue
        setActive(i); setSelected(i); setStage(null); setStatus(`镜头 ${i + 1}/${live.current.shots.length}`)
        try {
          let promptId = s.promptId; let holder = s.holder
          if (!promptId) {
            if (!holder || !editor.getShape(holder as TLShapeId)) holder = createGenerator(editor, true, { prompt: s.prompt, ratio: live.current.ratio, resolution: live.current.resolution, duration: s.duration, workflow: 't2v-minimax-h3.api.json' }, false)
            const [a, b] = live.current.ratio.split(':').map(Number)
            const prompt = `${s.prompt}\nCinematic shot, consistent character appearance and costumes. Natural ambient sound. No subtitles or text overlays.`
            const area = VIDEO_AREAS[live.current.resolution]
            setStage({ status: 'running', stage: '准备工作流 / 加载配置' })
            const built = i === 0 && live.current.firstFrame ? await imageToVideoGraph(annotated(live.current.firstFrame), prompt, a / b, s.duration, null, area) : await t2vGraph(prompt, a / b, s.duration, area)
            promptId = uuid()
            edit(i, { promptId, holder, error: undefined, submittedAt: Date.now() }); await saveNow()
            if (saveStateAtom.get().state !== 'saved') { edit(i, { promptId: undefined }); throw new Error('项目尚未保存成功，暂未提交新镜头。恢复连接并保存后可继续。') }
            try { await queuePrompt(built.graph, promptId) }
            catch (e) {
              // A lost POST response may still have queued the job. Reconcile the saved UUID, never resubmit blindly.
              if (!(e instanceof TypeError) && !(e instanceof DOMException)) { edit(i, { promptId: undefined }); throw e }
              setDisconnected(true); await pause()
            }
          }
          const submitted = Date.now()
          for (;;) {
            const job: Render = await readStatus(`/comfyart/video/render/${promptId}`)
            setStage(job)
            if (job.status === 'done') {
              if (!job.outputs?.[0]) throw new Error('本镜头未返回视频文件。')
              const src = await place(job.outputs[0], s.title, holder)
              edit(i, { src, error: undefined }); await saveNow(); break
            }
            if (job.status === 'error' || (job.status === 'missing' && Date.now() - submitted > 30000)) {
              edit(i, { promptId: undefined }); throw new Error(job.error || '任务中断，可重试此镜头。')
            }
            await pause()
          }
        } catch (e) { edit(i, { error: friendly(e) }); throw e }
        if (one) { setStatus(`镜头 ${i + 1} 已完成；可预览或继续其余镜头。`); setStage(null); return }
      }
      if (stop.current) { setStatus('已暂停，镜头已保留。'); return }
      if (live.current.shots.some((s) => !s.src)) throw new Error('仍有镜头未完成，不能合成。')
      await assemble()
    } catch (e) { setError(friendly(e)); setStatus('制作暂停 · 已完成镜头保留') }
    finally { setBusy(false); setActive(-1); filmActivityAtom.set({ busy: false, label: '' }) }
  }
  const completed = plan.shots.filter((s) => s.src).length
  const s = plan.shots[selected]
  const elapsed = active >= 0 && plan.shots[active]?.submittedAt ? Math.max(0, Math.floor((now - plan.shots[active].submittedAt!) / 1000)) : 0
  const percent = plan.shots.length ? Math.round(completed / plan.shots.length * 100) : 0
  return createPortal(<div className="ca-modal" style={{ display: visible ? undefined : 'none' }} role="dialog" aria-modal="true" aria-label="视频工作台" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <div className="ca-modal__card ca-film">
      <div className="ca-film__head"><div><strong>视频工作台</strong><small>剧本到成片 · 进度保存在当前项目</small></div><button className="ca-panel__secondary" onClick={onClose}>{busy ? '收起 · 继续制作' : '返回画布'} {Icons.close}</button></div>
      <div className="ca-film__progress">
        <div className="ca-film__steps">{['① 剧本分镜', '② 生成镜头', '③ 中文配音', '④ 合成导出'].map((label, i) => <span key={label} data-active={(plan.result ? 4 : phase) >= i || undefined}>{label}</span>)}</div>
        <div className="ca-film__meter"><strong>已完成 {completed} / {plan.shots.length} 镜头</strong><span>{percent}% · {plan.resolution} · {plan.ratio} · 原生镜头 {plan.shots.reduce((n, s) => n + s.duration, 0)} 秒</span></div>
        <progress aria-label="已完成镜头进度" value={completed} max={Math.max(1, plan.shots.length)} />
        <div className="ca-film__live" role="status"><strong>{disconnected ? '连接中断 · 正在自动重连' : status}</strong><span>{!disconnected && stage?.stage}{stage?.position ? ` · 队列第 ${stage.position} 位` : ''}{!disconnected && stage?.stage === '视频采样' && stage.max ? ` · ${stage.value}/${stage.max} 步` : ''}{busy && elapsed ? ` · 本镜头用时 ${Math.floor(elapsed / 60)}分${elapsed % 60}秒` : ''}</span></div>
        {busy && stage?.stage === '视频采样' && !!stage.max && <progress aria-label="当前镜头采样进度" value={stage.value} max={stage.max} />}
        <small className="ca-film__hint">{disconnected ? '任务可能仍在 5090 执行；任务编号已保留，不会自动重复提交。' : busy ? `${lastSeen ? `服务响应于 ${Math.max(0, Math.floor((now - lastSeen) / 1000))} 秒前。` : ''}加载与解码没有可用百分比时会显示实际步骤。` : '已完成的镜头可随时预览；继续制作时自动跳过。'}</small>
        {error && <div role="alert" className="ca-film__error">{error}</div>}
      </div>
      <div className="ca-film__layout">
        <nav className="ca-film__nav" aria-label="镜头列表"><button className="ca-film__navitem" data-on={selected === -1 || undefined} onClick={() => setSelected(-1)}>剧本与设置</button>{plan.shots.map((shot, i) => <button key={i} className="ca-film__navitem" data-on={selected === i || undefined} onClick={() => setSelected(i)}><b>{String(i + 1).padStart(2, '0')}</b><span>{shot.title}<small>{shot.src ? '✓ 已完成 · 点击预览' : active === i ? '● 正在生成' : shot.error ? '! 已中断 · 可重试' : shot.promptId ? '任务已提交 · 可接回' : `${shot.duration} 秒 · 待生成`}</small></span></button>)}{plan.result && <button className="ca-film__navitem" onClick={() => setSelected(-2)}>✓ 查看完整成片</button>}</nav>
        <div className="ca-film__content">
          {(selected === -1 || !s && selected !== -2) && <>
            <h3>1. 输入剧本，拆成可编辑分镜</h3><textarea aria-label="原始剧本" className="ca-panel__prompt" style={{ minHeight: 220 }} placeholder="粘贴故事或剧本；【画面】和【旁白】会自动拆成镜头与配音文本。" disabled={busy} value={plan.source} onChange={(e) => save({ source: e.target.value })} />
            <button className="ca-panel__secondary" disabled={busy || !plan.source.trim() || plan.shots.some((s) => s.src || s.promptId)} onClick={() => { save({ shots: scriptShots(plan.source), assemblyId: undefined, result: undefined }); setSelected(0) }}>拆分剧本为分镜</button>
            <p>已有镜头时请在左侧逐镜修改，原稿完整保留。镜头长度按下方设置，不会自动变成整集长片。</p>
            <h3>2. 设置视频和声音</h3>
            {plan.firstFrame && <p>首镜头已使用图片参考。</p>}
            <label>画幅比例 <select aria-label="分镜比例" disabled={busy || plan.shots.some((s) => s.promptId || s.src)} value={plan.ratio} onChange={(e) => save({ ratio: e.target.value })}>{['9:16', '16:9', '1:1'].map((r) => <option key={r}>{r}</option>)}</select></label>
            <label>未完成镜头画质 <select aria-label="分镜画质" disabled={busy || plan.shots.some((s) => !s.src && s.promptId)} value={plan.resolution} onChange={(e) => save({ resolution: e.target.value })}>{['384p', '512p', '768p', '1080p'].map((r) => <option key={r}>{r}{r === '384p' ? ' · 快速预览' : ''}</option>)}</select></label>
            <small>1080p 加载、采样和解码耗时较长。改画质保留已完成镜头，合成时统一到首镜头尺寸。</small>
            <label><input type="checkbox" checked={plan.voice} disabled={busy} onChange={(e) => save({ voice: e.target.checked, assemblyId: undefined, result: undefined })} /> 加入中文旁白与字幕</label>
          </>}
          {s && selected >= 0 && <section className="ca-film__shot">
            <div className="ca-film__shothead"><h3>{s.title}</h3><select aria-label={`镜头 ${selected + 1} 时长`} disabled={busy || !!s.src || !!s.promptId} value={s.duration} onChange={(e) => edit(selected, { duration: Number(e.target.value) })}>{[5, 10, 15].map((d) => <option key={d} value={d}>{d} 秒</option>)}</select></div>
            {s.src ? <video key={s.src} controls preload="metadata" src={s.src} className="ca-film__preview" /> : <div className="ca-film__empty">{active === selected ? `${stage?.stage || '正在准备'}…` : s.error ? '此镜头中断，已完成镜头不受影响' : s.promptId ? '任务已提交，继续制作可取回进度' : '视频生成后会显示在这里'}</div>}
            <label>画面描述<textarea aria-label={`镜头 ${selected + 1} 画面`} className="ca-panel__prompt" style={{ minHeight: 130 }} disabled={busy || !!s.src || !!s.promptId} value={s.prompt} onChange={(e) => edit(selected, { prompt: e.target.value })} /></label>
            <label>中文旁白与字幕<textarea aria-label={`镜头 ${selected + 1} 旁白`} className="ca-panel__prompt" style={{ minHeight: 70 }} placeholder="留空时只保留环境声" disabled={busy} value={s.narration} onChange={(e) => edit(selected, { narration: e.target.value })} /></label>
            {s.error && <div className="ca-film__error">{/Failed to fetch/i.test(s.error) ? '上次连接中断；点击继续制作将核对任务状态。' : s.error}</div>}
            {s.src && <a href={s.src} download>下载此镜头</a>}
            {!s.src && !s.promptId && <button className="ca-panel__secondary" disabled={busy} onClick={() => { save({ shots: plan.shots.filter((_, n) => selected !== n) }); setSelected(Math.max(0, selected - 1)) }}>移除此未完成镜头</button>}
          </section>}
          {selected === -2 && plan.result && <><h3>完整成片</h3><video controls src={plan.result} className="ca-film__preview" /><a href={plan.result} download>下载成片</a></>}
        </div>
      </div>
      <div className="ca-panel__foot ca-film__foot">
        <span>{busy ? '收起窗口可继续使用画布；请保持页面打开。' : '分镜 → 生成动态视频 → 配音字幕 → 导出'}</span>
        {busy ? <button className="ca-panel__secondary" onClick={() => { stop.current = true; setStatus('已请求暂停后续镜头；当前任务会保留') }}>暂停后续镜头</button> : <>
          <button className="ca-panel__secondary" onClick={() => { save({ shots: [...plan.shots, { title: `镜头 ${plan.shots.length + 1}`, prompt: '', narration: '', duration: 5 }] }); setSelected(plan.shots.length) }}>添加镜头</button>
          {completed < plan.shots.length && <button className="ca-panel__secondary" onClick={() => void run(false, true)}>只生成下一个镜头</button>}
          <button className="ca-panel__primary" disabled={!plan.shots.length} onClick={() => void run(completed === plan.shots.length)}>{completed === plan.shots.length && plan.shots.length ? '配音并合成成片' : completed || plan.shots.some((s) => s.promptId) ? '继续制作 · 跳过已完成' : '开始制作'}</button>
          {plan.result && <button className="ca-panel__secondary" onClick={() => setSelected(-2)}>查看成片</button>}
        </>}
      </div>
    </div>
  </div>, document.body)
}

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor, TLShapeId } from 'tldraw'
import { api, queuePrompt, viewUrl, waitForImages } from '../comfy'
import { createGenerator } from '../generate'
import { fileSrc, placeMedia, toMedia } from '../jobs'
import { annotated, imageToVideoGraph, t2vGraph, VIDEO_AREAS } from '../workflows'
import { scriptShots, validateShots, type StoryShot } from '../videoStory'
import { Icons } from './icons'

interface Shot extends StoryShot { promptId?: string }
interface Plan { source: string; shots: Shot[]; ratio: string; resolution: string; voice: boolean; assemblyId?: string; result?: string; firstFrame?: string }
const pause = () => new Promise((r) => setTimeout(r, 2000))
async function jsonRequest(url: string, body?: unknown) {
  const res = await api(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export function StoryVideoDialog({ editor, source, firstFrame, onClose }: { editor: Editor; source: string; firstFrame?: string; onClose: () => void }) {
  const saved = editor.getDocumentSettings().meta.videoStory as unknown as Plan | undefined
  const initial = source && source !== saved?.source ? { source, shots: scriptShots(source), ratio: '9:16', resolution: '384p', voice: true, firstFrame } : saved ?? { source, shots: [], ratio: '9:16', resolution: '384p', voice: true, firstFrame }
  const [plan, setPlan] = useState<Plan>(initial)
  const live = useRef(plan)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const stop = useRef(false)
  const save = (patch: Partial<Plan>) => {
    const next: Plan = JSON.parse(JSON.stringify({ ...live.current, ...patch })); live.current = next; setPlan(next)
    editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, videoStory: next as any } })
  }
  const edit = (index: number, patch: Partial<Shot>) => save({ shots: live.current.shots.map((s, i) => i === index ? { ...s, ...patch } : s), assemblyId: undefined, result: undefined })
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
  const assemble = async () => {
    let id = live.current.assemblyId
    if (!id) {
      const response = await jsonRequest('/comfyart/video/assemble', { clips: live.current.shots.map((s) => ({ src: s.src, narration: s.narration })), voice: live.current.voice })
      id = response.id; save({ assemblyId: id })
    }
    for (;;) {
      const job = await jsonRequest(`/comfyart/video/assemble/${id}`)
      setStatus(job.status === 'voicing' ? '正在生成本地中文旁白…' : `正在合成：${job.progress ?? 0}/${job.total ?? live.current.shots.length}`)
      if (job.status === 'error') { save({ assemblyId: undefined }); throw new Error(job.error) }
      if (job.status === 'done') {
        const src = await place(job.result, '分镜合成 · ' + (job.narrated ? '中文旁白 / 字幕' : '环境声'))
        save({ result: src }); setStatus(`已合成 ${job.seconds} 秒；原生动态镜头共 ${job.native_seconds} 秒${job.narrated ? '，已加入中文旁白和字幕（较长旁白会放慢对应镜头）' : '，保留原视频声音'}`)
        return
      }
      await pause()
    }
  }
  const run = async (mergeOnly = false) => {
    const invalid = validateShots(live.current.shots)
    if (invalid) { setError(invalid); return }
    setBusy(true); setError(''); stop.current = false
    try {
      if (!mergeOnly) for (let i = 0; i < live.current.shots.length; i++) {
        if (stop.current) { setStatus('已暂停；已完成的镜头保留，可继续。'); return }
        const s = live.current.shots[i]
        if (s.src) continue
        setStatus(`正在生成镜头 ${i + 1}/${live.current.shots.length}（逐镜执行）`)
        try {
          let promptId = s.promptId; let holder = s.holder
          if (!promptId) {
            if (!holder || !editor.getShape(holder as TLShapeId)) holder = createGenerator(editor, true, { prompt: s.prompt, ratio: live.current.ratio, resolution: live.current.resolution, duration: s.duration, workflow: 't2v-minimax-h3.api.json' }, false)
            const [a, b] = live.current.ratio.split(':').map(Number)
            const prompt = `${s.prompt}\nCinematic shot, consistent character appearance and costumes. Natural ambient sound. No subtitles or text overlays.`
            const area = VIDEO_AREAS[live.current.resolution]
            const built = i === 0 && live.current.firstFrame ? await imageToVideoGraph(annotated(live.current.firstFrame), prompt, a / b, s.duration, null, area) : await t2vGraph(prompt, a / b, s.duration, area)
            promptId = await queuePrompt(built.graph)
            edit(i, { promptId, holder, error: undefined })
          }
          const refs = await waitForImages(promptId, '92')
          if (!refs[0]) throw new Error('本镜头未返回视频文件。')
          const src = await place(refs[0], s.title, holder)
          edit(i, { src, error: undefined })
        } catch (e) { edit(i, { error: e instanceof Error ? e.message : String(e), promptId: undefined }); throw e }
      }
      if (stop.current) { setStatus('已暂停，镜头已保留。'); return }
      if (live.current.shots.some((s) => !s.src)) throw new Error('仍有镜头未完成，不能合成。')
      await assemble()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return createPortal(<div className="ca-modal" role="dialog" aria-label="分镜视频制作" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <div className="ca-modal__card ca-story" style={{ width: 'min(940px, calc(100vw - 32px))' }}>
      <div className="ca-side__head"><span>分镜视频制作 · {plan.shots.filter((s) => s.src).length}/{plan.shots.length} 镜头</span><button className="ca-panel__icon" title="关闭" disabled={busy} onClick={onClose}>{Icons.close}</button></div>
      <div className="ca-rename__body">
        <p>长剧本逐镜生成后合成，原稿和进度保存在当前项目。镜头时长由下方设置决定，不会自动变成每集 6 分钟。</p>
        {plan.firstFrame && <p>已附加第一张图片作为首镜头参考，后续镜头按分镜文字生成。</p>}
        <details><summary>原始剧本（完整保留）</summary><textarea aria-label="原始剧本" className="ca-panel__prompt" style={{ minHeight: 180 }} disabled={busy} value={plan.source} onChange={(e) => save({ source: e.target.value })} /></details>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="ca-panel__secondary" disabled={busy} onClick={() => save({ shots: scriptShots(plan.source), assemblyId: undefined, result: undefined })}>重新拆分剧本</button>
          <label>比例 <select aria-label="分镜比例" disabled={busy || plan.shots.some((s) => s.promptId || s.src)} value={plan.ratio} onChange={(e) => save({ ratio: e.target.value })}>{['9:16', '16:9', '1:1'].map((r) => <option key={r}>{r}</option>)}</select></label>
          <label>画质 <select aria-label="分镜画质" disabled={busy || plan.shots.some((s) => s.promptId || s.src)} value={plan.resolution} onChange={(e) => save({ resolution: e.target.value })}>{['384p', '512p', '768p', '1080p'].map((r) => <option key={r}>{r}{r === '384p' ? ' · 预览' : ''}</option>)}</select></label>
          <label><input type="checkbox" checked={plan.voice} disabled={busy} onChange={(e) => save({ voice: e.target.checked, assemblyId: undefined, result: undefined })} /> 中文旁白 + 字幕（按下方文本）</label>
          <span>原生镜头合计 {plan.shots.reduce((n, s) => n + s.duration, 0)} 秒</span>
        </div>
        {plan.shots.map((s, i) => <section key={i} className="ca-story__shot">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><strong>{s.title}</strong><select aria-label={`镜头 ${i + 1} 时长`} disabled={busy || !!s.src || !!s.promptId} value={s.duration} onChange={(e) => edit(i, { duration: Number(e.target.value) })}>{[5, 10, 15].map((d) => <option key={d} value={d}>{d} 秒</option>)}</select><span>{s.src ? '已完成' : s.promptId ? '待恢复生成结果' : s.error ? '失败 · 可重试' : '待生成'}</span><button className="ca-panel__icon" title={`删除镜头 ${i + 1}`} disabled={busy} onClick={() => save({ shots: plan.shots.filter((_, n) => i !== n), assemblyId: undefined, result: undefined })}>{Icons.close}</button></div>
          <textarea aria-label={`镜头 ${i + 1} 画面`} className="ca-panel__prompt" style={{ minHeight: 90 }} disabled={busy || !!s.src || !!s.promptId} value={s.prompt} onChange={(e) => edit(i, { prompt: e.target.value })} />
          <textarea aria-label={`镜头 ${i + 1} 旁白`} className="ca-panel__prompt" style={{ minHeight: 50 }} placeholder="准确的中文旁白；留空时只保留环境声" disabled={busy} value={s.narration} onChange={(e) => edit(i, { narration: e.target.value })} />
          {s.error && <div role="alert" style={{ color: '#ba3030', whiteSpace: 'pre-wrap' }}>{s.error}</div>}
          {s.src && <video controls preload="metadata" src={s.src} style={{ maxHeight: 160, maxWidth: '100%' }} />}
        </section>)}
        {status && <div role="status">{status}</div>}{error && <div role="alert" style={{ color: '#ba3030', whiteSpace: 'pre-wrap' }}>{error}</div>}
        {plan.result && <video controls src={plan.result} style={{ maxHeight: 420, maxWidth: '100%' }} />}
      </div>
        <div className="ca-panel__foot ca-story__foot">
          {busy ? <button className="ca-panel__secondary" onClick={() => { stop.current = true; setStatus('当前镜头完成后暂停；配音或合成阶段会完成当前合成。') }}>当前镜头后暂停</button> : <>
            <button className="ca-panel__secondary" onClick={() => save({ shots: [...plan.shots, { title: `镜头 ${plan.shots.length + 1}`, prompt: '', narration: '', duration: 5 }] })}>添加镜头</button>
            <button className="ca-panel__primary" disabled={!plan.shots.length} onClick={() => void run()}>生成 / 继续未完成镜头</button>
            <button className="ca-panel__secondary" disabled={!plan.shots.length || plan.shots.some((s) => !s.src)} onClick={() => void run(true)}>重新配音合成</button>
          </>}
        </div>
    </div>
  </div>, document.body)
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from 'tldraw'
import { api, viewUrl, type ImageRef } from '../comfy'
import { fileSrc, mediaAsset, placeMedia, toMedia } from '../jobs'
import { saveNow } from '../autosave'
import { filmActivityAtom } from './filmState'

export interface EpisodeSpec { id: string; title: string; scenes: { id: string; title: string; narration: { role: string; text: string }[] }[] }
interface Production {
  status: string; phase: string; stage: string; heartbeat: number; error?: string; value?: number; maximum?: number
  images_done?: number; clips_done?: number; voices_done?: number; voices_total?: number
  render?: { done: number; total: number; stage: string }
  scenes: { id: string; title: string; panels: ImageRef[]; clip?: ImageRef }[]; result?: ImageRef; preview?: ImageRef; preview_render?: { done: number; total: number; stage: string }; seconds?: number
}

export function EpisodeProduction({ editor, spec, visible, onClose }: { editor: Editor; spec: EpisodeSpec; visible: boolean; onClose: () => void }) {
  const [job, setJob] = useState<Production | null>(null)
  const [selected, setSelected] = useState(0)
  const [disconnected, setDisconnected] = useState(false)
  const [error, setError] = useState('')
  const [controlBusy, setControlBusy] = useState(false)
  const [final, setFinal] = useState(false)
  const polling = useRef(false)
  useEffect(() => {
    let alive = true
    const poll = async () => {
      if (polling.current) return
      polling.current = true
      let saving = false
      try {
        const r = await api(`/comfyart/video/production/${spec.id}?_=${Date.now()}`, { signal: AbortSignal.timeout(12000) })
        if (!r.ok) throw new Error('等待任务进度')
        const data: Production = await r.json()
        if (!alive) return
        setJob(data); setDisconnected(false)
        const activity = data.phase === 'videos' ? `动画 ${data.clips_done || 0}/6 · ${data.stage}${data.stage === '视频采样' ? ` ${data.value}/${data.maximum} 步` : ''}` : data.phase === 'voices' ? `角色配音 ${data.voices_done || 0}/${data.voices_total || 35}` : data.phase === 'images' ? `剧情画面 ${data.images_done || 0}/12` : data.phase === 'render' ? `剪辑字幕 ${data.render?.done || 0}/${data.render?.total || 18}` : data.stage
        filmActivityAtom.set({ busy: ['running', 'reconnecting', 'review'].includes(data.status), label: activity })
        if (data.status === 'done' && data.result) {
          saving = true
          const src = viewUrl(data.result)
          if (!editor.getCurrentPageShapes().some((s) => fileSrc(editor, s) === src)) {
            const media = await toMedia(data.result, 'video'); const center = editor.getViewportPageBounds().center
            const previousPlan = editor.getDocumentSettings().meta.videoStory as { result?: string; production?: EpisodeSpec } | undefined
            const previous = previousPlan?.production?.id === spec.id && previousPlan.result ? editor.getCurrentPageShapes().find((s) => fileSrc(editor, s) === previousPlan.result) : undefined
            const asset = mediaAsset(editor, previous)
            if (asset?.type === 'video') editor.updateAssets([{ id: asset.id, type: 'video', props: { ...asset.props, src, w: media.w, h: media.h, name: spec.title + ' · 完整配音漫剧' } }])
            else placeMedia(editor, media, spec.title + ' · 完整配音漫剧', center.x, center.y, 480)
          }
          const doc = editor.getDocumentSettings()
          const plan = doc.meta.videoStory as Record<string, unknown>
          if (plan?.result !== src) { editor.updateDocumentSettings({ meta: { ...doc.meta, videoStory: { ...plan, result: src } as any } }); await saveNow() }
          setError('')
        }
      } catch (e) { if (alive) { if (saving) setError('成片已生成，但画布保存失败：' + (e instanceof Error ? e.message : String(e))); else setDisconnected(true) } }
      finally { polling.current = false }
    }
    void poll(); const timer = setInterval(() => void poll(), 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [editor, spec.id])
  const control = async (pause: boolean) => {
    setControlBusy(true); setError('')
    try {
      const r = await api(`/comfyart/video/production/${spec.id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pause }) })
      const data = await r.json(); if (!r.ok) throw new Error(data.error || '任务操作失败')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setControlBusy(false) }
  }
  const scene = job?.scenes[selected]
  const detail = spec.scenes[selected]
  const playable = job?.result || job?.preview
  const phases = ['images', 'voices', 'videos', 'render', 'done']
  const phase = phases.indexOf(job?.phase || 'images')
  const [done, total] = job?.phase === 'images' ? [job.images_done || 0, 12] : job?.phase === 'videos' ? [job.clips_done || 0, 6] : job?.phase === 'voices' ? [job.voices_done || 0, job.voices_total || 35] : job?.phase === 'render' ? [job.render?.done || 0, job.render?.total || 18] : job?.status === 'done' ? [1, 1] : [0, 1]
  return createPortal(<div className="ca-modal" style={{ display: visible ? undefined : 'none' }} role="dialog" aria-modal="true" aria-label="第一集漫剧制作" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <div className="ca-modal__card ca-film">
      <div className="ca-film__head"><div><strong>{spec.title}</strong><small>约 6 分钟 · 9:16 · 动态漫画 / 角色对白 / 中文字幕</small></div><button className="ca-panel__secondary" onClick={onClose}>收起工作台</button></div>
      <div className="ca-film__progress">
        <div className="ca-film__steps">{['① 剧情画面', '② 分角色配音', '③ 关键动画', '④ 剪辑字幕'].map((label, i) => <span key={label} data-active={phase >= i || undefined}>{label}</span>)}</div>
        <div className="ca-film__meter"><strong>{job?.status === 'done' ? '完整一集已完成' : job?.phase === 'images' ? '漫画画面' : job?.phase === 'videos' ? '关键动作动画' : job?.phase === 'voices' ? '角色配音' : '制作进度'} {done}/{total}</strong><span>6 个主要场景 · 自动合成一条视频</span></div>
        <progress aria-label="当前制作阶段进度" value={done} max={total} />
        <div className="ca-film__live" role="status"><strong>{disconnected ? '连接暂时中断 · 正在重连' : job?.status === 'done' ? '第一集已完成 · 可直接播放或下载' : job?.status === 'paused' ? '制作已暂停 · 已完成素材保留' : (job?.phase === 'render' ? job.render?.stage : '') || job?.stage || '正在连接制作任务'}</strong><span>{job?.stage === '视频采样' && job.maximum ? `${job.value}/${job.maximum} 步` : ''}</span></div>
        {!disconnected && job?.stage === '视频采样' && !!job.maximum && <progress aria-label="关键动画采样进度" value={job.value} max={job.maximum} />}
        <small className="ca-film__hint">{job?.status === 'done' ? '本集已完成，文件保存在 5090 的 F 盘，可直接播放或下载。' : `${job ? `任务心跳：${Math.max(0, Math.floor(Date.now() / 1000 - job.heartbeat))} 秒前。` : ''}制作在 5090 上运行，收起或刷新页面不会重复提交。`}</small>
        {job?.preview_render && !job.result && <small className="ca-film__hint">配音动态漫画版合成：{job.preview_render.done}/{job.preview_render.total} · {job.preview_render.stage}</small>}
        {(job?.error || error) && <div role="alert" className="ca-film__error">{error || job?.error}</div>}
      </div>
      <div className="ca-film__layout">
        <nav className="ca-film__nav" aria-label="第一集主要场景">{spec.scenes.map((s, i) => <button key={s.id} className="ca-film__navitem" data-on={!final && selected === i || undefined} onClick={() => { setSelected(i); setFinal(false) }}><b>{s.id}</b><span>{s.title}<small>{job?.scenes[i]?.clip ? '✓ 动画素材已完成' : job?.scenes[i]?.panels.length ? '✓ 剧情画面已生成' : '待生成'}</small></span></button>)}{playable && <button className="ca-film__navitem" data-on={final || undefined} onClick={() => setFinal(true)}>▶ {job?.result ? '播放完整第一集' : '播放动态漫画版预览'}</button>}</nav>
        <div className="ca-film__content">
          {final && playable ? <><h3>{job?.result ? '第一集完整成片' : '第一集配音动态漫画版 · 人物动作动画尚未完成'} · 360 秒</h3><video className="ca-film__preview ca-episode-video" controls preload="metadata" poster={job?.scenes[0]?.panels[0] ? viewUrl(job.scenes[0].panels[0]) : undefined} src={viewUrl(playable)} /><a href={viewUrl(playable)} download>下载六分钟视频</a></> : <>
            <h3>{detail.title}</h3>
            {scene?.clip && <video className="ca-film__preview ca-episode-video" controls preload="metadata" poster={scene.panels[0] ? viewUrl(scene.panels[0]) : undefined} src={viewUrl(scene.clip)} />}
            {!!scene?.panels.length ? <div className="ca-episode-panels">{scene.panels.map((ref) => <img key={ref.filename} src={viewUrl(ref)} alt={detail.title + '剧情画面'} />)}</div> : <div className="ca-film__empty">正在按人物与情节生成本场景画面</div>}
            <details open><summary>本场景旁白和对白</summary>{detail.narration.map((cue, i) => <p key={i}><strong>{cue.role}：</strong>{cue.text}</p>)}</details>
          </>}
        </div>
      </div>
      <div className="ca-panel__foot ca-film__foot"><span>旧的 12 镜头计划已归档；本集单独制作。</span>{job && ['paused', 'error', 'review'].includes(job.status) ? <button className="ca-panel__primary" disabled={controlBusy} onClick={() => void control(false)}>继续整集制作</button> : job?.status !== 'done' ? <button className="ca-panel__secondary" disabled={controlBusy} onClick={() => void control(true)}>暂停本集任务</button> : <button className="ca-panel__primary" onClick={() => setFinal(true)}>播放完整第一集</button>}</div>
    </div>
  </div>, document.body)
}

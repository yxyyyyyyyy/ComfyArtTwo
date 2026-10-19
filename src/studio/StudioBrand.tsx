import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../ui/icons'

export function StudioBrand() {
  return <span className="mj-brand"><span className="mj-brand__mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 7v18M11 10v12M17 6v20M23 10v12M29 7v18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span><span><b>幕间</b><small>MUJIAN STUDIO</small></span></span>
}

export function StudioSidebar({ active, items, onHome, onNew }: { active: string; items: { id: string; label: string; icon: ReactNode; onClick: () => void }[]; onHome: () => void; onNew: () => void }) {
  const [about, setAbout] = useState(false)
  return <aside className="mj-sidebar"><button type="button" className="mj-brand-button" aria-label="幕间创作首页" onClick={onHome}><StudioBrand /></button>
    <button type="button" className="mj-new" onClick={onNew}><span className="ca-icon">{Icons.plus}</span>新建项目<span>＋</span></button>
    <span className="mj-nav-caption">创作空间</span><nav aria-label="创作工作台导航">{items.map((item) => <button type="button" key={item.id} className="mj-nav-item" aria-label={item.label} title={item.label} aria-current={active === item.id ? 'page' : undefined} onClick={item.onClick}><span className="ca-icon">{item.icon}</span><span>{item.label}</span>{active === item.id && <i />}</button>)}</nav>
    <div className="mj-sidebar__bottom"><div className="mj-local"><span className="ca-icon">{Icons.box}</span><div><strong>本地创作</strong><small>Agent · 图片 · 视频</small></div></div><button type="button" className="mj-about-link" onClick={() => setAbout(true)}>关于幕间 / 开源致谢<span>↗</span></button><small className="mj-version">创作开发版 · 0.2</small></div>
    {about && <StudioAbout onClose={() => setAbout(false)} />}
  </aside>
}

function StudioAbout({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return createPortal(<dialog ref={ref} className="mj-about" onCancel={onClose} onClose={onClose} aria-label="关于幕间与开源致谢"><StudioBrand /><h2>让灵感，成为作品。</h2><p>幕间是通用 AI 创作工作台，保留 Agent、图片生成与编辑、视频制作和自由画布。漫剧制作是其中一个演示案例，也可用于设计、海报、品牌素材和短视频创作。</p><p>基于 <a href="https://github.com/jtydhr88/ComfyArt" target="_blank" rel="noreferrer">ComfyArt</a> 二次开发。原项目由 Terry Jia 创建，采用 MIT 许可；原版权与许可文本完整保留。</p><p>底层使用 ComfyUI，画布采用 tldraw SDK。引擎、组件与模型分别遵循各自许可证；tldraw 的开发标识和授权要求保留。</p><button type="button" className="mj-button mj-button--primary" onClick={onClose}>返回创作</button></dialog>, document.body)
}

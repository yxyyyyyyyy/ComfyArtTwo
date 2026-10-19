import { openView } from '../projects'
import { Confirm } from '../ui/Confirm'
import { Icons } from '../ui/icons'
import { SettingsMenu } from '../ui/SettingsMenu'
import { StudioSidebar } from '../studio/StudioBrand'
import { newCreativeProject } from '../studio/navigation'
import '../styles/home.css'
import '../styles/studio.css'
import { Home } from './Home'
import { NotFound } from './NotFound'
import { Projects } from './Projects'

type View = 'home' | 'projects' | { missing: string }
export function HomeApp({ view }: { view: View }) {
  return <div className="mj-shell mj-home"><StudioSidebar active={typeof view === 'string' ? view : ''} onHome={() => openView('home')} onNew={() => newCreativeProject()} items={[
    { id: 'home', label: '创作首页', icon: Icons.home, onClick: () => openView('home') },
    { id: 'projects', label: '我的项目', icon: Icons.folder, onClick: () => openView('projects') },
    { id: 'agent', label: 'Agent 创作', icon: Icons.agent, onClick: () => newCreativeProject('agent') },
    { id: 'image', label: '图片制作', icon: Icons.genImage, onClick: () => newCreativeProject('image') },
    { id: 'video', label: '视频制作', icon: Icons.genVideo, onClick: () => newCreativeProject('video') },
  ]} /><main className="mj-home-main">{view === 'home' ? <Home /> : view === 'projects' ? <div className="mj-library"><header className="mj-library-title"><span className="mj-eyebrow">YOUR CREATIVE PROJECTS</span><h1>我的项目</h1><p>管理项目、素材与每一次创作。</p><button type="button" className="mj-button mj-button--primary" onClick={() => newCreativeProject()}>＋ 新建项目</button></header><Projects /></div> : <NotFound id={view.missing} />}</main><SettingsMenu trigger={({ toggle }) => <button type="button" className="mj-home-settings" aria-label="设置" onClick={toggle}><span className="ca-icon">{Icons.settings}</span></button>} /><Confirm /></div>
}

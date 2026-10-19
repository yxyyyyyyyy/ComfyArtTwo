import { openView } from '../projects'
import { Confirm } from '../ui/Confirm'
import { Icons } from '../ui/icons'
import { SettingsMenu } from '../ui/SettingsMenu'
import { StudioSidebar } from '../studio/StudioBrand'
import { newStudioProject } from '../studio/navigation'
import '../styles/home.css'
import '../styles/studio.css'
import { Home } from './Home'
import { NotFound } from './NotFound'
import { Projects } from './Projects'

type View = 'home' | 'projects' | { missing: string }
export function HomeApp({ view }: { view: View }) {
  return <div className="mj-shell mj-home"><StudioSidebar active={typeof view === 'string' ? view : ''} onHome={() => openView('home')} onNew={() => newStudioProject()} items={[
    { id: 'home', label: '创作首页', icon: Icons.home, onClick: () => openView('home') },
    { id: 'projects', label: '我的项目', icon: Icons.folder, onClick: () => openView('projects') },
  ]} /><main className="mj-home-main">{view === 'home' ? <Home /> : view === 'projects' ? <div className="mj-library"><header className="mj-library-title"><span className="mj-eyebrow">YOUR STORY COLLECTION</span><h1>我的项目</h1><p>管理故事、素材与每一次创作。</p><button type="button" className="mj-button mj-button--primary" onClick={() => newStudioProject()}>＋ 新建漫剧</button></header><Projects /></div> : <NotFound id={view.missing} />}</main><SettingsMenu trigger={({ toggle }) => <button type="button" className="mj-home-settings" aria-label="设置" onClick={toggle}><span className="ca-icon">{Icons.settings}</span></button>} /><Confirm /></div>
}

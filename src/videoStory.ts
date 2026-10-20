/** Script parsing is deterministic: the original script is retained, never sent as one shot. */
export interface StoryShot { title: string; prompt: string; narration: string; duration: number; directed?: boolean; src?: string; holder?: string; error?: string }
export function isVideoScript(text: string): boolean {
  return text.length > 700 || (text.match(/【画面[^】]*】/g)?.length ?? 0) > 1 || (text.match(/^#{1,3}\s*第.+集/gm)?.length ?? 0) > 1
}
const clean = (s: string) => s.replace(/\*\*/g, '').replace(/^>\s?/gm, '').trim()
export function scriptShots(text: string): StoryShot[] {
  const shots: StoryShot[] = []
  let title = '故事'; let lines: string[] = []
  const flush = () => {
    const body = clean(lines.join('\n')).replace(/^旁白[：:]\s*/gm, '【旁白】\n'); lines = []
    if (!body) return
    const parts = body.split(/【旁白】/)
    const prompt = parts[0].replace(/【[^】]*】/g, '').trim()
    if (!prompt) return
    const visuals = prompt.split(/\n(?=(?:全景|中景|特写|转场|俯拍|远景|追逐戏|结尾镜头|闪回)[：:])/).filter((s) => s.trim())
    const narration = clean(parts.slice(1).join('\n')).replace(/【[^】]*】/g, '').trim()
    const sentences = narration.match(/[^。！？!?]+[。！？!?]?/g) ?? []
    for (const [i, visual] of visuals.entries()) {
      const from = Math.floor(i * sentences.length / visuals.length)
      const to = Math.floor((i + 1) * sentences.length / visuals.length)
      shots.push({ title: `${title} · 镜头 ${shots.length + 1}`, prompt: visual.trim(), narration: sentences.slice(from, to).join(''), duration: 5 })
    }
  }
  let started = false
  for (const line of text.split('\n')) {
    if (/^#{1,3}\s/.test(line)) { flush(); title = clean(line.replace(/^#+\s*/, '')); continue }
    if (/【画面[^】]*】/.test(line)) { flush(); started = true; const rest = line.replace(/【画面[^】]*】/, '').trim(); if (rest) lines.push(rest); continue }
    if (started && !/【全剧终】/.test(line)) lines.push(line)
  }
  flush()
  if (!shots.length) {
    for (const [i, paragraph] of text.split(/\n\s*\n/).filter((s) => clean(s)).entries()) {
      shots.push({ title: `镜头 ${i + 1}`, prompt: clean(paragraph), narration: '', duration: 5 })
    }
  }
  return shots
}
export function validateShots(shots: StoryShot[]): string | null {
  if (!shots.length) return '请先添加分镜。'
  if (shots.length > 60) return '本批最多 60 个镜头，请按集分批制作；原始剧本不会截断。'
  for (const [i, shot] of shots.entries()) {
    const limit = shot.directed ? 3500 : 900
    if (!shot.prompt.trim() || shot.prompt.length > limit) return `镜头 ${i + 1} 的画面描述需为 1–${limit} 字，请拆分过长镜头。`
    if (shot.narration.length > 150) return `镜头 ${i + 1} 的旁白超过 150 字，请拆分。`
    if (![5, 10, 15].includes(shot.duration)) return `镜头 ${i + 1} 的时长应为 5、10 或 15 秒。`
  }
  return null
}

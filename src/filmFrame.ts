import { uploadImage, viewUrl } from './comfy'

/** Capture an actual final video frame for a continuous next shot. */
export async function continuityFrame(src: string): Promise<string> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('镜头接续画面读取超时，请重试。')), 30000)
      video.onerror = () => reject(new Error('无法读取上一镜头的视频，请检查素材是否存在。'))
      video.onloadeddata = () => resolve()
      video.src = src
    })
    clearTimeout(timer)
    if (!Number.isFinite(video.duration) || !video.videoWidth) throw new Error('上一镜头没有有效的视频画面。')
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('提取镜头接续画面超时，请重试。')), 30000)
      video.onseeked = () => resolve()
      video.currentTime = Math.max(0, video.duration - .12)
    })
    clearTimeout(timer)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('接续画面导出失败。')), 'image/png'))
    return viewUrl(await uploadImage(blob, `film-continuity-${crypto.randomUUID()}.png`))
  } finally {
    clearTimeout(timer)
    video.removeAttribute('src'); video.load()
  }
}

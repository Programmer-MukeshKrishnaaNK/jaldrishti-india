import { useEffect, useRef } from 'react'

/** Height of the strip along the bottom kept clear so Google's logo and attribution are never covered. */
export const LOGO_CLEARANCE_PX = 64

interface RainCanvasProps {
  playing: boolean
  density: number
}

/**
 * Screen-space rain drawn over the map. It is purely illustrative: it is not placed in
 * the 3D scene, does not interact with Google content and represents no rainfall rate.
 */
export function RainCanvas({ playing, density }: RainCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    if (!playing) {
      context.clearRect(0, 0, element.width, element.height)
      return
    }
    const ratio = Math.min(window.devicePixelRatio, 2)
    const resize = () => {
      element.width = element.clientWidth * ratio
      element.height = element.clientHeight * ratio
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)

    const count = Math.round(250 + density * 1250)
    const drops = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), speed: 0.6 + Math.random() * 0.5 }))
    let frame = 0
    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const width = element.width
      const height = element.height - LOGO_CLEARANCE_PX * ratio
      context.clearRect(0, 0, element.width, element.height)
      context.strokeStyle = 'rgba(214, 230, 244, 0.55)'
      context.lineWidth = 1.2 * ratio
      context.beginPath()
      for (const d of drops) {
        d.y += d.speed * dt
        d.x += 0.04 * dt
        if (d.y > 1) {
          d.y -= 1
          d.x = Math.random()
        }
        const x = (d.x % 1) * width
        const y = d.y * height
        context.moveTo(x, y)
        context.lineTo(x - 2 * ratio, y - 16 * ratio)
      }
      context.stroke()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      context.clearRect(0, 0, element.width, element.height)
    }
  }, [playing, density])

  return <canvas ref={canvas} className="gmv-rain-canvas" aria-hidden="true" />
}

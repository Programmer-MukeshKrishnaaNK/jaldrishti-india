/**
 * Whether this browser can create a WebGL context. Kept apart from the 3D view so the
 * app can check it without downloading Three.js.
 */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export const WEBGL_UNAVAILABLE = 'This browser or device could not start WebGL, which the 3D view needs.'
export const WEBGL_LOST = 'The 3D view lost access to the graphics hardware, often because the device ran low on memory.'

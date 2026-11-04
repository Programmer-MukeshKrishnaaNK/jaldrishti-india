/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Maps Demo Key for the Google 2D and Photorealistic 3D views. Read at build time
   * from the environment (locally `.env.local`, in CI the repository secret of the same
   * name); never written in source. A browser key is visible to anyone using the site.
   */
  readonly VITE_GOOGLE_MAPS_DEMO_KEY?: string
}

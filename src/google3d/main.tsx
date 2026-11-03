import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '../styles/tokens.css'
import '../styles/global.css'
import '../features/explore/ExplorePanel.css'
import '../features/hydrology/HydrologySection.css'
import { Google3DPage } from './Google3DPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Google3DPage />
  </StrictMode>,
)

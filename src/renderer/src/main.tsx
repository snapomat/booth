import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
// Schriften lokal bündeln (offline-fähige Kiosk-Box, kein Google-Fonts-CDN).
import '@fontsource-variable/playfair-display/index.css'
import '@fontsource-variable/playfair-display/wght-italic.css'
import '@fontsource-variable/hanken-grotesk/index.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

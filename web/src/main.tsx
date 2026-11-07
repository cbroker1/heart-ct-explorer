import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setConsoleFunction } from 'three'
import App from './App'

// @react-three/fiber 9.8 still instantiates THREE.Clock, which three r183+ deprecates. Silence just
// that one notice; everything else goes to the console unchanged.
setConsoleFunction((type: string, message: string, ...params: unknown[]) => {
  if (type === 'warn' && String(message).includes('Clock: This module has been deprecated')) return
  const fn = (console as unknown as Record<string, (...a: unknown[]) => void>)[type] ?? console.log
  fn(message, ...params)
})
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

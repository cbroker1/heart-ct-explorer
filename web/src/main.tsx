import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// @react-three/fiber 9.8 still instantiates THREE.Clock, which three r183+ deprecates. Drop just that
// one notice at the console level (importing three here would pull its core into the entry chunk).
const nativeWarn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Clock: This module has been deprecated')) return
  nativeWarn(...args)
}
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./App"
import { startAppCopy } from "./lib/device-copy/device"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Keep the app itself on this device (offline service worker for /app/); see src/lib/device-copy.
startAppCopy()

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { ActPage } from "./components/TokenPages"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ActPage />
  </StrictMode>,
)

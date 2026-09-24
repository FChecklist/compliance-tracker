import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { BrandLine } from "./components/BrandLine"
import { UnsubscribePage } from "./components/TokenPages"

// WO-DPDP-014 §3: the brand line, never the share ask -- a token page.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrandLine />
    <UnsubscribePage />
  </StrictMode>,
)

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { BrandLine } from "./components/BrandLine"
import { ParentConsentPage } from "./components/TokenPages"

// WO-DPDP-014 §3: the brand line, never the share ask -- parents see the
// line and nothing else of the programme.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrandLine />
    <ParentConsentPage />
  </StrictMode>,
)

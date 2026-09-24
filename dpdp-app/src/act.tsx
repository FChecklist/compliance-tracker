import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { BrandLine } from "./components/BrandLine"
import { ActPage } from "./components/TokenPages"

// WO-DPDP-014 §3: the brand line, never the share ask -- this is a token
// page a staff member reaches from an email.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrandLine />
    <ActPage />
  </StrictMode>,
)

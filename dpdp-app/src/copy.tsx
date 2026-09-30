import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { BrandLine } from "./components/BrandLine"
import { CopyPromptPage } from "./components/CopyPromptPage"

// The one-tap Copy page behind the Monday email's "Copy" button (/copy/#<token>). WO-DPDP-014 §3: the brand line, never the share ask.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrandLine />
    <CopyPromptPage />
  </StrictMode>,
)

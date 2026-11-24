import { Component, type ReactNode } from "react"

/** The product id Moneypenny Chat is mounted for on this site. */
export const MONEYPENNY_PRODUCT_ID = "veridian-aios-dpdp"

/**
 * The mount point for Moneypenny Chat: the same chat as the other products, a separate module that is mounted here later.
 * Today it renders nothing. It is on every Partner and client screen (one mount in App.tsx), and it can never break a page:
 * a later module that throws is caught here and replaced by nothing.
 */
export function MoneypennyChatMount({ productId, children }: { productId: string; children?: ReactNode }) {
  return (
    <Quiet>
      {/* children is the later module; nothing is passed yet. */}
      {children ? <div data-moneypenny-product={productId}>{children}</div> : null}
    </Quiet>
  )
}

class Quiet extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* a failed chat module must never take the page with it */ }
  render() { return this.state.failed ? null : this.props.children }
}

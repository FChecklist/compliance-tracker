// Cloudflare Pages Function (middleware) for the public pages. See
// functions/_referral.ts for why. public/_routes.json limits it to the public
// page paths (and /ai/*), so static assets never invoke it; for those pages it
// does nothing at all unless a valid ?ref=<code> is present, in which case it
// rewrites the page's own internal links with HTMLRewriter and serves the
// result privately (never shared-cached, since the body depends on the code).
import { carryRef, shouldRewrite } from "./_referral"

type Context = { request: Request; next: () => Promise<Response> }

export const onRequest = async (ctx: Context): Promise<Response> => {
  const code = shouldRewrite(ctx.request.method, new URL(ctx.request.url))
  const res = await ctx.next()
  if (!code || res.status !== 200 || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return res

  const out = new HTMLRewriter()
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href")
        const next = href === null ? null : carryRef(href, code)
        if (next !== null) el.setAttribute("href", next)
      },
    })
    .transform(res)
  const headers = new Headers(out.headers)
  headers.set("Cache-Control", "private, no-store")
  headers.delete("ETag")
  return new Response(out.body, { status: out.status, headers })
}

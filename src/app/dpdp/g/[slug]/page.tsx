import { notFound } from "next/navigation"
import { getPublicPageBySlug } from "@/lib/services/dpdp-governance-service"
import { Card, CardContent } from "@/components/ui/card"

export default async function PublicOrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const result = await getPublicPageBySlug(slug)
  if (!result?.org) notFound()

  return (
    <div className="min-h-screen bg-[#FCFBFF] flex items-center justify-center px-4 py-10">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 space-y-4">
          <div>
            <div className="font-extrabold text-lg">{result.org.name}</div>
            <div className="text-xs text-[#8E86AD]">How to reach us about your information</div>
          </div>
          {result.officer && (
            <div className="border-t pt-3">
              <div className="text-xs font-semibold text-[#6D28D9]">🎧 Grievance Officer</div>
              <div className="text-sm mt-1"><b>{result.officer.personName}</b><br />{result.officer.email}</div>
            </div>
          )}
          <div className="border-t pt-3 text-xs text-[#564D77]">
            What you can do here: see what we hold · correct it · ask us to delete it · withdraw a permission · complain.
            <div className="mt-2 inline-block bg-[#FCE7F3] text-[#BE185D] rounded-full px-2 py-0.5 text-[10px] font-semibold">No account needed</div>
          </div>
          <div className="border-t pt-3 text-[11px] text-[#8E86AD]">Not happy with our answer? You may go to the Data Protection Board of India.</div>
        </CardContent>
      </Card>
    </div>
  )
}

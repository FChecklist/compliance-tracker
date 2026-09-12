// Wave 124/127: pure re-export, same grouping rationale as ../route.ts.
// R46/E-126b: DELETE added the same way, re-exporting the new handler.
// R80/GAP-14: PATCH (BOQ header) added the same way.
export { GET, PATCH, DELETE } from "@/app/api/v1/construction/boq/[id]/route"

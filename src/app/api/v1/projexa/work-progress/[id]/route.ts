// R67 lane D22 (item D-77) + R67 D-28: the PROJEXA-facing alias of one
// work-progress entry, mirroring how v1/projexa/work-progress/route.ts already
// re-exports the construction list/create pair -- this namespace is an alias
// over the construction one, never a second handler. PROJEXA's veridian-client
// calls /v1/projexa/*, so an endpoint that only exists under /v1/construction/*
// is unreachable from the product that needs it.
export { GET, PATCH, DELETE } from "@/app/api/v1/construction/progress/[id]/route"

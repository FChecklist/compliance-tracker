import { z } from "zod";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  plan_type: "single_entity" | "multi_client";
  owner_id: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const OrganisationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  plan_type: z.enum(["single_entity", "multi_client"]),
  owner_id: z.string().uuid(),
  is_active: z.boolean().default(true),
  settings: z.record(z.unknown()).default({}),
});

export const CreateOrganisationSchema = OrganisationSchema.omit({ id: true, created_at: true, updated_at: true });
export const UpdateOrganisationSchema = OrganisationSchema.partial().omit({ id: true, created_at: true, updated_at: true });
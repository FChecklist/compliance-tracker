import { z } from "zod";

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  DB_SCHEMA: z.string().default("compliance_tracker"),

  // Auth
  JWT_SECRET: z.string().min(32),

  // App
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),

  // Integrations (optional)
  RESEND_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VERCEL_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables. Check your .env file.");
  }
  return result.data;
}
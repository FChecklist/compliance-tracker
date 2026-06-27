import { z } from "zod";
declare const envSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    NEXT_PUBLIC_API_URL: z.ZodDefault<z.ZodString>;
    JWT_SECRET: z.ZodString;
    SUPABASE_URL: z.ZodString;
    SUPABASE_ANON_KEY: z.ZodString;
    RESEND_API_KEY: z.ZodOptional<z.ZodString>;
    ANTHROPIC_API_KEY: z.ZodOptional<z.ZodString>;
    VERCEL_URL: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    NEXT_PUBLIC_API_URL: string;
    JWT_SECRET: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    RESEND_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    VERCEL_URL?: string | undefined;
}, {
    DATABASE_URL: string;
    JWT_SECRET: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    NEXT_PUBLIC_API_URL?: string | undefined;
    RESEND_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
    VERCEL_URL?: string | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
export declare function validateEnv(): Env;
export {};
//# sourceMappingURL=env.d.ts.map
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "fallback-secret-change-in-production");

export interface SessionPayload extends JWTPayload {
  sub: string;
  email: string;
  org_id: string;
  role: string;
  full_name: string;
  iat: number;
  exp: number;
}

export async function createSessionToken(payload: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
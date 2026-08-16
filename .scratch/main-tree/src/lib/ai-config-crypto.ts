import postgres from "postgres"
import { getConnectionString } from "@/lib/db/connection-string"

// pgcrypto calls need a raw SQL round-trip since Drizzle has no
// pgp_sym_encrypt helper. Connection-string resolution shared with
// lib/db/index.ts and lib/embeddings.ts (gap closure, 2026-07-09 -- this
// file's own copy had the stale, pre-Wave-45 pooler region until now).

let rawClient: ReturnType<typeof postgres> | null = null
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      // Gap closure, 2026-07-09: explicit low cap -- occasional BYOK
      // encrypt/decrypt calls, not hot-path traffic. See embeddings.ts's
      // matching comment for the pooler-exhaustion reasoning.
      max: 2,
    })
  }
  return rawClient
}

function getEncryptionKey(): string {
  const key = process.env.AI_CONFIG_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "AI_CONFIG_ENCRYPTION_KEY is not set. Generate one (openssl rand -base64 32) and set it before storing BYOK API keys."
    )
  }
  return key
}

/** Encrypts a plaintext API key with pgcrypto (pgp_sym_encrypt), returns base64 ciphertext for storage in `ai_configurations.encrypted_api_key`. */
export async function encryptApiKey(plaintext: string): Promise<string> {
  const client = getRawClient()
  const key = getEncryptionKey()
  const [row] = await client`SELECT encode(pgp_sym_encrypt(${plaintext}, ${key}), 'base64') as enc`
  return row.enc as string
}

/** Decrypts ciphertext produced by encryptApiKey. Only call this server-side, right before using the key to call a provider — never return the result to a client. */
export async function decryptApiKey(ciphertext: string): Promise<string> {
  const client = getRawClient()
  const key = getEncryptionKey()
  const [row] = await client`SELECT pgp_sym_decrypt(decode(${ciphertext}, 'base64'), ${key}) as dec`
  return row.dec as string
}

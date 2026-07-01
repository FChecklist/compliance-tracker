import postgres from "postgres"

// Same connection-string resolution as lib/db/index.ts and lib/embeddings.ts —
// pgcrypto calls need a raw SQL round-trip since Drizzle has no pgp_sym_encrypt helper.
function getConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0]
    return `postgresql://postgres.${ref}:${dbPassword}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
  }

  throw new Error("No database connection string available.")
}

let rawClient: ReturnType<typeof postgres> | null = null
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
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

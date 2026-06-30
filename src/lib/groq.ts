/**
 * Shared Groq LLM call utility.
 * Uses Llama 3.3 70B for chat completions.
 */
export async function callGroqLLM(
  systemPrompt: string,
  userMessage: string,
  options?: {
    apiKey?: string;
    temperature?: number;
    jsonMode?: boolean;
    maxTokens?: number;
  }
): Promise<string> {
  const key = options?.apiKey || process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not configured. Set the env var or provide a BYOK key."
    );
  }

  const body: Record<string, unknown> = {
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2048,
  };

  if (options?.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content as string;
}

/**
 * Call Groq LLM and parse the response as JSON.
 */
export async function callGroqLLMJson<T>(
  systemPrompt: string,
  userMessage: string,
  options?: {
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<T> {
  const raw = await callGroqLLM(systemPrompt, userMessage, {
    ...options,
    jsonMode: true,
  });
  return JSON.parse(raw) as T;
}

/**
 * Get a Groq API key — checks BYOK org config first, falls back to env.
 * For now, always returns env var; BYOK lookup can be added later.
 */
export function getGroqApiKey(orgApiKey?: string): string | undefined {
  return orgApiKey || process.env.GROQ_API_KEY;
}
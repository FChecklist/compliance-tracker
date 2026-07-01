/**
 * Provider-agnostic LLM client -- supports the 4 providers in the
 * `ai_provider` enum (groq/openai/anthropic/google), so `customer_model_config`
 * (Wave 4) can actually route requests to whichever provider a customer has
 * configured per Orchestra Layer, not just the platform-default Groq key.
 *
 * Groq and OpenAI share the same request/response shape (OpenAI's chat
 * completions API); Anthropic and Google each have their own shape.
 */

export type LLMProvider = "groq" | "openai" | "anthropic" | "google";

export type CallLLMOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2048,
  };
  if (options?.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${baseUrl} error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data.choices[0].message.content as string;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<string> {
  // Anthropic's Messages API has no response_format=json_object equivalent --
  // ask for JSON-only output in the system prompt instead, same as every
  // other provider does when jsonMode is requested but not natively supported.
  const system = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.`
    : systemPrompt;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.2,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data.content[0].text as string;
}

async function callGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<string> {
  const prompt = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.\n\n${userMessage}`
    : `${systemPrompt}\n\n${userMessage}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxTokens ?? 2048,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text as string;
}

/** Dispatches to whichever provider is configured. `model` should be a real model name for that provider. */
export async function callLLM(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<string> {
  switch (provider) {
    case "groq":
      return callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "openai":
      return callOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "anthropic":
      return callAnthropic(apiKey, model, systemPrompt, userMessage, options);
    case "google":
      return callGoogle(apiKey, model, systemPrompt, userMessage, options);
  }
}

export async function callLLMJson<T>(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<T> {
  const raw = await callLLM(provider, model, apiKey, systemPrompt, userMessage, { ...options, jsonMode: true });
  return JSON.parse(raw) as T;
}

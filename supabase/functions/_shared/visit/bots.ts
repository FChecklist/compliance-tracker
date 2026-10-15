// Visitor-journey tracking -- is this a crawler? PURE. Bots are recorded apart (so the owner can see SEO crawl visibility) and never enter a human funnel.
// Matched on the User-Agent the server saw; the list names the crawlers that matter for search and AI visibility, then a generic catch for the rest.

const NAMED: Array<[RegExp, string]> = [
  [/googlebot|google-inspectiontool|adsbot-google|apis-google|storebot-google|googleother|google-extended/i, "Googlebot"],
  [/bingbot|bingpreview|msnbot/i, "Bingbot"],
  [/applebot/i, "Applebot"],
  [/duckduckbot/i, "DuckDuckBot"],
  [/yandex(bot|images)?/i, "YandexBot"],
  [/baiduspider/i, "Baiduspider"],
  [/oai-searchbot|gptbot|chatgpt-user/i, "OpenAI"],
  [/claudebot|claude-user|claude-searchbot|anthropic-ai/i, "Anthropic"],
  [/perplexitybot|perplexity-user/i, "Perplexity"],
  [/ccbot/i, "CommonCrawl"],
  [/semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|dataforseobot|screaming frog/i, "SEO tool"],
  [/facebookexternalhit|twitterbot|linkedinbot|slackbot|whatsapp|telegrambot|discordbot|pinterestbot/i, "Link preview"],
  [/uptimerobot|pingdom|statuscake|site24x7|betteruptime|datadog|newrelic|checkly|lighthouse|pagespeed|gtmetrix/i, "Monitor"],
]
const GENERIC = /bot\b|crawler|spider|crawl|slurp|scrape|headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|java\/|libwww|httpclient|axios|node-fetch|undici|postman|insomnia/i

export type BotVerdict = { isBot: boolean; name: string | null }

export function detectBot(userAgent: string | null | undefined): BotVerdict {
  const ua = (userAgent ?? "").trim()
  // A real browser always sends a User-Agent; none at all is a script.
  if (!ua) return { isBot: true, name: "no user-agent" }
  for (const [re, name] of NAMED) if (re.test(ua)) return { isBot: true, name }
  if (GENERIC.test(ua)) return { isBot: true, name: "other bot" }
  return { isBot: false, name: null }
}

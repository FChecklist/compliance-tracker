// Stub of next-intl/server for the ai-work-link-exec bundle. src/i18n/request.ts calls getRequestConfig when it is imported, so this one returns its
// argument instead of throwing; the locale lookup it configures is only used to word model prompts, and no model runs here.
export function getRequestConfig<T>(config: T): T {
  return config
}

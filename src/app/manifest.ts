import type { MetadataRoute } from "next"

// Wave 32 (VERI Chat, PLATFORM_STRATEGY.md §16.2): the share_target entry
// is what lets a user's OS Share Sheet (including WhatsApp's own "Export
// Chat" -> Share, or Telegram's Share, or literally any app) deliver text
// directly into VERIDIAN AI -- confirmed via research to be the only real
// way content moves OUT of those apps, since no web link can pull an
// existing chat out on its own.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Veridian AI",
    short_name: "Veridian AI",
    description: "One Portal. One Truth.",
    start_url: "/home",
    display: "standalone",
    background_color: "#FFFDF9",
    theme_color: "#1C2B3A",
    icons: [{ src: "/logo-mark.svg", sizes: "any", type: "image/svg+xml" }],
    share_target: {
      action: "/api/veri-chat/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  }
}

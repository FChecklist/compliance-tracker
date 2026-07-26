"use client";

// V2-2 (unified bottom-nav strip, task V2-2-UNIFIED-NAV): the unified nav
// surface the design law calls for -- "One navigation system only -- Chat /
// To Do / Analytics / Approval / Email / New as a single strip above the
// compose bar" (PLATFORM_STRATEGY.md line 178, confirmed unbuilt at line 216).
//
// Reuses the kit's NavItem type (the same shape the sidebar's
// buildSharedSections emits) and the kit's `.veri-nav-item` /
// `.veri-nav-item.active` token class (defined in the kit's globals.css,
// already imported into this repo) -- so the strip and the sidebar are the
// SAME nav system visually, just laid out horizontally vs vertically. No new
// token system, no competing nav pattern. The existing sidebar stays
// (it still carries the deep module nav -- Finance/HR/etc. -- that the
// 6-item law strip deliberately doesn't); the strip is the unified
// high-frequency surface above the compose bar, harmonized with rather than
// replacing the sidebar.
//
// VERIDIAN is desktop-first (PLATFORM_STRATEGY.md line 219 calls responsive/
// mobile scaling a deliberate non-goal of the Waves 9-15 pass), so this is a
// horizontal strip that composes with the desktop shell -- it does not
// assume a mobile viewport. On a narrow viewport it scrolls horizontally
// rather than wrapping (wrapping would change the shell's vertical rhythm
// per-route, which the composer/main-content layout assumes is fixed).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageSquare, ListTodo, BarChart3, CheckSquare, Inbox, Plus } from "lucide-react";
import type { NavItem as SharedNavItem } from "@fchecklist/veridian-ui-kit/shell";
import { BOTTOM_NAV_ITEMS, isBottomNavActive, type BottomNavLawItem } from "@/components/bottom-nav-items";

// The design law names the 6 items; this maps each law item to its icon.
// Icons are lucide-react (the same icon set AppSidebar.tsx already uses) --
// no new dependency.
type BottomNavLawKey = BottomNavLawItem["lawKey"];
const LAW_ICON: Record<BottomNavLawKey, React.ElementType> = {
  chat: MessageSquare,
  todo: ListTodo,
  analytics: BarChart3,
  approval: CheckSquare,
  email: Inbox,
  new: Plus,
};

// Renders a lucide icon at the same size the sidebar's SidebarIcon uses
// (size-3.5), so the strip and the sidebar read as one nav system. The
// param is destructured to a Capitalized local (`Icon`) because JSX treats
// a lowercase tag name as a DOM element (`<icon>` -> React.createElement
// ("icon", ...)) -- the app's own SidebarIcon (src/components/AppSidebar.tsx)
// uses this exact capitalized-destructure pattern for the same reason.
function BottomNavIcon({ icon: Icon }: { icon: React.ElementType }) {
  return <Icon className="size-3.5 shrink-0" />;
}

function toSharedItem(href: string, label: string, icon: React.ElementType): SharedNavItem {
  return {
    href,
    label,
    icon: <BottomNavIcon icon={icon} />,
  };
}

export function BottomNavStrip() {
  const pathname = usePathname();
  const t = useTranslations("Nav.bottomNav");

  // Converts the law items into the kit's NavItem shape, resolving each
  // label through the Nav.bottomNav.* i18n namespace (en/hi both populated).
  const items: SharedNavItem[] = BOTTOM_NAV_ITEMS.map((item) =>
    toSharedItem(item.href, t(item.lawKey), LAW_ICON[item.lawKey])
  );

  return (
    <nav
      aria-label="Primary"
      className="print:hidden shrink-0 border-t border-ct-border bg-white"
    >
      {/* Horizontal strip of the kit's own .veri-nav-item tokens. The
          overflow-x-auto means a narrow viewport scrolls instead of
          wrapping (see file header for why wrapping is avoided). px keeps
          the first/last item off the edge; gap-1 spaces items. */}
      <ul className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 no-scrollbar">
        {items.map((item, idx) => {
          const active = isBottomNavActive(pathname, item.href);
          return (
            <li key={`${item.href}-${idx}`} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`veri-nav-item${active ? " active" : ""}`}
              >
                {item.icon}
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomNavStrip;

import { create } from "zustand";

/* ------------------------------------------------------------------
 * UI Store — global UI state that doesn't belong to any specific
 * feature domain (sidebar, theme, modals, toasts).
 * ------------------------------------------------------------------ */

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number;
}

interface UIStore {
  /* Sidebar */
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /* Theme */
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;

  /* Active filters (for pages that share filter bar UX) */
  activeFilters: Record<string, string>;
  setActiveFilter: (key: string, value: string) => void;
  clearFilters: () => void;

  /* Global modal */
  globalModalOpen: boolean;
  globalModalContent: React.ReactNode | null;
  openGlobalModal: (content: React.ReactNode) => void;
  closeGlobalModal: () => void;

  /* Toasts */
  toasts: Toast[];
  addToast: (message: string, type?: Toast["type"], duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  /* Sidebar defaults */
  sidebarOpen: false,
  sidebarCollapsed: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  /* Theme */
  theme: "system",
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      if (theme === "system") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        root.classList.add(prefersDark ? "dark" : "light");
      } else {
        root.classList.add(theme);
      }
    }
  },

  /* Active filters */
  activeFilters: {},
  setActiveFilter: (key, value) =>
    set((s) => ({
      activeFilters: { ...s.activeFilters, [key]: value },
    })),
  clearFilters: () => set({ activeFilters: {} }),

  /* Global modal */
  globalModalOpen: false,
  globalModalContent: null,
  openGlobalModal: (content) => set({ globalModalOpen: true, globalModalContent: content }),
  closeGlobalModal: () => set({ globalModalOpen: false, globalModalContent: null }),

  /* Toasts */
  toasts: [],
  addToast: (message, type = "info", duration = 5000) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
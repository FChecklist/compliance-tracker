import { create } from "zustand";
import type { Role } from "@compliancetrack/types";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  org_id: string;
}

interface Org {
  id: string;
  name: string;
  onboarding_completed: boolean;
  onboarding_step: number;
}

interface AuthState {
  user: User | null;
  organisation: Org | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setOrganisation: (org: Org | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  organisation: null,
  loading: true,
  setUser: (user) => set({ user, loading: false }),
  setOrganisation: (organisation) => set({ organisation }),
  setLoading: (loading) => set({ loading }),
  logout: () => {
    set({ user: null, organisation: null, loading: false });
    fetch("/api/auth/logout", { method: "POST" }).then(() => {
      window.location.href = "/login";
    });
  },
}));
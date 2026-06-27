import { create } from "zustand";

interface ComplianceItem {
  id: string;
  org_id: string;
  department_id: string | null;
  title: string;
  description: string;
  compliance_type: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  due_date: string | null;
  unique_url_slug: string;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface ComplianceState {
  items: ComplianceItem[];
  pagination: Pagination | null;
  filters: Record<string, string>;
  loading: boolean;
  setItems: (items: ComplianceItem[], pagination: Pagination) => void;
  setFilters: (filters: Record<string, string>) => void;
  setLoading: (loading: boolean) => void;
  updateItem: (id: string, patch: Partial<ComplianceItem>) => void;
  removeItem: (id: string) => void;
}

export const useComplianceStore = create<ComplianceState>((set) => ({
  items: [],
  pagination: null,
  filters: {},
  loading: false,
  setItems: (items, pagination) => set({ items, pagination, loading: false }),
  setFilters: (filters) => set({ filters, loading: true }),
  setLoading: (loading) => set({ loading }),
  updateItem: (id, patch) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...patch, updated_at: new Date().toISOString() } : item
      ),
    })),
  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      pagination: state.pagination
        ? { ...state.pagination, total: state.pagination.total - 1 }
        : null,
    })),
}));
import { create } from "zustand";

type ComplianceItem = {
  id: string;
  title: string;
  compliance_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
  unique_url_slug: string;
};

type Filter = {
  status?: string;
  type?: string;
  priority?: string;
  search?: string;
};

interface ComplianceStore {
  items: ComplianceItem[];
  filter: Filter;
  setItems: (items: ComplianceItem[]) => void;
  setFilter: (filter: Partial<Filter>) => void;
  getFiltered: () => ComplianceItem[];
}

export const useComplianceStore = create<ComplianceStore>((set, get) => ({
  items: [],
  filter: {},
  setItems: (items) => set({ items }),
  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  getFiltered: () => {
    const { items, filter } = get();
    return items.filter((item) => {
      if (filter.status && item.status !== filter.status) return false;
      if (filter.type && item.compliance_type !== filter.type) return false;
      if (filter.priority && item.priority !== filter.priority) return false;
      if (filter.search && !item.title.toLowerCase().includes(filter.search.toLowerCase())) return false;
      return true;
    });
  },
}));
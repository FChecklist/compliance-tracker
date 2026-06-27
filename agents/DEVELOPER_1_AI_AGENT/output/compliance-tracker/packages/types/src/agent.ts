import { z } from "zod";
import { AgentType, SalesChannelType } from "./enums";

export interface SalesAgent {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  commission_rate: number;
  is_active: boolean;
  unique_referral_code: string;
  created_at: string;
  updated_at: string;
}

export interface DiscountCode {
  id: string;
  code: string;
  discount_percent: number;
  valid_from: string;
  valid_until: string;
  max_uses: number | null;
  uses_count: number;
  is_active: boolean;
  created_at: string;
}

export interface Commission {
  id: string;
  agent_id: string;
  order_id: string;
  amount: number;
  status: "pending" | "paid" | "cancelled";
  created_at: string;
}

export interface Incentive {
  id: string;
  agent_id: string;
  milestone_description: string;
  target_count: number;
  reward_amount: number;
  achieved: boolean;
  created_at: string;
}

export interface SalesChannel {
  id: string;
  channel_type: SalesChannelType;
  name: string;
  is_active: boolean;
  created_at: string;
}

export const CreateSalesAgentSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phone: z.string().optional(),
  commission_rate: z.number().min(0).max(100),
});

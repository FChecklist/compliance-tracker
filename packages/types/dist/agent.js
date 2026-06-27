import { z } from "zod";
export const CreateSalesAgentSchema = z.object({
    name: z.string().min(1).max(255),
    email: z.string().email(),
    phone: z.string().optional(),
    commission_rate: z.number().min(0).max(100),
});
//# sourceMappingURL=agent.js.map
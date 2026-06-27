import type { PaginatedResponse, ApiResponse } from "@compliancetrack/types";
import type { CreateComplianceSchema, UpdateComplianceSchema, ChangeStatusSchema, ReassignSchema, BulkStatusChangeSchema, ComplianceFiltersSchema } from "@compliancetrack/types";
import { z } from "zod";
export declare const complianceEndpoints: {
    list: (filters: z.infer<typeof ComplianceFiltersSchema>) => Promise<PaginatedResponse<unknown>>;
    get: (id: string) => Promise<ApiResponse<unknown>>;
    create: (data: z.infer<typeof CreateComplianceSchema>) => Promise<ApiResponse<unknown>>;
    update: (id: string, data: z.infer<typeof UpdateComplianceSchema>) => Promise<ApiResponse<unknown>>;
    delete: (id: string) => Promise<ApiResponse<null>>;
    changeStatus: (id: string, data: z.infer<typeof ChangeStatusSchema>) => Promise<ApiResponse<unknown>>;
    reassign: (id: string, data: z.infer<typeof ReassignSchema>) => Promise<ApiResponse<unknown>>;
    bulkStatusChange: (data: z.infer<typeof BulkStatusChangeSchema>) => Promise<ApiResponse<unknown>>;
};
//# sourceMappingURL=compliance.d.ts.map
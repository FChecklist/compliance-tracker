export declare const auditEndpoints: {
    list: (params?: Record<string, string>) => Promise<unknown>;
    get: (id: string) => Promise<unknown>;
    create: (data: unknown) => Promise<unknown>;
    update: (id: string, data: unknown) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
};
//# sourceMappingURL=audit.d.ts.map
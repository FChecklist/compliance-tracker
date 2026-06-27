export declare const authEndpoints: {
    /** POST /api/auth/register — register a new user */
    register: (body: {
        email: string;
        password: string;
        name: string;
        org_name: string;
    }) => Promise<{
        success: boolean;
        data: {
            user: {
                id: string;
                email: string;
            };
        };
    }>;
    /** POST /api/auth/login — email + password login */
    login: (body: {
        email: string;
        password: string;
    }) => Promise<{
        success: boolean;
        data: {
            token: string;
            user: {
                id: string;
                email: string;
                role: string;
            };
        };
    }>;
    /** GET /api/auth/me — get current session user */
    me: () => Promise<{
        success: boolean;
        data: {
            id: string;
            email: string;
            role: string;
            org_id: string;
        };
    }>;
    /** POST /api/auth/refresh — refresh session token */
    refresh: () => Promise<{
        success: boolean;
        data: {
            token: string;
        };
    }>;
    /** POST /api/auth/logout — clear session */
    logout: () => Promise<{
        success: boolean;
    }>;
};
//# sourceMappingURL=auth.d.ts.map
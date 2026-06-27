export declare const authEndpoints: {
    sendPasscode: (email: string) => Promise<{
        success: boolean;
    }>;
    verifyPasscode: (email: string, passcode: string) => Promise<{
        success: boolean;
        token: string;
    }>;
    sendMagicLink: (email: string) => Promise<{
        success: boolean;
    }>;
    getSession: () => Promise<{
        success: boolean;
        data: unknown;
    }>;
    logout: () => Promise<{
        success: boolean;
    }>;
};
//# sourceMappingURL=auth.d.ts.map
import { z } from "zod";
export interface Comment {
    id: string;
    compliance_id: string;
    parent_comment_id: string | null;
    author_id: string;
    body: string;
    created_at: string;
    updated_at: string;
}
export declare const CommentSchema: z.ZodObject<{
    id: z.ZodString;
    compliance_id: z.ZodString;
    parent_comment_id: z.ZodNullable<z.ZodString>;
    author_id: z.ZodString;
    body: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    compliance_id: string;
    parent_comment_id: string | null;
    author_id: string;
    body: string;
}, {
    id: string;
    compliance_id: string;
    parent_comment_id: string | null;
    author_id: string;
    body: string;
}>;
export declare const CreateCommentSchema: z.ZodObject<{
    compliance_id: z.ZodString;
    parent_comment_id: z.ZodOptional<z.ZodString>;
    body: z.ZodString;
}, "strip", z.ZodTypeAny, {
    compliance_id: string;
    body: string;
    parent_comment_id?: string | undefined;
}, {
    compliance_id: string;
    body: string;
    parent_comment_id?: string | undefined;
}>;
//# sourceMappingURL=comment.d.ts.map
import { z } from "zod";
export const CommentSchema = z.object({
    id: z.string().uuid(),
    compliance_id: z.string().uuid(),
    parent_comment_id: z.string().uuid().nullable(),
    author_id: z.string().uuid(),
    body: z.string().min(1).max(10000),
});
export const CreateCommentSchema = z.object({
    compliance_id: z.string().uuid(),
    parent_comment_id: z.string().uuid().optional(),
    body: z.string().min(1).max(10000),
});
//# sourceMappingURL=comment.js.map
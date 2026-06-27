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

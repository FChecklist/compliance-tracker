// Stub of src/lib/embeddings.ts for the ai-work-link-exec bundle: the embedding provider. A link write stores its memory row WITHOUT an embedding
// (spec 9.11: no model call on link traffic), so nothing here is called.
import { thrower } from "./unavailable"
export const storeEmbedding = thrower("the embedding provider (storeEmbedding)")
export const generateEmbedding = thrower("the embedding provider (generateEmbedding)")
export const generateEmbeddingUncached = thrower("the embedding provider (generateEmbeddingUncached)")
export const findSimilar = thrower("the embedding provider (findSimilar)")
export const deleteEmbedding = thrower("the embedding provider (deleteEmbedding)")
export const HASH_PSEUDO_VECTOR_MODEL = "not-available-on-exec"

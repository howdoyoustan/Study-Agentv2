export const DEFAULT_DATASET_ID = process.env.WAIP_DATASET_ID ?? "";

/** Model used for both RAG retrieval and LLM synthesis — override via env */
export const DEFAULT_MODEL = process.env.WAIP_MODEL_NAME ?? "gpt-4o";

/** Max tokens for Stage 1 doc_completion (retrieval pass) */
export const RETRIEVAL_MAX_TOKENS = 2048;

/** Max tokens for Stage 2 completion (essay synthesis pass) */
export const SYNTHESIS_MAX_TOKENS = 4096;

export const DEFAULT_TOP_K = 10;

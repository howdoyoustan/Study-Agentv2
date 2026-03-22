import axios, { AxiosInstance } from "axios";

function getWaipBase(): string {
  const endpoint = process.env.WAIP_API_ENDPOINT;
  if (!endpoint) throw new Error("WAIP_API_ENDPOINT is not set");
  return endpoint.replace(/\/$/, "");
}

function getAuthHeader(): Record<string, string> {
  const key = process.env.WAIP_API_KEY;
  if (!key) throw new Error("WAIP_API_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

function jsonClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: getWaipBase(),
    headers: {
      ...getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    timeout: 300_000,
  });

  // Surface the WAIP error body in thrown errors
  instance.interceptors.response.use(
    (r) => r,
    (err) => {
      if (axios.isAxiosError(err) && err.response) {
        const body =
          typeof err.response.data === "object"
            ? JSON.stringify(err.response.data)
            : String(err.response.data);
        throw new Error(
          `WAIP ${err.response.status}: ${body || err.message}`
        );
      }
      throw err;
    }
  );

  return instance;
}

// ─── Shared response shape ────────────────────────────────────────────────────

export interface WaipSource {
  content?: string;
  text?: string;
  chunk?: string;
  page?: number | string;
  page_number?: number | string;
  filename?: string;
  document_name?: string;
  source?: string;
  score?: number;
  [key: string]: unknown;
}

export interface WaipDataResponse {
  data?: {
    content?: string;
    sources?: WaipSource[];
    chunks?: WaipSource[];
    source_documents?: WaipSource[];
    [key: string]: unknown;
  };
  sources?: WaipSource[];
  chunks?: WaipSource[];
  [key: string]: unknown;
}

// ─── Dataset lifecycle ────────────────────────────────────────────────────────

export async function waipCreateDataset(
  name: string,
  description = ""
): Promise<{ _id: string; [key: string]: unknown }> {
  const client = jsonClient();
  const payload: Record<string, string> = { name };
  if (description) payload.description = description;
  const res = await client.post<{ _id: string }>("/v1.1/datasets", payload);
  return res.data;
}

/**
 * Prepare endpoint is a skill-level route, NOT a per-dataset route.
 * POST /v1.1/skills/doc_completion/prepare  { dataset_id: "..." }
 * Returns { _id: workflowId, status: "Started", ... }
 */
export async function waipPrepareDataset(
  datasetId: string
): Promise<{ _id: string; status: string; [key: string]: unknown }> {
  const client = jsonClient();
  const res = await client.post<{ _id: string; status: string }>(
    "/v1.1/skills/doc_completion/prepare",
    { dataset_id: datasetId }
  );
  return res.data;
}

/**
 * Poll the workflow status for a prepare job.
 * GET /v1.1/datasets/{datasetId}/workflow/{workflowId}
 * Status cycles: Started → Waiting → Indexing → Completed | Failed
 */
export async function waipGetWorkflowStatus(
  datasetId: string,
  workflowId: string
): Promise<{ status: string; [key: string]: unknown }> {
  const client = jsonClient();
  const res = await client.get<{ status: string }>(
    `/v1.1/datasets/${datasetId}/workflow/${workflowId}`
  );
  return res.data;
}

// ─── Stage 1 — RAG retrieval via doc_completion ───────────────────────────────

export interface DocCompletionParams {
  datasetId: string;
  question: string;
  model: string;
  maxTokens: number;
  topK: number;
  returnSources: boolean;
}

export async function waipDocCompletion(
  params: DocCompletionParams
): Promise<WaipDataResponse> {
  const client = jsonClient();
  const body = {
    dataset_id: params.datasetId,
    messages: [{ role: "user", content: params.question }],
    skill_parameters: {
      model_name: params.model,
      retrieval_chain: "custom",
      emb_type: "openai",
      temperature: 0,
      max_output_tokens: params.maxTokens,
      top_k: params.topK,
      return_sources: params.returnSources,
    },
    stream_response: false,
  };
  const res = await client.post<WaipDataResponse>(
    "/v1.1/skills/doc_completion/query",
    body
  );
  return res.data;
}

// ─── Stage 2 — LLM synthesis via completion ───────────────────────────────────

export interface CompletionParams {
  systemPrompt: string;
  userContent: string;
  model: string;
  maxTokens: number;
}

export async function waipCompletion(
  params: CompletionParams
): Promise<string> {
  const client = jsonClient();
  const body = {
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    skill_parameters: {
      model_name: params.model,
      max_output_tokens: params.maxTokens,
      temperature: 0.2,
    },
    stream_response: false,
  };
  const res = await client.post<WaipDataResponse>(
    "/v1.1/skills/completion/query",
    body
  );
  return res.data?.data?.content ?? "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractSourceChunks(resp: WaipDataResponse): WaipSource[] {
  const out: WaipSource[] = [];
  if (Array.isArray(resp.sources)) out.push(...resp.sources);
  if (Array.isArray(resp.chunks)) out.push(...resp.chunks);
  if (Array.isArray(resp.data?.sources)) out.push(...resp.data!.sources!);
  if (Array.isArray(resp.data?.chunks)) out.push(...resp.data!.chunks!);
  // WAIP actually returns retrieved chunks here
  if (Array.isArray(resp.data?.source_documents))
    out.push(...(resp.data!.source_documents as WaipSource[]));
  return out;
}

export function extractRetrievedText(resp: WaipDataResponse): string {
  // Try the doc_completion content first (this is the RAG-generated answer)
  const content = resp.data?.content;
  if (content) return content;
  return "";
}

export function buildContextFromSources(sources: WaipSource[]): string {
  if (sources.length === 0) return "";
  return sources
    .map((s, i) => {
      const text =
        (s.page_content as string | undefined) ??
        s.content ??
        s.text ??
        s.chunk ??
        "";
      const page =
        s.page ??
        s.page_number ??
        ((s.metadata as Record<string, unknown> | undefined)
          ?.page as string | number | undefined);
      const file =
        ((s.metadata as Record<string, unknown> | undefined)
          ?.source as string | undefined) ??
        s.filename ??
        s.document_name ??
        s.source ??
        "";
      const header = [file && `[${file}]`, page != null && `p.${page}`]
        .filter(Boolean)
        .join(" ");
      return `--- Chunk ${i + 1}${header ? " " + header : ""} ---\n${text}`;
    })
    .join("\n\n");
}

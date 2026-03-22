import { NextRequest, NextResponse } from "next/server";
import {
  waipDocCompletion,
  waipCompletion,
  extractSourceChunks,
  buildContextFromSources,
  WaipSource,
} from "@/lib/waip";
import { formatForPrint } from "@/lib/printFormatter";
import { STUDY_SYSTEM_PROMPT } from "@/lib/queryGuidance";
import {
  DEFAULT_DATASET_ID,
  DEFAULT_MODEL,
  RETRIEVAL_MAX_TOKENS,
  SYNTHESIS_MAX_TOKENS,
  DEFAULT_TOP_K,
} from "@/lib/constants";

// Allow up to 60 s on Vercel Pro / 300 s on Enterprise.
// Vercel Hobby caps at 10 s which is too short for WAIP synthesis.
export const maxDuration = 60;

export interface QueryRequestBody {
  question: string;
  dataset_id?: string;
  top_k?: number;
}

export interface QueryResponseBody {
  answer: string;
  sources: Array<{
    content: string;
    page?: number | string;
    filename?: string;
    score?: number;
  }>;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: QueryRequestBody = await req.json();
    const { question, dataset_id, top_k } = body;

    if (!question?.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const datasetId = dataset_id?.trim() || DEFAULT_DATASET_ID;
    if (!datasetId) {
      return NextResponse.json(
        {
          error:
            "No dataset_id provided and WAIP_DATASET_ID env is not set. " +
            "Create a dataset, ingest PDFs, prepare the index, then paste the id here.",
        },
        { status: 400 }
      );
    }

    // ── Stage 1: Retrieve from WAIP vector store ──────────────────────────────
    const ragResponse = await waipDocCompletion({
      datasetId,
      question: question.trim(),
      model: DEFAULT_MODEL,
      maxTokens: RETRIEVAL_MAX_TOKENS,
      topK: top_k ?? DEFAULT_TOP_K,
      returnSources: true,
    });

    // Debug: log top-level keys and data keys so we can see what WAIP actually
    // returns in the sources fields.
    console.log("[query] WAIP response top-level keys:", Object.keys(ragResponse));
    if (ragResponse.data && typeof ragResponse.data === "object") {
      console.log("[query] WAIP response data keys:", Object.keys(ragResponse.data));
    }

    const rawSources = extractSourceChunks(ragResponse);
    console.log("[query] rawSources count:", rawSources.length);
    if (rawSources.length > 0) {
      console.log("[query] first source keys:", Object.keys(rawSources[0]));
      console.log("[query] first source sample:", JSON.stringify(rawSources[0]).slice(0, 300));
    }

    // Fallback: if WAIP returned no explicit source chunks, create a synthetic
    // source from the doc_completion answer text so the Sources tab is never
    // completely empty and the context is still usable.
    const effectiveSources: WaipSource[] =
      rawSources.length > 0
        ? rawSources
        : ragResponse.data?.content
        ? [
            {
              content: ragResponse.data.content,
              filename: "WAIP Retrieved Context",
              source: datasetId,
            },
          ]
        : [];

    // Build the context string from whatever sources we have.
    let context: string;
    if (effectiveSources.length > 0) {
      context = buildContextFromSources(effectiveSources);
    } else {
      context = ragResponse.data?.content ?? "";
    }

    if (!context) {
      return NextResponse.json(
        {
          answer: "",
          sources: [],
          error:
            "WAIP returned no content. The dataset may not be prepared yet, " +
            "or the question matched nothing in the index.",
        },
        { status: 200 }
      );
    }

    // ── Stage 2: Synthesise essay answer with WAIP completion ─────────────────
    const userContent =
      `RETRIEVED CONTEXT:\n${context}\n\nQUESTION:\n${question.trim()}`;

    const rawAnswer = await waipCompletion({
      systemPrompt: STUDY_SYSTEM_PROMPT,
      userContent,
      model: DEFAULT_MODEL,
      maxTokens: SYNTHESIS_MAX_TOKENS,
    });

    const answer = formatForPrint(rawAnswer);

    const sources = effectiveSources.map((s: WaipSource) => ({
      // WAIP source_documents use page_content for the text
      content: String(
        s.page_content ?? s.content ?? s.text ?? s.chunk ?? ""
      ).slice(0, 500),
      page: s.page ?? s.page_number,
      // WAIP source_documents carry metadata.source / metadata.page
      filename:
        (s.metadata as Record<string, unknown> | undefined)?.source as
          | string
          | undefined ??
        s.filename ??
        s.document_name ??
        s.source,
      score: typeof s.score === "number" ? s.score : undefined,
    }));

    const responseBody: QueryResponseBody = { answer, sources };
    return NextResponse.json(responseBody);
  } catch (err: unknown) {
    console.error("[/api/query]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

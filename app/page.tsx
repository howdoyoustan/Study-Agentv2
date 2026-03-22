"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { QueryResponseBody } from "@/app/api/query/route";

const DEFAULT_DATASET_ID = process.env.NEXT_PUBLIC_WAIP_DATASET_ID ?? "";
const WAIP_ENDPOINT =
  process.env.NEXT_PUBLIC_WAIP_API_ENDPOINT ?? "https://api.waip.wiprocms.com";
const WAIP_KEY = process.env.NEXT_PUBLIC_WAIP_API_KEY ?? "";

type Stage = "idle" | "loading" | "done" | "error";

interface LogEntry {
  time: string;
  message: string;
  type: "info" | "error" | "success";
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

// ─── Answer segmentation ─────────────────────────────────────────────────────

type Segment =
  | { type: "text"; content: string }
  | { type: "mermaid"; code: string };

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const slice = text.slice(lastIndex, match.index);
      if (slice.trim()) segments.push({ type: "text", content: slice });
    }
    segments.push({ type: "mermaid", code: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim()) segments.push({ type: "text", content: tail });
  return segments;
}

// ─── Mermaid diagram component ────────────────────────────────────────────────

let mermaidCounter = 0;

function MermaidDiagram({
  code,
  forPrint = false,
}: {
  code: string;
  forPrint?: boolean;
}) {
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const id = useRef(`mermaid-diag-${++mermaidCounter}`);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
        });
        const { svg: rendered } = await mermaid.render(id.current, code);
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        if (!cancelled) setRenderError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (renderError) {
    return (
      <pre
        className={
          forPrint
            ? "print-mermaid-fallback"
            : "text-xs text-red-400 p-2 border border-red-800 rounded my-2"
        }
      >
        {code}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div
        className={
          forPrint
            ? "print-mermaid-placeholder"
            : "text-xs text-gray-500 italic my-2 p-2"
        }
      >
        {forPrint ? "" : "Rendering diagram…"}
      </div>
    );
  }

  return (
    <div
      className={forPrint ? "print-mermaid" : "mermaid-screen"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ─── Answer renderer (screen + print) ────────────────────────────────────────

function AnswerRenderer({
  text,
  forPrint = false,
}: {
  text: string;
  forPrint?: boolean;
}) {
  const segments = parseSegments(text);
  const mdClass = forPrint ? "print-md" : "screen-md";
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "mermaid" ? (
          <MermaidDiagram key={i} code={seg.code} forPrint={forPrint} />
        ) : (
          <div key={i} className={mdClass}>
            <ReactMarkdown>{seg.content}</ReactMarkdown>
          </div>
        )
      )}
    </>
  );
}

// ─── Utility components ───────────────────────────────────────────────────────

function LogPanel({ entries }: { entries: LogEntry[] }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);
  return (
    <div className="bg-gray-900 rounded border border-gray-700 h-40 overflow-y-auto font-mono text-xs p-2">
      {entries.map((e, i) => (
        <div
          key={i}
          className={
            e.type === "error"
              ? "text-red-400"
              : e.type === "success"
              ? "text-green-400"
              : "text-gray-300"
          }
        >
          <span className="text-gray-500 mr-2">[{e.time}]</span>
          {e.message}
        </div>
      ))}
      <div ref={bottom} />
    </div>
  );
}

function SourceCard({
  source,
  index,
}: {
  source: QueryResponseBody["sources"][0];
  index: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700 rounded bg-gray-800 text-xs mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex justify-between items-center text-gray-300 hover:text-white"
      >
        <span>
          Source {index + 1}
          {source.filename ? ` — ${source.filename}` : ""}
          {source.page != null ? `, p.${source.page}` : ""}
          {source.score != null ? ` (score: ${source.score.toFixed(3)})` : ""}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre className="px-3 pb-2 whitespace-pre-wrap text-gray-400 border-t border-gray-700 pt-2">
          {source.content}
        </pre>
      )}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
      <div
        className="bg-indigo-500 h-1.5 transition-all duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StudyAgentPage() {
  const [datasetId, setDatasetId] = useState(DEFAULT_DATASET_ID);
  const [datasetName, setDatasetName] = useState("");
  const [topK, setTopK] = useState(10);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<QueryResponseBody["sources"]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [ingestFiles, setIngestFiles] = useState<FileList | null>(null);
  const [activeTab, setActiveTab] = useState<"answer" | "sources">("answer");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const addLog = useCallback(
    (message: string, type: LogEntry["type"] = "info") => {
      setLog((prev) => [...prev, { time: timestamp(), message, type }]);
    },
    []
  );

  async function handleCreateDataset() {
    if (!datasetName.trim()) return;
    addLog(`Creating dataset "${datasetName}"...`);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: datasetName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create dataset failed");
      const id = data._id ?? data.id ?? "";
      setDatasetId(id);
      addLog(`Dataset created: ${id}`, "success");
    } catch (e: unknown) {
      addLog((e as Error).message, "error");
    }
  }

  function handleIngest() {
    const id = datasetId.trim();
    if (!id || !ingestFiles?.length) {
      addLog("Provide a dataset id and at least one PDF file", "error");
      return;
    }
    if (!WAIP_KEY) {
      addLog(
        "NEXT_PUBLIC_WAIP_API_KEY is not set — restart the dev server after updating .env.local",
        "error"
      );
      return;
    }

    const files = Array.from(ingestFiles);
    addLog(
      `Uploading ${files.length} file(s) directly to WAIP (${(
        files.reduce((a, f) => a + f.size, 0) /
        1024 /
        1024
      ).toFixed(1)} MB total)...`
    );

    const formData = new FormData();
    for (const f of files) {
      formData.append(f.name, f, f.name);
    }

    setIngesting(true);
    setUploadPct(0);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${WAIP_ENDPOINT}/v1.1/datasets/${id}/ingest`);
    xhr.setRequestHeader("Authorization", `Bearer ${WAIP_KEY}`);
    xhr.setRequestHeader("Accept", "text/event-stream, application/json");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadPct(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      setIngesting(false);
      setUploadPct(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        addLog("Ingest complete — now click Prepare Index", "success");
      } else {
        addLog(
          `WAIP ingest failed ${xhr.status}: ${xhr.responseText}`,
          "error"
        );
      }
    };

    xhr.onerror = () => {
      setIngesting(false);
      setUploadPct(null);
      addLog(
        "Network error during upload — check WAIP_ENDPOINT and API key",
        "error"
      );
    };

    xhr.ontimeout = () => {
      setIngesting(false);
      setUploadPct(null);
      addLog("Upload timed out", "error");
    };

    xhr.timeout = 600_000;
    xhr.send(formData);
  }

  async function handlePrepare() {
    const id = datasetId.trim();
    if (!id) {
      addLog("Provide a dataset id first", "error");
      return;
    }
    addLog(`Triggering index preparation for dataset ${id}...`);
    try {
      const res = await fetch(`/api/datasets/${id}/prepare`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Prepare failed");

      const workflowId: string = data._id;
      if (!workflowId) {
        addLog("Prepare triggered (no workflow id returned — cannot poll status).", "success");
        return;
      }

      addLog(`Prepare job started (workflow: ${workflowId}) — polling for completion...`);

      // Poll until Completed or Failed (WAIP cycles: Started → Waiting → Indexing → Completed)
      const TERMINAL = new Set(["Completed", "Failed", "Error"]);
      let attempts = 0;
      const MAX_ATTEMPTS = 60; // 5 min at 5-second intervals

      while (attempts < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 5000));
        attempts++;

        const pollRes = await fetch(`/api/datasets/${id}/workflow/${workflowId}`);
        const pollData = await pollRes.json();

        if (pollData.error) {
          addLog(`Status check error: ${pollData.error}`, "error");
          break;
        }

        const status: string = pollData.status ?? "Unknown";
        addLog(`Prepare status: ${status}`);

        if (TERMINAL.has(status)) {
          if (status === "Completed") {
            addLog(
              "Index preparation complete — documents are now processed and ready to query.",
              "success"
            );
          } else {
            addLog(`Prepare job ended with status: ${status}`, "error");
          }
          break;
        }
      }

      if (attempts >= MAX_ATTEMPTS) {
        addLog(
          "Prepare is taking longer than 5 minutes — check the WAIP portal for status.",
          "error"
        );
      }
    } catch (e: unknown) {
      addLog((e as Error).message, "error");
    }
  }

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setStage("loading");
    setAnswer("");
    setSources([]);
    setError("");
    addLog(
      `Stage 1 — retrieving from WAIP vector store (dataset: ${
        datasetId || "env default"
      }, top_k: ${topK})...`
    );

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          dataset_id: datasetId.trim() || undefined,
          top_k: topK,
        }),
      });
      const data: QueryResponseBody = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Query failed");

      addLog(
        `Retrieved ${data.sources.length} source chunk(s) from WAIP`,
        "info"
      );
      addLog("Stage 2 — WAIP completion synthesis done", "success");
      setAnswer(data.answer);
      setSources(data.sources);
      setStage("done");
      setActiveTab("answer");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      setError(msg);
      addLog(msg, "error");
      setStage("error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between no-print">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Study Agent</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            WAIP RAG + WAIP completion — essay synthesis
          </p>
        </div>
        {stage === "done" && (
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-white text-gray-900 rounded text-sm font-semibold hover:bg-gray-200 transition"
          >
            Print Answer
          </button>
        )}
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6 no-print">
        {/* Dataset Panel */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Dataset Management
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Create */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">
                Create new dataset
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="Dataset name"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
                <button
                  onClick={handleCreateDataset}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition"
                >
                  Create
                </button>
              </div>
            </div>

            {/* Dataset ID */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">
                Active dataset ID
                {DEFAULT_DATASET_ID && (
                  <span className="ml-2 text-indigo-400">
                    (default from env)
                  </span>
                )}
              </label>
              <input
                type="text"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                placeholder="Dataset id"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>

          {/* Ingest */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">
              Ingest PDFs
              <span className="ml-2 text-gray-600">
                (uploaded directly to WAIP — no size limit)
              </span>
            </label>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                type="file"
                accept=".pdf,.txt,.docx,.pptx,.html"
                multiple
                disabled={ingesting}
                onChange={(e) => setIngestFiles(e.target.files)}
                className="flex-1 text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 disabled:opacity-40"
              />
              <button
                onClick={handleIngest}
                disabled={ingesting}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition whitespace-nowrap"
              >
                {ingesting ? "Uploading..." : "Upload & Ingest"}
              </button>
              <button
                onClick={handlePrepare}
                disabled={ingesting}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-medium transition whitespace-nowrap"
              >
                Prepare Index
              </button>
            </div>

            {uploadPct !== null && (
              <div className="space-y-1">
                <ProgressBar pct={uploadPct} />
                <p className="text-xs text-gray-500">{uploadPct}% uploaded</p>
              </div>
            )}
          </div>
        </section>

        {/* Query Panel */}
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Ask a Question
          </h2>
          <form onSubmit={handleQuery} className="space-y-3">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="Enter your study question here..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
            />
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 whitespace-nowrap">
                  Top-K chunks
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-gray-500"
                />
              </div>
              <button
                type="submit"
                disabled={stage === "loading" || !question.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm font-semibold transition"
              >
                {stage === "loading" ? "Thinking..." : "Ask"}
              </button>
            </div>
          </form>
        </section>

        {/* Log */}
        {log.length > 0 && (
          <section>
            <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Pipeline Log
            </h2>
            <LogPanel entries={log} />
          </section>
        )}

        {/* Error */}
        {stage === "error" && (
          <div className="bg-red-950 border border-red-800 rounded p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Answer tabs */}
        {stage === "done" && (
          <section className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <div className="flex border-b border-gray-800">
              <button
                onClick={() => setActiveTab("answer")}
                className={`px-5 py-3 text-sm font-medium transition ${
                  activeTab === "answer"
                    ? "text-white border-b-2 border-indigo-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Answer
              </button>
              <button
                onClick={() => setActiveTab("sources")}
                className={`px-5 py-3 text-sm font-medium transition ${
                  activeTab === "sources"
                    ? "text-white border-b-2 border-indigo-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Sources ({sources.length})
              </button>
            </div>

            {activeTab === "answer" && (
              <div className="p-5">
                <AnswerRenderer text={answer} />
              </div>
            )}

            {activeTab === "sources" && (
              <div className="p-4">
                {sources.length === 0 ? (
                  <p className="text-gray-500 text-sm">No sources returned.</p>
                ) : (
                  sources.map((s, i) => (
                    <SourceCard key={i} source={s} index={i} />
                  ))
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ====== PRINT ZONE — hidden on screen, visible on print ====== */}
      {stage === "done" && answer && (
        <div className="print-only print-zone">
          <AnswerRenderer text={answer} forPrint />
        </div>
      )}
    </div>
  );
}

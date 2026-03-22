import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300; // ingest can be slow for large PDFs

function getWaipBase(): string {
  const endpoint = process.env.WAIP_API_ENDPOINT;
  if (!endpoint) throw new Error("WAIP_API_ENDPOINT is not set");
  return endpoint.replace(/\/$/, "");
}

function getApiKey(): string {
  const key = process.env.WAIP_API_KEY;
  if (!key) throw new Error("WAIP_API_KEY is not set");
  return key;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Dataset id is required" }, { status: 400 });
    }

    const contentType = req.headers.get("content-type");
    if (!contentType?.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    const waipUrl = `${getWaipBase()}/v1.1/datasets/${id}/ingest`;

    // Stream the raw multipart body straight to WAIP.
    // We preserve the exact Content-Type header (including the multipart boundary)
    // and never buffer the file in Node memory, so large PDFs work fine.
    const upstream = await fetch(waipUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: "text/event-stream, application/json",
        "Content-Type": contentType,
      },
      body: req.body,
      // @ts-expect-error — Node 18 fetch needs this to allow streaming request bodies
      duplex: "half",
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      throw new Error(`WAIP ingest failed ${upstream.status}: ${text}`);
    }

    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ status: "ok", raw: text });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

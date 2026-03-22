import { NextRequest, NextResponse } from "next/server";
import { waipCreateDataset } from "@/lib/waip";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const dataset = await waipCreateDataset(name.trim());
    return NextResponse.json(dataset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

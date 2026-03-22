import { NextRequest, NextResponse } from "next/server";
import { waipPrepareDataset } from "@/lib/waip";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Dataset id is required" }, { status: 400 });
    }
    const result = await waipPrepareDataset(id);
    return NextResponse.json(result ?? { status: "prepare triggered", dataset_id: id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { waipGetWorkflowStatus } from "@/lib/waip";

export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; workflowId: string }> }
) {
  try {
    const { id, workflowId } = await params;
    if (!id || !workflowId) {
      return NextResponse.json(
        { error: "dataset id and workflowId are required" },
        { status: 400 }
      );
    }
    const result = await waipGetWorkflowStatus(id, workflowId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

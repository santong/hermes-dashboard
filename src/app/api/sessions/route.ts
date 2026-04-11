import { NextResponse } from "next/server";

import { listSessions } from "@/lib/hermes-sessions";

export async function GET() {
  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sessions" },
      { status: 500 }
    );
  }
}

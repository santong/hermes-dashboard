import { NextResponse } from "next/server";

import { createMemory, listMemories } from "@/lib/hermes-memory";

export async function GET() {
  try {
    const memories = await listMemories();
    return NextResponse.json({ memories });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load memories" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { scope?: string; content?: string };
    if (body.scope !== "user" && body.scope !== "memory") {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const item = await createMemory(body.scope, body.content);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create memory" },
      { status: 500 }
    );
  }
}

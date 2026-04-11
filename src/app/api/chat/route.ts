import { NextResponse } from "next/server";

import { runChat } from "@/lib/hermes-sessions";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: string; sessionId?: string };
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const result = await runChat(prompt, body.sessionId?.trim() || undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run Hermes chat" },
      { status: 500 }
    );
  }
}

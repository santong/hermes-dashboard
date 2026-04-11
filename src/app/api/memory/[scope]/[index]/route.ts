import { NextResponse } from "next/server";

import { deleteMemory, updateMemory } from "@/lib/hermes-memory";

export async function PUT(
  request: Request,
  context: { params: Promise<{ scope: string; index: string }> }
) {
  try {
    const { scope, index } = await context.params;
    if (scope !== "user" && scope !== "memory") {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    const parsedIndex = Number(index);
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 });
    }

    const body = (await request.json()) as { content?: string };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const item = await updateMemory(scope, parsedIndex, body.content);
    if (!item) {
      return NextResponse.json({ error: "Memory entry not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update memory" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ scope: string; index: string }> }
) {
  try {
    const { scope, index } = await context.params;
    if (scope !== "user" && scope !== "memory") {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    const parsedIndex = Number(index);
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      return NextResponse.json({ error: "Invalid index" }, { status: 400 });
    }

    const deleted = await deleteMemory(scope, parsedIndex);
    if (!deleted) {
      return NextResponse.json({ error: "Memory entry not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete memory" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";

import { updateSkill } from "@/lib/hermes-skills";

export async function PUT(request: Request, context: { params: Promise<{ skillPath: string[] }> }) {
  try {
    const { skillPath } = await context.params;
    const body = (await request.json()) as { content?: string };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const skill = await updateSkill(skillPath.join("/"), body.content);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json({ skill });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update skill" },
      { status: 500 }
    );
  }
}

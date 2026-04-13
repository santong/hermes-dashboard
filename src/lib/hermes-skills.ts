import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { getHermesHome } from "@/lib/hermes-env";
import type { SkillItem } from "@/lib/hermes-types";

// ─── Path resolution ─────────────────────────────────────────────────

function getSkillsDir(): string {
  return path.join(getHermesHome(), "skills");
}

/** Recursively walk a directory and return all file paths. */
function walkDir(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

// ─── Public API (same signatures as before) ───────────────────────────

export async function listSkills(): Promise<SkillItem[]> {
  const skillsRoot = getSkillsDir();
  if (!existsSync(skillsRoot)) return [];

  const allFiles = walkDir(skillsRoot);
  const skillFiles = allFiles.filter((f) => path.basename(f) === "SKILL.md");

  const skills: SkillItem[] = skillFiles.map((filePath) => {
    const content = readFileSync(filePath, "utf-8");
    const fileStat = statSync(filePath);
    const dir = path.dirname(filePath);
    const relativeDir = path.relative(skillsRoot, dir);
    const parts = relativeDir === "." ? [] : relativeDir.split(path.sep);
    const category = parts.length > 1 ? parts[0] : "custom";

    const { data: frontmatter } = matter(content);
    const fm = Object.fromEntries(
      Object.entries(frontmatter).map(([k, v]) => [k, String(v ?? "")])
    );

    return {
      id: parts.join("/"),
      name: fm.name || (parts.at(-1) ?? "skill"),
      category,
      description: fm.description || "No description",
      updatedAt: fileStat.mtime.toISOString().replace(/\.\d{3}Z$/, "Z"),
      content,
      frontmatter: fm,
    };
  });

  skills.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return skills;
}

export async function updateSkill(skillId: string, content: string): Promise<SkillItem | null> {
  const skillsRoot = getSkillsDir();

  // Path traversal protection
  const normalized = path.normalize(skillId).replace(/^[/\\]+/, "");
  const fullPath = path.join(skillsRoot, normalized, "SKILL.md");
  const realRoot = path.resolve(skillsRoot);
  const realTarget = path.resolve(fullPath);

  if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
    throw new Error("Invalid skill path");
  }

  if (!existsSync(realTarget)) return null;

  writeFileSync(realTarget, content, "utf-8");

  const skills = await listSkills();
  return skills.find((s) => s.id === skillId) ?? null;
}

import os from "node:os";
import path from "node:path";

const DEFAULT_HERMES_HOME = `${os.homedir()}/.hermes`;

/** Resolve the Hermes home directory. Respects HERMES_HOME env var. Always absolute. */
export function getHermesHome(): string {
  const raw = process.env.HERMES_HOME?.trim() || DEFAULT_HERMES_HOME;
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

/** Resolve the path to the Hermes SQLite state database. */
export function getStateDbPath(): string {
  return path.join(getHermesHome(), "state.db");
}

/** Resolve the Hermes CLI binary path. Respects HERMES_BIN env var. */
export function getHermesBin(): string {
  return process.env.HERMES_BIN?.trim() || "hermes";
}

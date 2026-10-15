import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtime } from "./helpers";

const runtimeFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", ".cache", "bookleaf-e2e", "runtime.json");

/** Stops the disposable stack gracefully; stack.mjs removes runtime.json as the last step of its shutdown. */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(runtimeFile)) return;
  try {
    await fetch(`${runtime().mockUrl}/__control/shutdown`);
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + 20_000;
  while (existsSync(runtimeFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
}

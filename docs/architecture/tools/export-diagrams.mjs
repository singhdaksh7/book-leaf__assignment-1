#!/usr/bin/env node
// Extracts every ```mermaid block from docs/architecture/*.md into diagrams/<name>.mmd and, with --render, renders SVG + PNG.
//
//   node docs/architecture/tools/export-diagrams.mjs              # extract only
//   node docs/architecture/tools/export-diagrams.mjs --render     # extract + render (needs @mermaid-js/mermaid-cli)
//
// A block is exported only if its first line is a comment of the form `%% file: some-name.mmd`.
// Rendering uses MMDC (path to the mmdc binary, default `mmdc` on PATH) and PUPPETEER_EXECUTABLE_PATH (a Chrome/Edge binary)
// if set. Nothing in the application depends on this script.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "diagrams");
const render = process.argv.includes("--render");
mkdirSync(outDir, { recursive: true });

const seen = new Map();
const problems = [];
for (const file of readdirSync(root).filter((f) => f.endsWith(".md") && f !== "CONSOLIDATED-ARCHITECTURE.md").sort()) {
  const text = readFileSync(join(root, file), "utf8");
  for (const match of text.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)) {
    const body = match[1];
    const name = /^%%\s*file:\s*([\w.-]+\.mmd)\s*$/m.exec(body.split(/\r?\n/)[0] ?? "")?.[1];
    if (!name) { problems.push(`${file}: mermaid block without a '%% file:' header`); continue; }
    if (seen.has(name)) { problems.push(`${file}: duplicate diagram name ${name} (also in ${seen.get(name)})`); continue; }
    seen.set(name, file);
    writeFileSync(join(outDir, name), body.endsWith("\n") ? body : `${body}\n`);
  }
}
console.log(`extracted ${seen.size} diagrams to ${outDir}`);
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }

if (render) {
  const mmdc = process.env.MMDC ?? "mmdc";
  const svgDir = join(outDir, "svg"), pngDir = join(outDir, "png");
  mkdirSync(svgDir, { recursive: true }); mkdirSync(pngDir, { recursive: true });
  const cfgPath = join(outDir, ".puppeteer.json");
  const args = ["-p", cfgPath];
  writeFileSync(cfgPath, JSON.stringify({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ["--no-sandbox"] }));
  let ok = 0, failed = 0;
  for (const name of [...seen.keys()].sort()) {
    const base = name.replace(/\.mmd$/, "");
    for (const [ext, dir, extra] of [["svg", svgDir, []], ["png", pngDir, ["-s", "2"]]]) {
      try {
        execFileSync(mmdc, ["-i", join(outDir, name), "-o", join(dir, `${base}.${ext}`), "-b", "white", ...extra, ...args], { stdio: "pipe", shell: process.platform === "win32" });
        ok += 1;
      } catch (error) {
        failed += 1;
        console.error(`RENDER FAILED ${name} (${ext}): ${String(error.stderr ?? error.message).split("\n").slice(0, 6).join(" | ")}`);
      }
    }
  }
  console.log(`rendered ${ok} files, ${failed} failures`);
  if (failed) process.exitCode = 1;
}
if (!existsSync(outDir)) process.exitCode = 1;

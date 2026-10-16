import { describe, expect, it } from "vitest";
import { parseModelDraft } from "../src/drafting/schema.js";

const body = "Thank you for contacting us about your royalty payment. Royalties are calculated quarterly and paid within 45 days of the quarter ending.";
const draftJson = (prefix: string) => JSON.stringify({ draft: `${prefix}${body}`, citations: [] });

// Real models (observed with a free OpenRouter model) often write "Dear Author," instead of the placeholder. The author's name never
// reaches the model, so the name it writes is invented; the greeting is normalised and the real first name substituted afterwards.
describe("model greeting normalisation", () => {
  it.each(["Dear Author,", "Dear Valued Author,", "Dear Writer,"])("accepts %s and normalises it to the placeholder", (greeting) => {
    const out = parseModelDraft(draftJson(`${greeting}\n\n`));
    expect(out.draft.startsWith("Dear {{authorFirstName}},\n\n")).toBe(true);
  });

  it("keeps an already-correct placeholder greeting unchanged", () => {
    expect(parseModelDraft(draftJson("Dear {{authorFirstName}},\n\n")).draft.startsWith("Dear {{authorFirstName}},")).toBe(true);
  });

  it.each([
    ["no greeting", "Hello,\n\n"],
    ["an invented personal name", "Dear John,\n\n"],
    ["a different template variable", "Dear {{name}},\n\n"],
    ["a placeholder plus text", "Dear Author {{x}},\n\n"],
    ["an over-long name", `Dear ${"A".repeat(60)},\n\n`],
    ["a template brace later in the text", "Dear Author,\n\n{{other}} "]
  ])("still rejects %s", (_label, prefix) => {
    expect(() => parseModelDraft(draftJson(prefix))).toThrow();
  });
});

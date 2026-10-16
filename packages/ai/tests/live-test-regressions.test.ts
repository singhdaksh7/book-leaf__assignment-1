import { describe, expect, it } from "vitest";
import { loadAiConfig } from "../src/config.js";
import { heuristicClassify, isLiveMetadataUpdateRequest } from "../src/classifier/heuristics.js";
import { findUnsupportedClaims } from "../src/grounding.js";
import { createAiService } from "../src/service.js";
import { draftContent, FAKE_KEY, modelAnswer, scriptedProvider } from "./helpers.js";

// Regressions from the real OpenRouter run of 2026-10-16 (nvidia/nemotron-3-super-120b-a12b:free).
const META = "Can I update the description of my book on Amazon after it's already live?";

const analyze = (subject: string, description: string, ...steps: Array<string | object>) =>
  createAiService({ provider: scriptedProvider(...steps) }).analyzeTicketDetailed({ ticketId: "t", subject, description, authorContext: { name: "Jane Roe" } });

describe("live-book description/metadata update requests are General Inquiries", () => {
  it.each([
    META,
    "Can I change the book description on Flipkart now that my book is live?",
    "I want to edit the blurb of my already published book. How?"
  ])("recognises %s", (text) => {
    expect(isLiveMetadataUpdateRequest(text)).toBe(true);
    expect(heuristicClassify(text)).toMatchObject({ category: "GENERAL_INQUIRY", priority: "LOW" });
  });

  it.each([
    ["The description on Amazon is wrong, please fix it", "DISTRIBUTION_AVAILABILITY"],
    ["My ISBN on Amazon is different, can you update it?", "ISBN_METADATA"],
    ["My book is unavailable on Amazon, can you update the listing?", "DISTRIBUTION_AVAILABILITY"]
  ])("does not swallow the problem report %s", (text, category) => {
    expect(isLiveMetadataUpdateRequest(text)).toBe(false);
    expect(heuristicClassify(text).category).toBe(category);
  });

  it("overrides a model that labelled it Distribution (the real-API miss), with LOW priority and no distribution citation", async () => {
    const out = await analyze("Update description", META,
      modelAnswer({ category: "DISTRIBUTION_AVAILABILITY", priority: "MEDIUM", citations: ["kb.distribution-availability"] }),
      draftContent("Metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.", ["kb.metadata-updates"]));
    expect(out.analysis.category).toBe("GENERAL_INQUIRY");
    expect(out.analysis.priority).toBe("LOW");
    expect(out.analysis.requiresHumanReview).toBe(true);
    expect(out.analysis.knowledgeBaseCitations).not.toContain("kb.distribution-availability");
  });
});

describe("timelines are checked against the answered topic", () => {
  const draft = (days: string) => draftContent(`Metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect within ${days} business days.`, ["kb.metadata-updates"]);
  const classify = modelAnswer({ category: "GENERAL_INQUIRY", priority: "LOW", citations: [] });

  it("accepts the 3–5 business days metadata-update policy", async () => {
    const out = await analyze("Update description", META, classify, draft("3–5"));
    expect(out.meta.draftSource).toBe("model");
    expect(out.analysis.draftResponse).toContain("3–5");
  });

  it("rejects the new-listing 7–10 days for a metadata update (the real-API error)", async () => {
    const out = await analyze("Update description", META, classify, draft("7–10"));
    expect(out.meta.draftSource).toBe("fallback");
    expect(out.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });

  it("rejects a printing timeline in a royalty draft when only the royalty topic may justify time frames", () => {
    const sources = [{ text: "Royalties are calculated quarterly and paid within 45 days of the quarter ending." }, { text: "Standard print turnaround: 5–7 business days." }];
    const text = "Royalties follow the quarterly cycle. Please allow 5–7 business days for us to check your account.";
    // Without a topic restriction every source counts (previous behaviour); with it the foreign timeline is caught.
    expect(findUnsupportedClaims(text, sources, { strict: true }).some((i) => i.kind === "unsupported-timeline")).toBe(false);
    expect(findUnsupportedClaims(text, sources, { strict: true, timelineText: sources[0]!.text }).some((i) => i.kind === "unsupported-timeline")).toBe(true);
  });
});

describe("completed-action check: future conditions pass, completed claims still fail", () => {
  const sources = [{ text: "A stock sync issue can be re-synced within 24–48 hours." }];
  const kinds = (t: string) => findUnsupportedClaims(t, sources, { strict: true }).map((i) => i.kind);

  it.each([
    "We will follow up to confirm the issue is resolved.",
    "Our team will update you once the listing has been fixed.",
    "We will check whether the book is available again."
  ])("accepts %s", (t) => expect(kinds(t)).not.toContain("completed-action"));

  it.each([
    "The issue is resolved.",
    "We confirm that your issue has been fixed.",
    "I have already triggered the re-sync.",
    "Our team has escalated this."
  ])("still rejects %s", (t) => expect(kinds(t)).toContain("completed-action"));
});

describe("output budget", () => {
  it("defaults to 800 tokens so valid JSON drafts are not truncated at 400", () => {
    expect(loadAiConfig({ OPENROUTER_API_KEY: FAKE_KEY }).maxOutputTokens).toBe(800);
  });
});

// Real-API format drift seen on 2026-10-16: replies with a trailing "Citations:" line, or plain text instead of JSON.
describe("model output format handling (validation unchanged)", () => {
  const classify = modelAnswer({ category: "ROYALTY_PAYMENTS", priority: "HIGH", citations: ["kb.royalty-policy"] });
  const BODY = "Royalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will verify your account and follow up.";
  const text = (extra = "") => `Dear {{authorFirstName}},\n\n${BODY}${extra}\n\nWarm regards,\nBookLeaf Author Support`;

  it("moves a trailing Citations line out of the author-facing draft", async () => {
    const out = await analyze("Royalty", "Where is my royalty?", classify, JSON.stringify({ draft: `${text()}\n\nCitations: [kb.royalty-policy]`, citations: [] }));
    expect(out.meta.draftSource).toBe("model");
    expect(out.analysis.draftResponse).not.toMatch(/Citations/i);
    expect(out.analysis.knowledgeBaseCitations).toContain("kb.royalty-policy");
  });

  it("accepts a plain-text reply that starts with the greeting, and still validates it", async () => {
    const ok = await analyze("Royalty", "Where is my royalty?", classify, `${text()}\n\nCitations: kb.royalty-policy`);
    expect(ok.meta.draftSource).toBe("model");
    expect(ok.analysis.draftResponse).not.toMatch(/Citations/i);
    const invented = await analyze("Royalty", "Where is my royalty?", classify, text(" We will answer within 5–7 business days."));
    expect(invented.meta.draftSource).toBe("fallback");
    expect(invented.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });

  it("still rejects plain text without the greeting and citations of unretrieved excerpts", async () => {
    expect((await analyze("Royalty", "Where?", classify, "Sure, here is your answer.")).meta.fallbackReasons).toContain("AI_INVALID_OUTPUT");
    const foreign = await analyze("Royalty", "Where?", classify, JSON.stringify({ draft: `${text()}\n\nCitations: kb.printing-quality`, citations: [] }));
    expect(foreign.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });

  it("allows 'if royalties are due' but still rejects an unconditional due-date promise", () => {
    const k = (t: string) => findUnsupportedClaims(t, [{ text: "royalties" }], { strict: true }).map((i) => i.kind);
    expect(k("If royalties are due and below the threshold, they roll over to the next quarter.")).not.toContain("payout-promise");
    expect(k("Your royalty payment is due soon.")).toContain("payout-promise");
    expect(k("Your payout is scheduled for next week.")).toContain("payout-promise");
  });
});

describe("stray JSON never reaches the admin-facing draft", () => {
  const classify = modelAnswer({ category: "ROYALTY_PAYMENTS", priority: "HIGH", citations: ["kb.royalty-policy"] });
  const body = "Dear {{authorFirstName}},\n\nRoyalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will verify your account and follow up.\n\nWarm regards,\nBookLeaf Author Support";

  it("strips a trailing {\"citations\": [...]} fragment from plain text and from the JSON draft string", async () => {
    for (const raw of [`${body}\n\n{"citations": ["kb.royalty-policy"]}`, JSON.stringify({ draft: `${body}\n\n{"citations": ["kb.royalty-policy"]}`, citations: ["kb.royalty-policy"] })]) {
      const out = await analyze("Royalty", "Where is my royalty?", classify, raw);
      expect(out.meta.draftSource).toBe("model");
      expect(out.analysis.draftResponse).not.toMatch(/citations|\{"/i);
    }
  });

  it("rejects a draft with JSON embedded mid-text", async () => {
    const out = await analyze("Royalty", "Where?", classify, JSON.stringify({ draft: body.replace("Our team", '{"x": 1} Our team'), citations: ["kb.royalty-policy"] }));
    expect(out.meta.fallbackReasons).toContain("AI_INVALID_OUTPUT");
  });
});

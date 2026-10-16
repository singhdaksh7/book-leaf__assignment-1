import { describe, expect, it } from "vitest";
import { createAiService } from "../src/service.js";
import { buildDrafterPrompt, DEFAULT_DRAFTER_LIMITS, DRAFTER_SYSTEM_PROMPT } from "../src/drafting/prompt.js";
import { KB_CHUNKS } from "../src/knowledge/chunks.js";
import { modelAnswer, scriptedProvider } from "./helpers.js";

const author = { name: "Jane Roe" };
const SIGN = "\n\nWarm regards,\nBookLeaf Author Support";
const draft = (body: string, citations: string[]) => ({ draft: `Dear {{authorFirstName}},\n\n${body}${SIGN}`, citations });

async function run(subject: string, description: string, category: string, answer: { draft: string; citations: string[] }, classifierCitation: string) {
  const provider = scriptedProvider(modelAnswer({ category, priority: "MEDIUM", citations: [classifierCitation] }), answer);
  return createAiService({ provider }).analyzeTicketDetailed({ ticketId: "t", subject, description, authorContext: author });
}

const ROYALTY_TICKET = ["No royalty yet", "I published my book four months ago and still have not received any royalty payment."] as const;
const PROFILE_TICKET = ["Profile question", "How do I update my author biography and profile photo shown on the portal?"] as const;

// The rejected outputs below reproduce what a real free model (nvidia/nemotron-3-super-120b-a12b:free) wrote for synthetic tickets on
// 2026-10-16. The strict grounding check must keep rejecting invented time frames; the revised prompt exists so models stop producing them.
describe("strict grounding still rejects what real models invented", () => {
  it("rejects a royalty draft that promises a 48-hour answer", async () => {
    const out = await run(...ROYALTY_TICKET, "ROYALTY_PAYMENTS",
      draft("I understand your concern about not receiving any royalties four months after publishing. Royalties are calculated quarterly and paid within 45 days of the quarter ending. We will look into this and get back to you within 48 hours with specific details.", ["kb.royalty-policy"]),
      "kb.royalty-policy");
    expect(out.meta.draftSource).toBe("fallback");
    expect(out.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });

  it("rejects a general-inquiry draft that invents a 24-48 hour update window", async () => {
    const out = await run(...PROFILE_TICKET, "GENERAL_INQUIRY",
      draft("To update your biography and photo, log in to your dashboard and open the Author Profile section. Updates typically appear within 24-48 hours.", []),
      "kb.company-overview");
    expect(out.meta.draftSource).toBe("fallback");
    expect(out.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });
});

describe("a draft that follows the revised guidance is accepted", () => {
  it("accepts a royalty draft that commits to no date or response time", async () => {
    const out = await run(...ROYALTY_TICKET, "ROYALTY_PAYMENTS",
      draft("I am sorry you have been waiting four months without a clear answer. Royalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will verify the royalty figures for your book against our internal records and follow up with you. Please also check that your bank details are linked in your dashboard.", ["kb.royalty-policy"]),
      "kb.royalty-policy");
    expect(out.meta.draftSource).toBe("model");
    expect(out.meta.fallbackReasons).toEqual([]);
  });

  it("accepts a general draft that promises a follow-up without a measurable time frame or an invented feature", async () => {
    const out = await run(...PROFILE_TICKET, "GENERAL_INQUIRY",
      draft("Thank you for reaching out about your author biography and profile photo. I do not want to guess at the steps, so our team will review your request and explain the correct way to update them, and we will follow up with you.", []),
      "kb.company-overview");
    expect(out.meta.draftSource).toBe("model");
    expect(out.meta.fallbackReasons).toEqual([]);
  });
});

describe("prompt construction", () => {
  const args = {
    category: "ROYALTY_PAYMENTS" as const, priority: "HIGH" as const, subject: "s", description: "d", history: [], bookFacts: {},
    policy: KB_CHUNKS.filter((c) => c.id === "kb.royalty-policy"),
    tone: KB_CHUNKS.find((c) => c.id === "kb.tone-guidelines")!.content,
    example: "Provide the specific next payout date. Escalate with a 48-hour resolution timeline.",
    limits: DEFAULT_DRAFTER_LIMITS, nonce: "abc123"
  };

  it("labels tone guidelines and the style example as illustrations, not commitments", () => {
    const { user } = buildDrafterPrompt(args);
    expect(user).toContain("TONE GUIDELINES (trusted; style only. Time frames or promises inside are illustrations, NOT commitments)");
    expect(user).toContain("STYLE EXAMPLE (trusted; tone only. Do not reuse its numbers, dates, time frames or promises)");
  });

  it("no longer tells the model to give a clear timeline for escalations, and says what to do when facts are missing", () => {
    expect(DRAFTER_SYSTEM_PROMPT).not.toContain("give a clear timeline for escalations");
    expect(DRAFTER_SYSTEM_PROMPT).toContain("WHEN FACTS ARE MISSING");
    expect(DRAFTER_SYSTEM_PROMPT).toMatch(/make no commitment about dates, amounts, production stages, response times or distribution/);
    expect(DRAFTER_SYSTEM_PROMPT).toMatch(/not named in the POLICY EXCERPTS/);
  });

  it("keeps the knowledge-base text unchanged (decision: the guidance is reframed in the prompt, not rewritten)", () => {
    expect(KB_CHUNKS.find((c) => c.id === "kb.tone-guidelines")!.content).toContain("within 48 hours");
  });
});

describe("invented product features are rejected (found in real-model drafts on 2026-10-16)", () => {
  const ticket = ["Profile question", "How do I update my author biography and profile photo shown on the portal?"] as const;
  it.each([
    ["a quoted section name not in any source", "Please log in and open the 'Author Profile' section to edit your biography."],
    ["a quoted menu reached by navigating", "Please go to \"Account Settings\" and upload a new photo."],
    ["a labelled section", "Use the section called Profile Manager to change your photo."],
    ["telling the author to reply to an e-mail", "If you need help, please reply to this email with details."]
  ])("rejects %s", async (_label, body) => {
    const out = await run(...ticket, "GENERAL_INQUIRY", draft(`Thank you for writing. ${body} Our team will also review your request.`, []), "kb.company-overview");
    expect(out.meta.draftSource).toBe("fallback");
    expect(out.meta.fallbackReasons).toContain("AI_UNGROUNDED_OUTPUT");
  });

  it("still accepts plain references to the dashboard and a label the author themselves used", async () => {
    const out = await run("Where is the 'Royalty Statement' section", "I cannot find the 'Royalty Statement' section in my dashboard.", "GENERAL_INQUIRY",
      draft("Thank you for asking about the 'Royalty Statement' section in your dashboard. Our team will review what you are seeing and explain where to find it.", []), "kb.company-overview");
    expect(out.meta.draftSource).toBe("model");
  });
});

describe("time frames in style-only blocks are masked, policy excerpts are not", () => {
  const base = {
    category: "ROYALTY_PAYMENTS" as const, priority: "HIGH" as const, subject: "s", description: "d", history: [], bookFacts: {},
    policy: KB_CHUNKS.filter((c) => c.id === "kb.royalty-policy"),
    tone: KB_CHUNKS.find((c) => c.id === "kb.tone-guidelines")!.content,
    limits: DEFAULT_DRAFTER_LIMITS, nonce: "abc123"
  };
  const example = "Explain the 45-day payout window. Escalate with a 48-hour resolution timeline; reply within 24–48 hours or 5-7 business days.";

  it("masks durations in the tone guidelines and the style example", () => {
    const { user } = buildDrafterPrompt({ ...base, example });
    const style = user.slice(user.indexOf("TONE GUIDELINES"), user.indexOf("TICKET SUBJECT"));
    expect(style).not.toMatch(/48[\s-]?hours?|24[–-]48|5-7 business|45-day/);
    expect(style).toContain("[time frame]");
  });

  it("leaves the policy excerpts intact, so grounded time frames stay citable", () => {
    const { user } = buildDrafterPrompt({ ...base, example });
    const policy = user.slice(user.indexOf("POLICY EXCERPTS"), user.indexOf("TONE GUIDELINES"));
    expect(policy).toContain("within 45 days of the quarter ending");
  });
});

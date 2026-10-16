import React from "react";

// Shown in the admin AI panel when the latest AI attempt FAILED. A failed attempt must never look like "no analysis yet": the admin needs to
// know the provider failed (for example the free daily quota), that no draft exists, and that nothing was sent to the author.
const REASONS: Record<string, string> = {
  AI_RATE_LIMITED: "The AI provider's usage limit was reached.",
  AI_TIMEOUT: "The AI provider did not answer in time.",
  AI_NETWORK_ERROR: "The AI provider could not be reached.",
  AI_PROVIDER_ERROR: "The AI provider returned an error.",
  AI_NOT_CONFIGURED: "AI is not configured, or the provider rejected the credentials.",
  AI_INVALID_OUTPUT: "The AI model returned an unusable response.",
  AI_UNGROUNDED_OUTPUT: "The AI draft was rejected because it contained unsupported claims.",
  AI_ATTEMPT_ABANDONED: "The AI attempt did not finish."
};

export const AiFailureNotice: React.FC<{ errorCode: string }> = ({ errorCode }) => (
  <div
    role="status"
    data-testid="ai-failed"
    className="p-4 bg-red-950/40 border border-red-900/70 rounded text-xs text-red-200 space-y-1"
  >
    <p className="font-semibold">AI analysis failed ({errorCode})</p>
    <p>{REASONS[errorCode] ?? "The AI analysis could not be completed."}</p>
    <p className="text-red-300/80">
      No draft was generated and nothing was sent to the author. Reply manually, or use Re-run AI later.
    </p>
  </div>
);

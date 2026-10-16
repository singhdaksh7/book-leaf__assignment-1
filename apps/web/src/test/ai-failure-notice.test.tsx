import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { AiFailureNotice } from "../components/admin/AiFailureNotice";

describe("AiFailureNotice (a failed AI attempt must not look like 'no analysis yet')", () => {
  it("names the failure code and says no draft was made and nothing was sent", () => {
    render(<AiFailureNotice errorCode="AI_RATE_LIMITED" />);
    expect(screen.getByTestId("ai-failed")).toBeInTheDocument();
    expect(screen.getByText(/AI analysis failed \(AI_RATE_LIMITED\)/)).toBeInTheDocument();
    expect(screen.getByText(/usage limit was reached/i)).toBeInTheDocument();
    expect(screen.getByText(/No draft was generated and nothing was sent to the author/)).toBeInTheDocument();
  });

  it("uses a generic message for an unknown code but still shows the code", () => {
    render(<AiFailureNotice errorCode="AI_SOMETHING_NEW" />);
    expect(screen.getByText(/AI analysis failed \(AI_SOMETHING_NEW\)/)).toBeInTheDocument();
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();
  });

  it("offers no draft and no insert button", () => {
    render(<AiFailureNotice errorCode="AI_UNGROUNDED_OUTPUT" />);
    expect(screen.queryByRole("button", { name: /Insert Draft/i })).not.toBeInTheDocument();
    expect(screen.getByText(/unsupported claims/i)).toBeInTheDocument();
  });
});

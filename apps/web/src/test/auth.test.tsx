import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { LoginPage } from "../pages/auth/LoginPage";

function renderLoginPage() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </BrowserRouter>
  );
}

describe("LoginPage Component", () => {
  it("renders login form with title, inputs and submit button", () => {
    renderLoginPage();

    expect(screen.getByText("BookLeaf Author Portal")).toBeInTheDocument();
    expect(screen.getByLabelText(/Author Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign In to Portal/i })).toBeInTheDocument();
  });

  it("populates fields when demo author credentials button is clicked", () => {
    renderLoginPage();

    const authorBtn = screen.getByRole("button", { name: /Demo Author/i });
    fireEvent.click(authorBtn);

    const emailInput = screen.getByLabelText(/Author Email Address/i) as HTMLInputElement;
    expect(emailInput.value).toBe("author@bookleafpublishing.test");
  });

  it("shows error when empty credentials submitted", async () => {
    renderLoginPage();

    const emailInput = screen.getByLabelText(/Author Email Address/i);
    const passwordInput = screen.getByLabelText(/Password/i);
    const submitBtn = screen.getByRole("button", { name: /Sign In to Portal/i });

    fireEvent.change(emailInput, { target: { value: "" } });
    fireEvent.change(passwordInput, { target: { value: "" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Please enter both email and password/i)).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
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

describe("LoginPage when already signed in", () => {
  const stubClient = (role: "AUTHOR" | "ADMIN") =>
    ({ getCurrentUser: async () => ({ user: { id: "u1", email: "x@example.test", role, authorProfile: null } }) }) as never;

  it.each([["AUTHOR", "/dashboard", "author home"], ["ADMIN", "/admin/dashboard", "admin home"]] as const)(
    "redirects a signed-in %s away from /login to %s",
    async (role, target, label) => {
      render(
        <MemoryRouter initialEntries={["/login"]}>
          <AuthProvider initialClient={stubClient(role)}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path={target} element={<div>{label}</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /Sign In to Portal/i })).not.toBeInTheDocument();
    }
  );
});

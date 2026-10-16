import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { ApiClientError } from "../api";
import { LoginPage } from "../pages/auth/LoginPage";
import { RegisterPage } from "../pages/auth/RegisterPage";

const GOOD = "Sturdy-Pass-2026";
const newUser = { id: "u1", email: "asha@writers.test", role: "AUTHOR" as const, authorProfile: { id: "p1", userId: "u1", externalAuthorId: "WEB-1", name: "Asha Verma", phone: "", city: "", joinedDate: "2026-10-16" } };

function setup(register: (r: unknown) => Promise<unknown> = async () => ({ user: newUser })) {
  const client = {
    isMock: false,
    getCurrentUser: async () => { throw new ApiClientError("UNAUTHENTICATED", "No session", 401); },
    register: vi.fn(register)
  } as never;
  const view = render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider initialClient={client}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<div>login screen</div>} />
          <Route path="/dashboard" element={<div>author home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
  return { ...view, register: (client as unknown as { register: ReturnType<typeof vi.fn> }).register };
}

const nameField = () => screen.getByLabelText("Full name") as HTMLInputElement;
const emailField = () => screen.getByLabelText("Email address") as HTMLInputElement;
const passwordField = () => screen.getByLabelText("Password", { selector: "input" }) as HTMLInputElement;
const confirmField = () => screen.getByLabelText("Confirm password", { selector: "input" }) as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: "Create account" });

async function fill(values: Partial<{ name: string; email: string; password: string; confirm: string }> = {}) {
  await screen.findByLabelText("Full name");
  fireEvent.change(nameField(), { target: { value: values.name ?? "Asha Verma" } });
  fireEvent.change(emailField(), { target: { value: values.email ?? "  Asha@Writers.test " } });
  fireEvent.change(passwordField(), { target: { value: values.password ?? GOOD } });
  fireEvent.change(confirmField(), { target: { value: values.confirm ?? values.password ?? GOOD } });
}

describe("RegisterPage", () => {
  it("renders the form with a link back to Sign In and no role field", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: /Create your author account/i })).toBeInTheDocument();
    for (const label of ["Full name", "Email address"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(passwordField()).toBeInTheDocument();
    expect(confirmField()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText(/role/i)).toBeNull();
    expect(document.querySelector('[name="role"]')).toBeNull();
  });

  it("is reachable from the login page", () => {
    render(
      <MemoryRouter>
        <AuthProvider initialClient={{ isMock: false, getCurrentUser: async () => { throw new ApiClientError("UNAUTHENTICATED", "x", 401); } } as never}>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
  });

  it("shows clear errors for every empty field, focuses the first one and does not call the API", async () => {
    const { register } = setup();
    await screen.findByLabelText("Full name");
    fireEvent.click(submit());
    expect(await screen.findByText("Enter your full name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Create a password.")).toBeInTheDocument();
    expect(screen.getByText("Confirm your password.")).toBeInTheDocument();
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid email", { email: "nope" }, "Enter a valid email address."],
    ["a short password", { password: "Ab1", confirm: "Ab1" }, "Use at least 12 characters."],
    ["a password without a number", { password: "NoDigitsInThisOne", confirm: "NoDigitsInThisOne" }, "Include a number."],
    ["mismatched confirmation", { confirm: `${GOOD}!` }, "Passwords do not match."]
  ])("rejects %s locally", async (_label, values, message) => {
    const { register } = setup();
    await fill(values);
    fireEvent.click(submit());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it("toggles password visibility independently for each field", async () => {
    setup();
    await screen.findByLabelText("Full name");
    expect(passwordField().type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordField().type).toBe("text");
    expect(confirmField().type).toBe("password");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show password confirmation" }));
    expect(confirmField().type).toBe("text");
  });

  it("updates the live requirement checklist as the password is typed", async () => {
    setup();
    await screen.findByLabelText("Full name");
    const list = screen.getByRole("list", { name: "Password requirements" });
    expect(list).toHaveTextContent("A number (not met yet)");
    fireEvent.change(passwordField(), { target: { value: "abcDEF123456" } });
    expect(list).toHaveTextContent("A number (met)");
    expect(list).toHaveTextContent("At least 12 characters (met)");
  });

  it("submits trimmed values with exactly the four contract fields, shows success and continues to the dashboard", async () => {
    const { register } = setup();
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText("Account created")).toBeInTheDocument();
    expect(register).toHaveBeenCalledTimes(1);
    const sent = register.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["confirmPassword", "email", "name", "password"]);
    expect(sent.email).toBe("Asha@Writers.test");
    expect(sent.name).toBe("Asha Verma");
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));
    expect(await screen.findByText("author home")).toBeInTheDocument();
  });

  it("disables nothing silently: shows a loading state and prevents a double submit", async () => {
    let release!: () => void;
    const { register } = setup(() => new Promise((resolve) => { release = () => resolve({ user: newUser }); }));
    await fill();
    fireEvent.click(submit());
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(submit()).toBeDisabled();
    fireEvent.click(submit());
    expect(register).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByText("Account created")).toBeInTheDocument();
  });

  it("handles a duplicate email with a generic message and a Sign In link", async () => {
    setup(async () => { throw new ApiClientError("CONFLICT", "We could not create an account with these details. If you already have an account, sign in instead.", 409); });
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText(/We could not create an account with these details/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Sign In" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Account created")).toBeNull();
    // The typed values survive so the person can correct them.
    expect(emailField().value).toContain("Writers.test");
  });

  it("maps server validation details onto the matching fields", async () => {
    setup(async () => { throw new ApiClientError("VALIDATION_ERROR", "Invalid registration request", 400, [{ path: "password", message: "This password is too common." }]); });
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText("This password is too common.")).toBeInTheDocument();
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(passwordField()).toHaveFocus();
  });

  it("explains rate limiting and network failures without leaking details", async () => {
    const limited = setup(async () => { throw new ApiClientError("RATE_LIMITED", "Too many sign-up attempts. Try again later.", 429); });
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText(/Too many sign-up attempts. Please wait/)).toBeInTheDocument();
    limited.unmount();

    setup(async () => { throw new TypeError("Failed to fetch"); });
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  it("redirects an already signed-in visitor away from the form", async () => {
    const client = { isMock: false, getCurrentUser: async () => ({ user: newUser }) } as never;
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider initialClient={client}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/dashboard" element={<div>author home</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText("author home")).toBeInTheDocument();
  });
});

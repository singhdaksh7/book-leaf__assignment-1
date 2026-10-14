import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { BooksPage } from "../pages/author/BooksPage";

function renderBooksPage() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <BooksPage />
      </AuthProvider>
    </BrowserRouter>
  );
}

describe("BooksPage Component", () => {
  it("renders catalog header and search input", async () => {
    renderBooksPage();

    expect(screen.getByText("My Books")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by title, ISBN, or Book ID/i)).toBeInTheDocument();
  });

  it("loads books and displays them in the table view", async () => {
    renderBooksPage();

    await waitFor(() => {
      expect(screen.getByText(/The Celestial Cartographer/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Whispers Beneath the Banyan/i)).toBeInTheDocument();
    // Test dataset null fidelity: null MRP rendered as em-dash or placeholder, not failing
    expect(screen.getByText(/The Midnight Arboretum/i)).toBeInTheDocument();
  });

  it("filters books by search query", async () => {
    renderBooksPage();

    await waitFor(() => {
      expect(screen.getByText(/The Celestial Cartographer/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by title, ISBN, or Book ID/i);
    fireEvent.change(searchInput, { target: { value: "Celestial" } });

    expect(screen.getByText(/The Celestial Cartographer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Whispers Beneath the Banyan/i)).not.toBeInTheDocument();
  });
});

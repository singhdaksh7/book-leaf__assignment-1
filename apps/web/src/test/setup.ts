import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock scrollIntoView for jsdom
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

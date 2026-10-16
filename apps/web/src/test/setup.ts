import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock scrollIntoView and URL create/revoke for jsdom
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = vi.fn();
  }

  // Realm parity with real browsers: there, Response.blob() yields the page's own Blob. Under jsdom the global Blob is
  // jsdom's class while Node's fetch Response (undici 6.x on Node 22) returns Node's native Blob, so `instanceof Blob`
  // fails even though the bytes are right. Node 24 already returns the global Blob, making this a no-op there.
  const nativeResponseBlob = Response.prototype.blob;
  Response.prototype.blob = async function blob(this: Response): Promise<Blob> {
    const result: { arrayBuffer(): Promise<ArrayBuffer>; type: string } = await nativeResponseBlob.call(this);
    return result instanceof Blob ? result : new Blob([await result.arrayBuffer()], { type: result.type });
  };
}

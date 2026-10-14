import { type ApiClient } from "./client";
import { HttpApiClient } from "./http";
import { MockApiClient } from "./mock";

export * from "./client";
export * from "./http";
export * from "./mock";

// Live backend is the production default.
// Mock adapter is strictly isolated for development/testing when backend is offline.
const isProduction = import.meta.env.PROD;
const shouldUseMock = !isProduction && import.meta.env.VITE_USE_MOCKS !== "false";

let globalClient: ApiClient = shouldUseMock ? new MockApiClient() : new HttpApiClient();

export function getApiClient(): ApiClient {
  return globalClient;
}

export function setApiClient(client: ApiClient): void {
  globalClient = client;
}

export function toggleMockMode(useMock: boolean): ApiClient {
  // Prohibit toggling in production to prevent synthetic data from appearing
  if (isProduction) {
    console.warn("Mock mode switching is strictly disabled in production builds.");
    return globalClient;
  }
  globalClient = useMock ? new MockApiClient() : new HttpApiClient();
  return globalClient;
}

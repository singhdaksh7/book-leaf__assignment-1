import { getApiClient } from "./index";
import { onSessionExpired } from "./http";

export type TicketEventType =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.reply.created"
  | "ticket.analysis.updated";

export interface TicketEventPayload {
  ticketId: string;
  occurredAt: string;
  version?: string; // ISO timestamp string per API contract
  [key: string]: unknown;
}

export type TicketEventListener = (event: {
  type: TicketEventType;
  payload: TicketEventPayload;
}) => void;

export class TicketEventManager {
  private eventSource: EventSource | null = null;
  private listeners: Set<TicketEventListener> = new Set();
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private isUsingPolling = false;
  private lastSeenVersions: Map<string, string> = new Map();
  private isClosedExplicitly = false;
  private unregisterSessionExpired: (() => void) | null = null;

  constructor() {
    this.unregisterSessionExpired = onSessionExpired(() => {
      this.handleSessionExpired();
    });
    this.init();
  }

  public init() {
    this.isClosedExplicitly = false;

    // Check if EventSource is supported in browser runtime
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      this.startPollingFallback();
      return;
    }

    const client = getApiClient();
    if (client.isMock) {
      this.startPollingFallback();
      return;
    }

    // If an EventSource already exists and is active, do not recreate
    if (
      this.eventSource &&
      (this.eventSource.readyState === EventSource.OPEN ||
        this.eventSource.readyState === EventSource.CONNECTING)
    ) {
      return;
    }

    try {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
      this.eventSource = new EventSource(`${baseUrl}/events/tickets`, {
        withCredentials: true,
      });

      this.eventSource.onopen = () => {
        // SSE is active; stop polling fallback to prevent redundant network requests
        this.stopPollingFallback();
      };

      const eventTypes: TicketEventType[] = [
        "ticket.created",
        "ticket.updated",
        "ticket.reply.created",
        "ticket.analysis.updated",
      ];

      eventTypes.forEach((type) => {
        this.eventSource?.addEventListener(type, (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            this.notify({ type, payload });
          } catch (err) {
            console.warn("Failed to parse SSE payload:", err);
          }
        });
      });

      this.eventSource.onerror = () => {
        if (this.isClosedExplicitly) {
          return;
        }

        // Allow native EventSource reconnection for transient errors.
        // In native EventSource, transient connection drops put readyState into CONNECTING (0).
        if (this.eventSource && this.eventSource.readyState === EventSource.CONNECTING) {
          // Native reconnect in progress; keep polling as temporary fallback if needed
          this.startPollingFallback();
          return;
        }

        // If readyState is CLOSED (2), native reconnection has halted (e.g. fatal or 401/403)
        if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
          console.warn("SSE connection closed. Enabling polling fallback.");
          this.eventSource.close();
          this.eventSource = null;
          this.startPollingFallback();
        }
      };
    } catch {
      this.startPollingFallback();
    }
  }

  public startPollingFallback() {
    if (this.pollingIntervalId || this.isClosedExplicitly) return;
    this.isUsingPolling = true;

    // Polling heartbeat every 25 seconds per API contract
    this.pollingIntervalId = setInterval(() => {
      this.notify({
        type: "ticket.updated",
        payload: {
          ticketId: "",
          occurredAt: new Date().toISOString(),
        },
      });
    }, 25000);
  }

  public stopPollingFallback() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.isUsingPolling = false;
  }

  public isPollingActive(): boolean {
    return this.isUsingPolling;
  }

  public getEventSource(): EventSource | null {
    return this.eventSource;
  }

  public recordTicketVersion(ticketId: string, version: string): void {
    if (!ticketId || !version) return;
    const existing = this.lastSeenVersions.get(ticketId);
    if (!existing || version > existing) {
      this.lastSeenVersions.set(ticketId, version);
    }
  }

  public isDuplicateEvent(ticketId: string, version?: string): boolean {
    if (!ticketId || !version) return false;
    const lastVersion = this.lastSeenVersions.get(ticketId);
    if (!lastVersion) return false;
    return version <= lastVersion;
  }

  public clearVersionCache(): void {
    this.lastSeenVersions.clear();
  }

  public subscribe(listener: TicketEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(event: { type: TicketEventType; payload: TicketEventPayload }) {
    const { ticketId, version } = event.payload;

    // Event deduplication using ticket ID and ISO timestamp version
    if (ticketId && version) {
      if (this.isDuplicateEvent(ticketId, version)) {
        return; // Drop duplicate event
      }
      this.recordTicketVersion(ticketId, version);
    }

    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in ticket event listener:", err);
      }
    });
  }

  public close() {
    this.isClosedExplicitly = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.stopPollingFallback();
  }

  public handleSessionExpired() {
    this.close();
    this.lastSeenVersions.clear();
  }

  public destroy() {
    this.close();
    if (this.unregisterSessionExpired) {
      this.unregisterSessionExpired();
      this.unregisterSessionExpired = null;
    }
    this.listeners.clear();
    this.lastSeenVersions.clear();
  }
}

export const ticketEventManager = new TicketEventManager();

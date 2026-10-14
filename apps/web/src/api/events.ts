import { getApiClient } from "./index";

export type TicketEventType =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.reply.created"
  | "ticket.analysis.updated";

export interface TicketEventPayload {
  ticketId: string;
  occurredAt: string;
  version?: number;
  [key: string]: unknown;
}

export type TicketEventListener = (event: {
  type: TicketEventType;
  payload: TicketEventPayload;
}) => void;

export class TicketEventManager {
  private eventSource: EventSource | null = null;
  private listeners: Set<TicketEventListener> = new Set();
  private pollingIntervalId: any = null;
  private isUsingPolling = false;

  constructor() {
    this.init();
  }

  private init() {
    const client = getApiClient();
    if (client.isMock) {
      this.startPollingFallback();
      return;
    }

    try {
      const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
      this.eventSource = new EventSource(`${baseUrl}/events/tickets`, {
        withCredentials: true,
      });

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
        console.warn("SSE connection interrupted. Enabling polling fallback.");
        this.eventSource?.close();
        this.eventSource = null;
        this.startPollingFallback();
      };
    } catch {
      this.startPollingFallback();
    }
  }

  private startPollingFallback() {
    if (this.isUsingPolling) return;
    this.isUsingPolling = true;

    // Polling heartbeat every 25 seconds
    this.pollingIntervalId = setInterval(() => {
      // Trigger update tick
      this.notify({
        type: "ticket.updated",
        payload: {
          ticketId: "",
          occurredAt: new Date().toISOString(),
        },
      });
    }, 25000);
  }

  public subscribe(listener: TicketEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify(event: { type: TicketEventType; payload: TicketEventPayload }) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in ticket event listener:", err);
      }
    });
  }

  public destroy() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.listeners.clear();
  }
}

export const ticketEventManager = new TicketEventManager();

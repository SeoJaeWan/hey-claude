import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { ReactNode } from "react";

type SSEEventHandler = (data: any) => void;

interface SSEContextValue {
  subscribe: (sessionId: string) => void;
  unsubscribe: () => void;
  addEventHandler: (handler: SSEEventHandler) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

export const useSSEContext = () => {
  const ctx = useContext(SSEContext);
  if (!ctx) throw new Error("useSSEContext must be used within SSEProvider");
  return ctx;
};

export const SSEProvider = ({ children }: { children: ReactNode }) => {
  const clientIdRef = useRef<string | null>(null);
  const handlersRef = useRef<Set<SSEEventHandler>>(new Set());
  const pendingSubscribeRef = useRef<string | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/sse");

    es.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
          clientIdRef.current = data.clientId;
          console.log("[SSE] Connected, clientId:", data.clientId);

          // Execute pending subscribe if any
          if (pendingSubscribeRef.current) {
            fetch("/api/sse/subscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: data.clientId,
                sessionId: pendingSubscribeRef.current,
              }),
            });
            pendingSubscribeRef.current = null;
          }
          return;
        }

        // Dispatch to all registered handlers
        for (const handler of handlersRef.current) {
          handler(data);
        }
      } catch (error) {
        console.error("Failed to parse SSE message:", error);
      }
    });

    es.addEventListener("error", (error) => {
      console.error("SSE connection error:", error);
    });

    return () => {
      es.close();
      clientIdRef.current = null;
    };
  }, []);

  const subscribe = useCallback((sessionId: string) => {
    if (clientIdRef.current) {
      fetch("/api/sse/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientIdRef.current, sessionId }),
      });
    } else {
      pendingSubscribeRef.current = sessionId;
    }
  }, []);

  const unsubscribe = useCallback(() => {
    pendingSubscribeRef.current = null;
    if (clientIdRef.current) {
      fetch("/api/sse/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientIdRef.current }),
      });
    }
  }, []);

  const addEventHandler = useCallback((handler: SSEEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ subscribe, unsubscribe, addEventHandler }}>
      {children}
    </SSEContext.Provider>
  );
};

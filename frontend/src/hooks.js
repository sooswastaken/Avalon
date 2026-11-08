import { useEffect, useRef, useState, useCallback } from "react";
import { connectSocket } from "./socket.js";
import { api } from "./api.js";
export function useSocket(path, handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const connection = useRef(null);
  const [status, setStatus] = useState("disconnected");
  useEffect(() => {
    if (!path) return;
    const current = connectSocket(path, {
      onMessage: (message) => latest.current.onMessage(message),
      onStatus: setStatus,
      onTerminal: (code) => latest.current.onTerminal?.(code),
    });
    connection.current = current;
    return () => {
      current.close();
      connection.current = null;
    };
  }, [path]);
  const send = useCallback(
    (message) => connection.current?.send(message) || false,
    [],
  );
  return { send, status };
}
export function useResource(path, token) {
  const [result, setResult] = useState({ data: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ data: null, error: null });
    api(path, token, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ data: null, error: error.message });
      });
    return () => controller.abort();
  }, [path, token]);
  return result;
}

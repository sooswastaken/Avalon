// A connection owns its retry timer. Disposal prevents intentional closes from reconnecting.
export function connectSocket(
  path,
  { onMessage, onStatus = () => {}, onTerminal = () => {} },
  environment = {},
) {
  const Socket = environment.WebSocket || WebSocket;
  const schedule = environment.setTimeout || setTimeout;
  const cancel = environment.clearTimeout || clearTimeout;
  let socket,
    timer,
    disposed = false;
  function connect() {
    if (disposed) return;
    onStatus("connecting");
    socket = new Socket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`,
    );
    socket.onopen = () => {
      if (!disposed) onStatus("connected");
    };
    socket.onmessage = (event) => {
      if (disposed) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      onMessage(message);
    };
    socket.onerror = () => {
      if (!disposed) onStatus("error");
    };
    socket.onclose = (event) => {
      if (disposed) return;
      if ([4000, 4001, 4002, 4003].includes(event.code)) {
        disposed = true;
        onStatus("paused");
        onTerminal(event.code);
        return;
      }
      onStatus("reconnecting");
      timer = schedule(connect, 3000);
    };
  }
  connect();
  return {
    send(message) {
      if (!disposed && socket?.readyState === 1) {
        socket.send(JSON.stringify(message));
        return true;
      }
      return false;
    },
    close() {
      disposed = true;
      cancel(timer);
      socket?.close(1000, "Leaving view");
    },
  };
}

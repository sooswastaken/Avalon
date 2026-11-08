import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSocket } from "./socket.js";
class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.send = vi.fn();
    this.close = vi.fn(() => {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    });
    FakeSocket.instances.push(this);
  }
}
afterEach(() => {
  vi.useRealTimers();
  FakeSocket.instances = [];
});
describe("room connection lifecycle", () => {
  it("retries unexpected closes, then cancels a pending retry on disposal", () => {
    vi.useFakeTimers();
    const onMessage = vi.fn();
    const connection = connectSocket(
      "/ws/room?auth=test",
      { onMessage },
      { WebSocket: FakeSocket },
    );
    FakeSocket.instances[0].onclose({ code: 1006 });
    vi.advanceTimersByTime(3000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].onclose({ code: 1006 });
    connection.close();
    vi.advanceTimersByTime(6000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].close).toHaveBeenCalledOnce();
    FakeSocket.instances[1].onmessage({ data: '{"type":"state"}' });
    expect(onMessage).not.toHaveBeenCalled();
  });
  it.each([4000, 4001, 4002, 4003])(
    "does not reconnect terminal close code %i",
    (code) => {
      vi.useFakeTimers();
      const onTerminal = vi.fn();
      const connection = connectSocket(
        "/ws/room",
        { onMessage: vi.fn(), onTerminal },
        { WebSocket: FakeSocket },
      );
      FakeSocket.instances[0].onclose({ code });
      vi.advanceTimersByTime(10000);
      expect(FakeSocket.instances).toHaveLength(1);
      expect(onTerminal).toHaveBeenCalledWith(code);
      expect(connection.send({ type: "toggle_ready" })).toBe(false);
      connection.close();
    },
  );
  it("sends only on an open socket and ignores malformed messages", () => {
    const onMessage = vi.fn();
    const connection = connectSocket(
      "/ws/room",
      { onMessage },
      { WebSocket: FakeSocket },
    );
    const socket = FakeSocket.instances[0];
    socket.readyState = 0;
    expect(connection.send({ type: "vote_team" })).toBe(false);
    socket.readyState = 1;
    expect(connection.send({ type: "vote_team", approve: true })).toBe(true);
    expect(socket.send).toHaveBeenCalledWith(
      '{"type":"vote_team","approve":true}',
    );
    socket.onmessage({ data: "bad" });
    socket.onmessage({ data: '{"type":"info"}' });
    expect(onMessage).toHaveBeenCalledExactlyOnceWith({ type: "info" });
    connection.close();
  });
});

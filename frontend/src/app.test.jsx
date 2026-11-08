import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App.jsx";
class Socket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.close = vi.fn();
    Socket.instances.push(this);
  }
  send = vi.fn();
}
const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("retains an invitation through login, requests a room password, and opens only the selected room socket", async () => {
  history.replaceState(null, "", "/?room=invitation");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      if (path === "/login") return response({ user_id: "me" });
      if (path === "/rooms") return response([]);
      if (path === "/rooms/invitation/join")
        return JSON.parse(options.body).password === "secret"
          ? response({ room_id: "invitation", user_id: "me" })
          : response({ detail: "Incorrect or missing room password" }, 403);
      throw new Error(`Unexpected request ${path}`);
    }),
  );
  const user = userEvent.setup();
  const { unmount } = render(<App />);
  await user.type(screen.getByLabelText("Username"), "tester");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByRole("dialog", { name: "Enter Room Password" });
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Join Room" }));
  await waitFor(() =>
    expect(
      Socket.instances.some((socket) =>
        socket.url.includes("/ws/invitation?auth="),
      ),
    ).toBe(true),
  );
  expect(localStorage.getItem("authToken")).toBe(btoa("tester:password"));
  const room = Socket.instances.find((socket) =>
    socket.url.includes("/ws/invitation?auth="),
  );
  unmount();
  expect(room.close).toHaveBeenCalledOnce();
});
it("abandons a pending room join when Home is selected", async () => {
  localStorage.setItem("authToken", "token");
  let resolveJoin;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      if (path === "/profile") return response({ user_id: "me" });
      if (path === "/rooms")
        return response([
          {
            room_id: "room",
            member: false,
            phase: "lobby",
            host_id: "host",
            host_name: "Host",
            player_count: 1,
          },
        ]);
      if (path === "/rooms/room/join")
        return new Promise((resolve) => {
          resolveJoin = resolve;
        });
      throw new Error(`Unexpected request ${path}`);
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Enter" }));
  await screen.findByRole("heading", { name: "Connecting to room…" });
  await user.click(screen.getByRole("link", { name: "Home" }));
  await act(async () => {
    resolveJoin(response({ room_id: "room" }));
  });
  expect(
    Socket.instances.some((socket) => socket.url.includes("/ws/room")),
  ).toBe(false);
  expect(location.search).toBe("");
  expect(await screen.findByRole("button", { name: "Enter" })).toBeTruthy();
});

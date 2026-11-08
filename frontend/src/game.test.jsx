import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhaseActions } from "./Game.jsx";
import Wiki from "./Wiki.jsx";
import Lobby from "./Lobby.jsx";
vi.mock("qrcode", () => ({
  default: { toDataURL: () => Promise.resolve("data:image/png;base64,test") },
}));
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});
const players = ["A", "B", "C", "D", "E"].map((name, i) => ({
  user_id: String(i),
  name,
  role: i === 0 ? "Merlin" : null,
  ready: true,
  wins: 0,
}));
const base = {
  room_id: "room",
  host_id: "0",
  players,
  phase: "in_game",
  subphase: "proposal",
  round_number: 1,
  current_leader: "0",
  consecutive_rejections: 0,
  votes: {},
  submissions: {},
  current_team: ["0", "1"],
  lady_holder: "0",
  lady_history: ["0"],
  assassin_votes: {},
  assassin_candidates: ["1", "2"],
  evil_players: ["A", "D"],
  config: {
    morgana: true,
    percival: true,
    oberon: false,
    lady_enabled: true,
    lady_after_rounds: [2, 3, 4],
  },
};
it("requires exactly the quest team size and sends selected player ids", async () => {
  const user = userEvent.setup(),
    send = vi.fn();
  render(<PhaseActions state={base} userId="0" send={send} />);
  expect(screen.getByRole("button", { name: "Propose Team" }).disabled).toBe(
    true,
  );
  await user.click(screen.getByLabelText("A"));
  await user.click(screen.getByLabelText("B"));
  expect(screen.getByLabelText("C").disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Propose Team" }));
  expect(send).toHaveBeenCalledWith({ type: "propose_team", team: ["0", "1"] });
});
it("prevents a good player from submitting Fail", async () => {
  const user = userEvent.setup(),
    send = vi.fn();
  render(
    <PhaseActions
      state={{ ...base, subphase: "quest" }}
      userId="0"
      send={send}
    />,
  );
  expect(screen.getByRole("button", { name: "Play Fail" }).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Play Success" }));
  expect(send).toHaveBeenCalledWith({ type: "submit_card", card: "S" });
});
it("does not allow repeat team votes after server acknowledgement", () => {
  render(
    <PhaseActions
      state={{ ...base, subphase: "voting", votes: { 0: true } }}
      userId="0"
      send={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});
it("uses server assassination candidates when other roles are hidden", async () => {
  const user = userEvent.setup(),
    send = vi.fn();
  render(
    <PhaseActions
      state={{
        ...base,
        phase: "assassination",
        subphase: "assassination",
        players: players.map((p, i) => ({
          ...p,
          role: i === 0 ? "Mordred" : null,
        })),
      }}
      userId="0"
      send={send}
    />,
  );
  expect(screen.queryByLabelText("D")).toBeNull();
  await user.click(screen.getByLabelText("B"));
  await user.click(screen.getByRole("button", { name: "Vote" }));
  expect(send).toHaveBeenCalledWith({
    type: "assassination_vote",
    target: "1",
  });
});
it("excludes current and previous Lady holders", () => {
  render(
    <PhaseActions
      state={{ ...base, subphase: "lady", lady_history: ["0", "1"] }}
      userId="0"
      send={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("A")).toBeNull();
  expect(screen.queryByLabelText("B")).toBeNull();
  expect(screen.getByLabelText("C")).toBeTruthy();
});
it("only enables start when the lobby has enough ready players and user is host", async () => {
  const user = userEvent.setup(),
    send = vi.fn();
  const { rerender } = render(
    <Lobby
      state={{ ...base, players: players.slice(0, 4) }}
      userId="0"
      send={send}
      notify={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Start Game" }).disabled).toBe(
    true,
  );
  rerender(<Lobby state={base} userId="0" send={send} notify={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Start Game" }));
  expect(send).toHaveBeenCalledWith({ type: "start_game" });
  rerender(<Lobby state={base} userId="1" send={send} notify={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Start Game" })).toBeNull();
});
it("preserves multiple wiki query expansions and click toggles", async () => {
  history.replaceState(null, "", "/wiki.html?item=morgana,percival");
  const user = userEvent.setup();
  render(<Wiki />);
  const morgana = screen.getByRole("button", { name: /Morgana/ });
  expect(morgana.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: /Percival/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  await user.click(morgana);
  expect(morgana.getAttribute("aria-expanded")).toBe("false");
});

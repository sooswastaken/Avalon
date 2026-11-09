import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhaseActions, QuestResult } from "./Game.jsx";
import Wiki from "./Wiki.jsx";
import Lobby from "./Lobby.jsx";
import { Rooms } from "./components.jsx";
import { TypingNames, TypingText } from "./motion.jsx";
vi.mock("qrcode", () => ({
  default: { toDataURL: () => Promise.resolve("data:image/png;base64,test") },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});
it("backspaces removed names on each client and retargets without restarting its timer", () => {
  vi.useFakeTimers();
  const renderClients = (votes) => (
    <>
      {["0", "4"].map((userId) => (
        <div key={userId} data-testid={`client-${userId}`}>
          <PhaseActions state={{ ...base, subphase: "voting", votes, players: players.map((p) => ({ ...p, name: p.user_id === "1" ? "Bran" : p.user_id === "3" ? "Doran" : p.name })) }} userId={userId} send={vi.fn()} />
        </div>
      ))}
    </>
  );
  const { rerender } = render(renderClients({}));
  const visibleLists = () => screen.getAllByText("Waiting on:", { exact: false })
    .filter((element) => element.tagName === "EM")
    .map((element) => element.querySelector(".typing-text > span:last-child").textContent);
  rerender(renderClients({ 1: true }));
  expect(visibleLists()).toEqual(["A, Bran, C, Doran, E", "A, Bran, C, Doran, E"]);
  act(() => vi.advanceTimersByTime(28));
  expect(visibleLists()).toEqual(["A, Bra, C, Doran, E", "A, Bra, C, Doran, E"]);
  act(() => vi.advanceTimersByTime(14));
  rerender(renderClients({ 1: true, 3: true }));
  expect(visibleLists()).toEqual(["A, Bra, C, Doran, E", "A, Bra, C, Doran, E"]);
  act(() => vi.advanceTimersByTime(14));
  expect(visibleLists()).toEqual(["A, Br, C, Doran, E", "A, Br, C, Doran, E"]);
  act(() => vi.advanceTimersByTime(56));
  expect(visibleLists()).toEqual(["A, C, Doran, E", "A, C, Doran, E"]);
  act(() => vi.advanceTimersByTime(28));
  expect(visibleLists()).toEqual(["A, C, Dora, E", "A, C, Dora, E"]);
  act(() => vi.advanceTimersByTime(600));
  expect(visibleLists()).toEqual(["A, C, E", "A, C, E"]);
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, 1, 2])("backspaces player %i in place without altering neighboring names", (removed) => {
  vi.useFakeTimers();
  const items = ["Arthur", "Merlin", "Gwen"].map((text, id) => ({ id, text }));
  const { rerender, container } = render(<TypingNames items={items} />);
  const visible = () => container.querySelector(".typing-text > span:last-child").textContent;
  rerender(<TypingNames items={items.filter((item) => item.id !== removed)} />);
  for (let tick = 1; tick <= items[removed].text.length; tick++) {
    act(() => vi.advanceTimersByTime(28));
    expect(visible()).toBe(items.map((item) => item.id === removed
      ? item.text.slice(0, -tick) : item.text).filter(Boolean).join(", "));
  }
});

it("types new names and backspaces a removed name while preserving other names", () => {
  vi.useFakeTimers();
  const { rerender, container } = render(<TypingText text="Arthur, Gwen" />);
  const visible = () => container.querySelector(".typing-text > span:last-child").textContent;
  rerender(<TypingText text="Arthur, Merlin, Gwen" />);
  act(() => vi.advanceTimersByTime(28));
  expect(visible()).toBe("Arthur, MGwen");
  act(() => vi.advanceTimersByTime(300));
  expect(visible()).toBe("Arthur, Merlin, Gwen");
  rerender(<TypingText text="Arthur, Gwen" />);
  expect(visible()).toBe("Arthur, Merlin, Gwen");
  act(() => vi.advanceTimersByTime(28));
  expect(visible()).toBe("Arthur, Merlin,Gwen");
  act(() => vi.advanceTimersByTime(28));
  expect(visible()).toBe("Arthur, MerlinGwen");
  act(() => vi.advanceTimersByTime(300));
  expect(visible()).toBe("Arthur, Gwen");
});

it.each([
  ["voting", "Approve", "You have voted. Waiting for other players…", { votes: { 0: true } }],
  ["quest", "Play Success", "Waiting for quest team…", { submissions: { 0: true } }],
  ["assassination", "Vote", "Vote submitted. Waiting for other evil players…", { assassin_votes: { 0: "1" } }],
])("animates local %s submission without remounting the player list", async (subphase, button, message, update) => {
  const state = { ...base, subphase, players: players.map((p) => ({ ...p, role: "Mordred" })) };
  const { rerender, container } = render(<PhaseActions state={state} userId="0" send={vi.fn()} />);
  const list = container.querySelector(".typing-text");
  const control = screen.getByRole("button", { name: button });
  rerender(<PhaseActions state={{ ...state, ...update }} userId="0" send={vi.fn()} />);
  expect(control.isConnected).toBe(true);
  expect(control.closest("[inert]")).toBeTruthy();
  expect(container.querySelector(".typing-text")).toBe(list);
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  expect(control.isConnected).toBe(false);
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
  expect(screen.getByRole("button", { name: "Play Fail" }).disabled).toBe(false);
  expect(screen.queryByText(/Good players must play Success/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Play Fail" }));
  const warning = screen.getByRole("dialog", {
    name: "Why the hell are you trying to fail the quest?",
  });
  expect(within(warning).getByText(/Good players must play Success/)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  await user.click(within(warning).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Play Success" }));
  expect(send).toHaveBeenCalledWith({ type: "submit_card", card: "S" });
});
it("allows evil players to play Fail without a warning", async () => {
  const user = userEvent.setup(), send = vi.fn();
  render(
    <PhaseActions
      state={{ ...base, subphase: "quest", players: players.map((p) => ({ ...p, role: "Mordred" })) }}
      userId="0"
      send={send}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Play Fail" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(send).toHaveBeenCalledWith({ type: "submit_card", card: "F" });
});
it("shows proposal votes to spectators and players who already submitted", () => {
  const state = { ...base, subphase: "quest", votes: { 0: true, 1: false, 2: true, 3: true, 4: false }, submissions: { 0: true } };
  const { rerender } = render(<PhaseActions state={state} userId="0" send={vi.fn()} />);
  const checkVotes = () => {
    const votes = screen.getByRole("region", { name: "Proposal votes" });
    expect(votes.textContent).toContain("Voted for: A, C, D");
    expect(votes.textContent).toContain("Voted against: B, E");
  };
  checkVotes();
  rerender(<PhaseActions state={state} userId="4" send={vi.fn()} />);
  checkVotes();
});
it.each([[0, "There were 0 fail cards played."], [1, "There was 1 fail card played."], [2, "There were 2 fail cards played."]])(
  "uses correct grammar for %i fail cards",
  (fails, text) => {
    render(<QuestResult record={{ fails, success: fails === 0, team: ["A", "B"], leader: "A" }} />);
    expect(screen.getByText((_, element) => element.tagName === "P" && element.textContent === text)).toBeTruthy();
  },
);
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

it("keeps lobby actions available while switching setup and opens invitations on demand", async () => {
  const user = userEvent.setup(),
    send = vi.fn();
  render(<Lobby state={base} userId="0" send={send} notify={vi.fn()} />);
  expect(
    screen.queryByRole("img", { name: "Room invitation QR code" }),
  ).toBeNull();
  const playersTab = screen.getByRole("tab", { name: /Players/ });
  playersTab.focus();
  await user.keyboard("{ArrowRight}");
  expect(
    screen
      .getByRole("tab", { name: "Game setup" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  await user.click(screen.getByRole("button", { name: "Oberon" }));
  expect(send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Morgana & Percival" }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "set_config",
      morgana: false,
      percival: false,
    }),
  );
  expect(screen.getByRole("button", { name: "Start Game" }).disabled).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "Invite" }));
  expect(screen.getByRole("dialog", { name: "Invite Players" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("pages room choices while keeping the create action available", async () => {
  const user = userEvent.setup(),
    onJoin = vi.fn();
  const rooms = Array.from({ length: 7 }, (_, i) => ({
    room_id: String(i),
    host_name: `Host ${i}`,
    player_count: 1,
    phase: "lobby",
  }));
  render(
    <Rooms rooms={rooms} userId="me" onJoin={onJoin} onCreate={vi.fn()} />,
  );
  expect(screen.getAllByRole("button", { name: "Enter" })).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getAllByRole("button", { name: "Enter" })[0]);
  expect(onJoin).toHaveBeenCalledWith(
    expect.objectContaining({ room_id: "3" }),
  );
  expect(screen.getByRole("button", { name: "Create Room" })).toBeTruthy();
});

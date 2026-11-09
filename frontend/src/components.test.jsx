import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Auth, Modal, ModalPresence } from "./components.jsx";
import { ViewTransition } from "./motion.jsx";

afterEach(cleanup);

it.each(["Invite Players", "Game Paused"])(
  "animates %s on entry and retains it until its exit finishes",
  async (title) => {
    function Example({ open }) {
      return (
        <ViewTransition viewKey="room">
          <ModalPresence>
            {open && (
              <Modal key={title} title={title}>
                Waiting for players…
              </Modal>
            )}
          </ModalPresence>
        </ViewTransition>
      );
    }
    const { rerender } = render(<Example open />);
    const dialog = screen.getByRole("dialog", { name: title });
    expect(dialog.style.opacity).toBe("0");
    await waitFor(() => expect(dialog.style.opacity).toBe("1"));
    rerender(<Example open={false} />);
    expect(dialog.isConnected).toBe(true);
    expect(dialog.closest("[inert]")).toBeTruthy();
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  },
);

it("keeps signup fields out of login validation and preserves values across tabs", async () => {
  const user = userEvent.setup();
  render(<Auth onLogin={vi.fn()} notify={vi.fn()} />);
  const displayName = screen.getByLabelText("Display Name");
  expect(displayName.disabled).toBe(true);
  expect(displayName.required).toBe(false);
  await user.type(screen.getByLabelText("Username"), "arthur");
  await user.click(screen.getByRole("button", { name: "Sign Up" }));
  expect(displayName.disabled).toBe(false);
  expect(displayName.required).toBe(true);
  await user.type(displayName, "King Arthur");
  await user.click(screen.getByRole("button", { name: "Login" }));
  expect(displayName.closest("[inert]")).toBeTruthy();
  expect(displayName.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Sign Up" }));
  expect(displayName.value).toBe("King Arthur");
  expect(screen.getByLabelText("Username").value).toBe("arthur");
});

it("portals dialogs outside animated views and traps keyboard focus", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const { container } = render(
    <div style={{ transform: "translateY(8px)" }}>
      <Modal title="Invite Players" onClose={onClose}>
        <button>Copy Link</button>
      </Modal>
    </div>,
  );
  const dialog = screen.getByRole("dialog");
  expect(container.contains(dialog)).toBe(false);
  expect(document.activeElement).toBe(dialog);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByText("Copy Link"));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByText("Close"));
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";

// Keep each player's text separate so removals never erase neighboring names.
export function TypingNames({ items, emptyText = "server" }) {
  const reduceMotion = useReducedMotion();
  const desired = items.length ? items : [{ id: null, text: emptyText }];
  const target = useRef(desired);
  const shown = useRef(desired.map((item) => ({ ...item })));
  const [visible, setVisible] = useState(() => desired.map((item) => item.text).join(", "));
  const timer = useRef(null);
  const text = desired.map((item) => item.text).join(", ");

  useLayoutEffect(() => {
    target.current = desired;
    const settled = () => shown.current.length === target.current.length &&
      shown.current.every((item, index) =>
        item.id === target.current[index].id && item.text === target.current[index].text);
    if (reduceMotion) {
      shown.current = desired.map((item) => ({ ...item }));
      setVisible(text);
    }
    if (settled()) {
      clearInterval(timer.current);
      timer.current = null;
    } else if (timer.current === null) {
      timer.current = setInterval(() => {
        const removed = shown.current.findIndex((item) =>
          !target.current.some((next) => next.id === item.id));
        if (removed !== -1) {
          const item = shown.current[removed];
          item.text = Array.from(item.text).slice(0, -1).join("");
          if (!item.text) shown.current.splice(removed, 1);
        } else {
          shown.current = target.current.map((item) =>
            shown.current.find((previous) => previous.id === item.id) || { id: item.id, text: "" });
          const index = shown.current.findIndex((item, i) => item.text !== target.current[i].text);
          if (index !== -1) {
            const item = shown.current[index];
            const next = target.current[index].text;
            item.text = next.startsWith(item.text)
              ? Array.from(next).slice(0, Array.from(item.text).length + 1).join("")
              : Array.from(item.text).slice(0, -1).join("");
          }
        }
        setVisible(shown.current.map((item) => item.text).join(", "));
        if (settled()) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, 28);
    }
  }, [items, emptyText, reduceMotion]);

  useEffect(() => () => {
    clearInterval(timer.current);
    timer.current = null;
  }, []);
  return (
    <span className="typing-text">
      {visible !== text && <span className="sr-only">{text}</span>}
      <span aria-hidden={visible !== text || undefined}>{visible}</span>
    </span>
  );
}

// Retarget the running typewriter instead of restarting it on each room update.
export function TypingText({ text }) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(text);
  const shown = useRef(text);
  const target = useRef(text);
  const timer = useRef(null);

  useLayoutEffect(() => {
    target.current = text;
    if (reduceMotion) {
      shown.current = text;
      setVisible(text);
    }
    if (reduceMotion || shown.current === text) {
      clearInterval(timer.current);
      timer.current = null;
    } else if (timer.current === null) {
      timer.current = setInterval(() => {
        const previous = Array.from(shown.current);
        const next = Array.from(target.current);
        let prefix = 0;
        while (prefix < previous.length && previous[prefix] === next[prefix]) prefix++;
        let suffix = 0;
        while (
          suffix < previous.length - prefix &&
          suffix < next.length - prefix &&
          previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
        ) suffix++;
        // Backspace only the changed name, keeping the rest of the list intact.
        if (previous.length - suffix > prefix) {
          previous.splice(previous.length - suffix - 1, 1);
        } else {
          previous.splice(prefix, 0, next[prefix]);
        }
        shown.current = previous.join("");
        setVisible(shown.current);
        if (shown.current === target.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, 28);
    }
  }, [text, reduceMotion]);

  useEffect(() => () => {
    clearInterval(timer.current);
    timer.current = null;
  }, []);
  return (
    <span className="typing-text">
      {visible !== text && <span className="sr-only">{text}</span>}
      <span aria-hidden={visible !== text || undefined}>{visible}</span>
    </span>
  );
}

// Keep the shell still; only the content inside it changes views.
export function ViewTransition({ viewKey, children }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <ViewContent key={viewKey}>{children}</ViewContent>
    </AnimatePresence>
  );
}

function ViewContent({ children }) {
  const present = useIsPresent();
  const content = useRef(null);
  useLayoutEffect(() => {
    const parent = content.current?.parentElement;
    if (parent?.classList.contains("app-main")) parent.scrollTop = 0;
  }, []);
  return (
    <motion.div
      ref={content}
      inert={!present}
      aria-hidden={!present}
      className="view-content"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// Both panels contribute to the grid's height, so the controls below stay put.
// Inactive panels retain form state but are excluded from focus and accessibility.
export function TabPanel({ active, children, ...props }) {
  return (
    <motion.div
      {...props}
      hidden={!active}
      inert={!active}
      aria-hidden={!active}
      className={`tab-panel ${props.className || ""}`}
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 5 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}

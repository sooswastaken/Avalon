import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App.jsx";
import "./styles.css";
import "./compact.css";
const Wiki = lazy(() => import("./Wiki.jsx"));
createRoot(document.getElementById("root")).render(
  <Suspense fallback={<p>Loading…</p>}>
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {location.pathname === "/wiki.html" ? <Wiki /> : <App />}
    </MotionConfig>
  </Suspense>,
);

import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
const Wiki = lazy(() => import("./Wiki.jsx"));
createRoot(document.getElementById("root")).render(
  <Suspense fallback={<p>Loading…</p>}>
    {location.pathname === "/wiki.html" ? <Wiki /> : <App />}
  </Suspense>,
);

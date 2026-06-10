import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import { router } from "@/app/router";
import { queryClient } from "@/lib/query";
import { hydrateSession } from "@/auth/actions";
import { initRealtime } from "@/realtime/connection";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource-variable/fira-code/index.css";
import "./index.css";

// Refresh scopes/identity from /auth/me on load (no-op without a stored key),
// then wire the realtime socket to the auth lifecycle (connect on key, drop on logout).
void hydrateSession();
initRealtime();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>,
);

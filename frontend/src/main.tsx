import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PolycenasProvider } from "./provider";
import Page from "./page";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PolycenasProvider>
      <Page />
    </PolycenasProvider>
  </StrictMode>
);

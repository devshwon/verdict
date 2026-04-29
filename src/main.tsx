import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import config from "../granite.config.ts";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TDSMobileAITProvider brandPrimaryColor={config.brand.primaryColor}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </TDSMobileAITProvider>
  </StrictMode>,
);

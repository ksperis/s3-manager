/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "./router";
import "./index.css";
import { ThemeProvider } from "./components/theme";
import { GeneralSettingsProvider } from "./components/GeneralSettingsContext";
import { LanguageProvider } from "./components/language";
import { bootstrapBranding } from "./components/ui/brandingRuntime";
import { installConsoleRedaction } from "./utils/runtimeDiagnostics";
import { SessionProvider } from "./auth/SessionProvider";
import { PRODUCT_TITLE } from "./constants/product";

const root = document.getElementById("root");
document.title = PRODUCT_TITLE;
installConsoleRedaction();
void bootstrapBranding();

ReactDOM.createRoot(root as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <SessionProvider>
          <GeneralSettingsProvider>
            <AppRouter />
          </GeneralSettingsProvider>
        </SessionProvider>
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);

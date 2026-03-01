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

const root = document.getElementById("root");
void bootstrapBranding();

ReactDOM.createRoot(root as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <GeneralSettingsProvider>
          <AppRouter />
        </GeneralSettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);

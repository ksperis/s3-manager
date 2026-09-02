import type { ConsoleMessage, Page } from "@playwright/test";

function isBrowserResourceError(message: ConsoleMessage): boolean {
  return message.text().startsWith("Failed to load resource:");
}

export function collectApplicationErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !isBrowserResourceError(message)) {
      errors.push(message.text());
    }
  });
  return errors;
}

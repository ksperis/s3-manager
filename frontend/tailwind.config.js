const PRIMARY_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const primaryPalette = Object.fromEntries(
  PRIMARY_SHADES.map((shade) => [shade, `rgb(var(--ui-primary-${shade}-rgb) / <alpha-value>)`])
);
primaryPalette.DEFAULT = "rgb(var(--ui-primary-500-rgb) / <alpha-value>)";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: primaryPalette,
        sidebar: {
          DEFAULT: "#0b1727",
          dark: "#0f172a",
        },
        surface: {
          DEFAULT: "#f8fafc",
          muted: "#e2e8f0",
          dark: "#0b1220",
        },
      },
      boxShadow: {
        card: "0 10px 30px -10px rgba(15, 23, 42, 0.25)",
      },
    },
  },
  plugins: [],
};

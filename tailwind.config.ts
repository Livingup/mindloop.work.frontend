import type { Config } from "tailwindcss"

const config: Config = {
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
  },
  theme: {
    extend: {
      colors: {
        app: {
          bg: "rgb(var(--app-bg) / <alpha-value>)",
          shell: "rgb(var(--app-shell) / <alpha-value>)",
          rail: "rgb(var(--app-rail) / <alpha-value>)",
          surface: "rgb(var(--app-surface) / <alpha-value>)",
          "surface-muted": "rgb(var(--app-surface-muted) / <alpha-value>)",
          "surface-hover": "rgb(var(--app-surface-hover) / <alpha-value>)",
          selected: "rgb(var(--app-selected) / <alpha-value>)",
          "selected-strong": "rgb(var(--app-selected-strong) / <alpha-value>)",
          border: "rgb(var(--app-border) / <alpha-value>)",
          "border-strong": "rgb(var(--app-border-strong) / <alpha-value>)",
          primary: "rgb(var(--app-text-primary) / <alpha-value>)",
          secondary: "rgb(var(--app-text-secondary) / <alpha-value>)",
          muted: "rgb(var(--app-text-muted) / <alpha-value>)",
          subtle: "rgb(var(--app-text-subtle) / <alpha-value>)",
          accent: "rgb(var(--app-accent) / <alpha-value>)",
          "accent-hover": "rgb(var(--app-accent-hover) / <alpha-value>)",
          "accent-muted": "rgb(var(--app-accent-muted) / <alpha-value>)",
          overlay: "rgb(var(--app-overlay) / <alpha-value>)",
          danger: "rgb(var(--app-danger) / <alpha-value>)",
          "danger-hover": "rgb(var(--app-danger-hover) / <alpha-value>)",
          "danger-surface": "rgb(var(--app-danger-surface) / <alpha-value>)",
          "danger-border": "rgb(var(--app-danger-border) / <alpha-value>)",
          warning: "rgb(var(--app-warning) / <alpha-value>)",
          "warning-surface": "rgb(var(--app-warning-surface) / <alpha-value>)",
          "warning-border": "rgb(var(--app-warning-border) / <alpha-value>)",
          success: "rgb(var(--app-success) / <alpha-value>)",
          "success-surface": "rgb(var(--app-success-surface) / <alpha-value>)",
          "success-border": "rgb(var(--app-success-border) / <alpha-value>)",
        },
        "context-compression": {
          bg: "var(--context-compression-bg)",
          border: "var(--context-compression-border)",
          accent: "var(--context-compression-accent)",
        },
        "summary-panel": {
          "header-bg": "var(--summary-panel-header-bg)",
          "header-text": "var(--summary-panel-header-text)",
          "header-border": "var(--summary-panel-header-border)",
          "body-bg": "var(--summary-panel-body-bg)",
        },
        terminal: {
          bg: "#0d0f10",
          fg: "#e2e8f0",
        },
        surface: {
          950: "#070A12",
          900: "#0B1020",
          850: "#111827",
          800: "#172033",
          700: "#253149",
        },
      },
      boxShadow: {
        card: "0 14px 38px rgba(15,23,42,0.07)",
        "card-soft": "0 10px 28px rgba(15,23,42,0.04)",
        glow: "0 14px 38px rgba(15,23,42,0.07)",
      },
    },
  },
  plugins: [],
}

export default config

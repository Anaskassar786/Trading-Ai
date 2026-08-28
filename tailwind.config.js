/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx,js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0f17",
          panel: "#111827",
          card: "#151c2b",
          soft: "#1b2436",
          border: "#253049",
        },
        accent: {
          buy: "#10b981",
          sell: "#ef4444",
          wait: "#f59e0b",
          info: "#3b82f6",
          muted: "#64748b",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

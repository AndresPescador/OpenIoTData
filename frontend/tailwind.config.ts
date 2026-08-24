import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        graphite: "var(--graphite)",
        mineral: "var(--mineral)",
        cyan: "var(--cyan)",
        vermilion: "var(--vermilion)",
        line: "var(--line)",
      },
      fontFamily: {
        sans: ["Manrope Variable", "sans-serif"],
        mono: ["IBM Plex Mono Variable", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;

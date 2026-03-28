import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b1020", 900: "#121a2e", 700: "#2d3a55" },
        mint: { 500: "#34d399", 400: "#6ee7b7" },
        lilac: { 600: "#7c3aed", 500: "#8b5cf6" },
      },
    },
  },
  plugins: [],
};
export default config;

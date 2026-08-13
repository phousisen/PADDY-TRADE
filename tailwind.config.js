/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          950: "#0F2A1D", 900: "#123626", 800: "#16432F", 700: "#1B5238",
          600: "#217A4F", 500: "#2E9E63", 400: "#4FBE80", 100: "#E7F6EC", 50: "#F3FBF6",
        },
      },
      fontFamily: {
        khmer: ["Noto Sans Khmer", "sans-serif"],
        sans: ["Inter", "Noto Sans Khmer", "sans-serif"],
      },
    },
  },
  plugins: [],
};

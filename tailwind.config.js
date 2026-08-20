/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          950: "#0F2A1D", 900: "#123626", 800: "#16432F", 700: "#1B5238",
          600: "#217A4F", 500: "#2E9E63", 400: "#4FBE80", 300: "#93D9AE",
          200: "#C3EAD1", 100: "#E7F6EC", 50: "#F3FBF6",
        },
        // A single, sparingly-used warm accent (order numbers, active
        // badges, the "Owner" crown, etc.) — pairs with the green brand
        // color without competing with it, since gold and green never both
        // show up as the "main" color in the same spot.
        gold: {
          700: "#8C6A1D", 500: "#C7972C", 300: "#E0BE6C", 100: "#F5EAC9", 50: "#FBF6E9",
        },
        // A slightly warm off-white for the app's overall background,
        // instead of a cold gray — sits behind every page, all day, so a
        // warmer neutral is easier on the eyes than a flat slate gray.
        paper: "#F6F6F3",
      },
      fontFamily: {
        khmer: ["Noto Sans Khmer", "sans-serif"],
        sans: ["Inter", "Noto Sans Khmer", "sans-serif"],
      },
    },
  },
  plugins: [],
};

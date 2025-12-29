/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand red sampled from design swatch
        'brand-red': '#7f0000',
        'brand-red-dark': '#5f0000',
      },
    },
  },
  plugins: [],
}



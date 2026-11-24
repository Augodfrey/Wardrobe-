/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cobalt: { DEFAULT: '#0057A8', dark: '#003F7A', light: '#E6EFF8' },
        brandred: { DEFAULT: '#CC2229', dark: '#A31B21' },
      },
    },
  },
  plugins: [],
};

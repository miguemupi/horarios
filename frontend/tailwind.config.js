/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0F1FF', 100: '#E2E4FF', 200: '#C9CDFF', 300: '#A7AEFF',
          400: '#818CF8', 500: '#6673E8', 600: '#515CCB', 700: '#424AA4',
          800: '#373E83', 900: '#31386A', 950: '#1D203E',
        },
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica Neue', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 18px 55px -28px rgba(24,24,27,0.28)',
      },
    },
  },
  plugins: [],
};

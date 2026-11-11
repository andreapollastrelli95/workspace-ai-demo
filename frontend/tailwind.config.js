/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef2ff', 100: '#e0e7ff', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
        ink: { 950: '#0b1020', 900: '#111831', 800: '#1a2342', 700: '#26315a' },
      },
    },
  },
  plugins: [],
}

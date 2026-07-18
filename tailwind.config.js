/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Partei-Theme-Tokens, Werte kommen aus CSS-Variablen in src/index.css
        // ([data-theme=...]-Blöcke). RGB-Tripel-Syntax, damit Tailwind-Alpha
        // (z. B. bg-primary/10) funktioniert.
        primary: 'rgb(var(--mc-primary) / <alpha-value>)',
        'primary-hover': 'rgb(var(--mc-primary-hover) / <alpha-value>)',
        accent: 'rgb(var(--mc-accent) / <alpha-value>)',
        topbar: 'rgb(var(--mc-topbar) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './components/**/*.js',
    './assets/vh.js',
  ],
  theme: {
    extend: {
      colors: {
        bark: '#6B4423',
        barkdeep: '#4A2E17',
        sage: '#8A9A5B',
        sagedeep: '#6F7A45',
        gold: '#C9A24B',
        cream: '#F8F1E5',
        sand: '#E8D9C5',
        linen: '#FAF8F6',
        ink: '#1F1D1A',
        charcoal: '#0E0F0C',
        wa: '#25D366',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(31,29,26,.18)',
        lift: '0 24px 48px -16px rgba(31,29,26,.28)',
      },
    },
  },
  plugins: [],
};

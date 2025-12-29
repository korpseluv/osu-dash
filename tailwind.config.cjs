module.exports = {
  content: [
    './app/**/*.{vue,js,ts}',
    './components/**/*.{vue,js,ts}',
    './pages/**/*.{vue,js,ts}',
    './layouts/**/*.{vue,js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0ea5e9',
        accent: '#7c3aed',
        surface: '#0b1224',
      },
      dropShadow: {
        glow: '0 10px 35px rgba(14,165,233,0.35)',
        purple: '0 10px 35px rgba(124,58,237,0.28)'
      }
    }
  },
  plugins: [],
};

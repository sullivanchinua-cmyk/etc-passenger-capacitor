// Same theme the pages used with the Tailwind CDN (cdn.tailwindcss.com), now compiled offline.
module.exports = {
  content: ['./www/**/*.html', './www/**/*.js', '!./www/vendor/**'],
  theme: {
    extend: {
      colors: {
        soft: { 100: '#DCDDE0', 200: '#D2D3D6', 300: '#E3E4E6' },
        ink: '#111112',
        mute: '#8A8C90',
        navy: '#0B0F3A'
      }
    }
  }
};

export default {
  plugins: {
    // Tailwind v4 ships its PostCSS plugin separately and handles vendor
    // prefixing internally, so autoprefixer is no longer needed.
    '@tailwindcss/postcss': {},
  },
};

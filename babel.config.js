module.exports = {
  overrides: [
    {
      test: /\.mjs$/,
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    },
  ],
};

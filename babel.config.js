module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Path alias `@/` → ./src
      [
        'module-resolver',
        {
          root: ['./'],
          alias: { '@': './src' },
        },
      ],
      // react-native-reanimated v4 requires the worklets plugin LAST.
      'react-native-worklets/plugin',
    ],
  };
};

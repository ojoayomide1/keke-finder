const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// react-native-svg web support:
// On web builds, resolve to the TypeScript web entry which Metro compiles.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-native-svg" && platform === "web") {
    return context.resolveRequest(
      context,
      "react-native-svg/src/ReactNativeSVG.web",
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

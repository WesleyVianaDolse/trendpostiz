// These DOM tests do not draw on canvas. jsdom's optional canvas dependency is
// installed in this workspace but its native binary is unavailable on Windows.
try {
  const canvasPath = require.resolve('canvas');
  require.cache[canvasPath] = {
    id: canvasPath,
    filename: canvasPath,
    loaded: true,
    exports: {},
  };
} catch {
  // jsdom already supports canvas being absent.
}
module.exports = require('jest-environment-jsdom').default;

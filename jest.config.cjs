const { compilerOptions } = require('./tsconfig.json');
const { pathsToModuleNameMapper } = require('ts-jest');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest'],
  },
  // !IMPORTANT This resolver https://github.com/faker-js/faker/issues/3606#issuecomment-3233612736
  // El negativematch cubre ambos layouts: npm (node_modules/@faker-js/faker)
  // y pnpm (node_modules/.pnpm/@faker-js+faker@x/node_modules/@faker-js/faker).
  transformIgnorePatterns: [
    '/node_modules/(?!.*@faker-js[/+](faker|faker@))',
    '\\.pnp\\.[^\\/]+$',
  ],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // DB-backed suites share the single MySQL `_test` database
  // (dropSchema + synchronize), so they must not run concurrently.
  maxWorkers: 1,

  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    ...pathsToModuleNameMapper(compilerOptions.paths, {
      prefix: '<rootDir>/',
    }),
  },
};

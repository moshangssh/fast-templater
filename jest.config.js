module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'main.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/obsidian.mock.ts',
    '^@core$': '<rootDir>/src/core',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@engine$': '<rootDir>/src/engine',
    '^@engine/(.*)$': '<rootDir>/src/engine/$1',
    '^@presets$': '<rootDir>/src/presets',
    '^@presets/(.*)$': '<rootDir>/src/presets/$1',
    '^@settings$': '<rootDir>/src/settings',
    '^@settings/(.*)$': '<rootDir>/src/settings/$1',
    '^@templates$': '<rootDir>/src/templates',
    '^@templates/(.*)$': '<rootDir>/src/templates/$1',
    '^@types$': '<rootDir>/src/types',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@ui$': '<rootDir>/src/ui',
    '^@ui/(.*)$': '<rootDir>/src/ui/$1',
    '^@utils$': '<rootDir>/src/utils',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1'
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        target: 'es6',
        module: 'commonjs',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        skipLibCheck: true
      }
    }
  }
};

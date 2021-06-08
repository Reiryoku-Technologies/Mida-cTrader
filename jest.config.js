module.exports = {
    testEnvironment: "node",
    coverageProvider: "v8",
    roots: [ "./build/tests/", ],
    testMatch: [ "**/?(*.)+(spec|test).+(ts|tsx|js)", ],
    clearMocks: true,
};

module.exports = {
    root: true,
    parserOptions: {
        project: "tsconfig.json",
    },
    parser: "@typescript-eslint/parser",
    plugins: [ "@typescript-eslint", ],
    extends: [ "@reiryoku/eslint-config-reiryoku", ],
    rules: {
        "function-paren-newline": "off",
        "no-extra-parens": "off",
        "@typescript-eslint/no-extra-parens": "off",
    },
};

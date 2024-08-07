const globals = require('globals');

module.exports = [
  {
    rules: {
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'prefer-destructuring': [
        'error',
        {
          VariableDeclarator: {
            array: true,
            object: true
          },
          AssignmentExpression: {
            array: true,
            object: true
          }
        },
        {
          enforceForRenamedProperties: false
        }
      ],
      'prefer-const': 'error',
      'brace-style': [
        'error',
        '1tbs',
        {
          allowSingleLine: true
        }
      ],
      'no-console': 'off',
      'comma-spacing': [
        'error',
        {
          before: false,
          after: true
        }
      ],
      'semi-spacing': [
        'error',
        {
          before: false,
          after: true
        }
      ],
      'block-spacing': 'error',
      'eol-last': 'error',
      'arrow-spacing': 'error',
      'no-tabs': 'error',
      'no-trailing-spaces': [
        'error',
        {
          skipBlankLines: true,
          ignoreComments: true
        }
      ],
      'no-whitespace-before-property': 'error',
      'object-curly-spacing': ['error', 'always'],
      'rest-spread-spacing': ['error', 'never'],
      'space-infix-ops': 'error',
      'space-unary-ops': [
        'error',
        {
          words: true,
          nonwords: false
        }
      ],
      'switch-colon-spacing': [
        'error',
        {
          after: true,
          before: false
        }
      ],
      'template-curly-spacing': ['error', 'never'],
      'template-tag-spacing': ['error', 'always'],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_$',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_$'
        }
      ]
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020
      },
      globals: {
        logger: true,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
        commonjs: true,
        ...globals.es6,
        ...globals.node,
        ...globals.amd,
        ...globals.mocha,
        ...globals.browser
      },
      parserOptions: {
        ecmaVersion: 2020
      }
    }
  }
];

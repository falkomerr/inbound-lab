# Contributing to FasterTest

Thank you for your interest in contributing to the FasterTest! This document provides guidelines and
instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## 🤝 Code of Conduct

Please read and follow our [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

We are committed to a welcoming, respectful community. Unacceptable behavior (harassment, insults,
publishing private information, etc.) may result in moderation actions by maintainers.

---

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- Node.js (v18.0.0 or higher; v20 LTS recommended — see `.nvmrc`)
- npm (v8.0.0 or higher)
- k6 (v1.7.1 or higher)
- Docker (optional — for MySQL via `docker compose up -d mysql`)
- Git
- A code editor (VS Code recommended)

### Understanding the Project

1. Read the [README.md](./README.md) to understand the project
2. Review the [Architecture](#architecture) section below
3. Check existing [issues](../../issues) and [pull requests](../../pulls)
4. Familiarize yourself with k6 documentation: https://k6.io/docs/

---

## 💻 Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/alirezaedalat/fastertest.git
cd fastertest
```

### 2. Install & configure

```bash
npm ci
cp env.example .env
# Set JWT_SECRET in .env — generate with:
# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
docker compose up -d mysql   # optional but recommended
npm run install:k6
```

For a quick JSON-file backend during unit work, omit `MYSQL_*` or set `STORAGE_BACKEND=json`.

### 3. Verify Setup

```bash
npm run validate:config
npm run lint
npm test
```

---

## 🔨 Making Changes

### Branch Naming Convention

Create a descriptive branch name:

```bash
git checkout -b feature/add-new-test-scenario
git checkout -b fix/auth-token-validation
git checkout -b docs/update-api-documentation
git checkout -b refactor/improve-metrics-collection
```

**Branch Prefixes:**

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests
- `chore/` - Maintenance tasks

### Commit Message Convention

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```bash
<type>(<scope>): <subject>

<body>

<footer>
```

**Examples:**

```bash
feat(scenarios): add volume test scenario

Add a new volume test scenario to test high data throughput.
Includes configuration, thresholds, and documentation.

Closes #123
```

```bash
fix(auth): remove hardcoded OTP value

Replace hardcoded OTP with environment variable requirement
for better security practices.

BREAKING CHANGE: TEST_OTP environment variable is now required
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

---

## 🧪 Testing

### Running Tests

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
node --test tests/unit/constants.test.js
```

### Writing Tests

When adding new functionality, always include tests:

**1. Unit Tests**

Create test files in `tests/unit/`:

```javascript
// tests/unit/myFeature.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { myFunction } from '../../utils/myFeature.js';

describe('MyFeature', () => {
  it('should do something correctly', () => {
    const result = myFunction(input);
    assert.strictEqual(result, expected);
  });
});
```

**2. Integration Tests**

For k6 tests, create test scenarios in `tests/scenarios/`:

```javascript
// tests/scenarios/my-test.js
import { check } from 'k6';
import { config } from '../../config/config.js';

export const options = {
  vus: 10,
  duration: '30s',
};

export default function () {
  // Test implementation
}
```

### Test Coverage Requirements

- Unit tests should cover at least 80% of new code
- All public APIs must have tests
- Critical paths must have integration tests

---

## 🎨 Code Style

### JavaScript/Node.js Style

We use ESLint and Prettier for consistent code style:

```bash
# Check linting
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Check formatting
npm run format:check

# Format code
npm run format
```

### Style Guidelines

**1. Use ES6+ Features**

```javascript
// Good
const items = data.map((item) => item.value);
const { name, age } = user;

// Avoid
var items = data.map(function (item) {
  return item.value;
});
```

**2. Use Descriptive Names**

```javascript
// Good
const isUserAuthenticated = checkAuth(token);
const calculateAverageResponseTime = (responses) => {...};

// Avoid
const flag = checkAuth(token);
const calc = (r) => {...};
```

**3. Add JSDoc Comments**

```javascript
/**
 * Calculate average response time from array of responses
 * @param {Array<Object>} responses - Array of response objects
 * @returns {number} Average response time in milliseconds
 */
export function calculateAverageResponseTime(responses) {
  // Implementation
}
```

**4. Keep Functions Small**

- Maximum 50 lines per function
- Single responsibility principle
- Extract complex logic into separate functions

**5. Use Constants**

```javascript
// Good - Use constants from constants.js
import { PERFORMANCE_THRESHOLDS } from './constants.js';

if (duration > PERFORMANCE_THRESHOLDS.SLOW_REQUEST_MS) {
  // Handle slow request
}

// Avoid - Magic numbers
if (duration > 5000) {
  // Handle slow request
}
```

**6. Error Handling**

```javascript
// Good - Descriptive error messages
if (!token) {
  console.error('❌ Authentication token is required');
  console.error('💡 Set TEST_OTP in your environment configuration');
  return null;
}

// Avoid - Silent failures
if (!token) {
  return null;
}
```

---

## 📤 Submitting Changes

### Before Submitting

**Checklist:**

- [ ] Code follows style guidelines
- [ ] All tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is properly formatted (`npm run format`)
- [ ] Documentation is updated
- [ ] Commit messages follow convention
- [ ] Branch is up to date with main

### Creating a Pull Request

1. **Push your branch**

```bash
git push origin feature/your-feature-name
```

2. **Create Pull Request**
   - Go to the repository on GitLab/GitHub
   - Click "New Pull Request" or "Create Merge Request"
   - Select your branch
   - Fill in the PR template

3. **PR Template**

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated
- [ ] Manual testing completed
- [ ] All tests pass

## Checklist

- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No breaking changes (or documented)

## Related Issues

Closes #123
```

### Review Process

1. **Automated Checks**
   - Tests must pass
   - Linting must pass
   - No merge conflicts

2. **Code Review**
   - At least one approval required
   - Address all feedback
   - Make requested changes

3. **Merge**
   - Squash commits if needed
   - Update branch if behind main
   - Maintainer will merge

---

## 🐛 Reporting Bugs

### Before Reporting

1. Check existing issues
2. Verify bug in latest version
3. Test with minimal configuration
4. Gather relevant information

### Bug Report Template

```markdown
**Describe the bug** Clear and concise description of the bug

**To Reproduce** Steps to reproduce:

1. Run command '...'
2. Configure with '...'
3. See error

**Expected behavior** What you expected to happen

**Actual behavior** What actually happened

**Screenshots/Logs** If applicable, add screenshots or log output

**Environment:**

- OS: [e.g., macOS 14.0]
- Node version: [e.g., 18.16.0]
- k6 version: [e.g., 1.7.1]
- Framework version: [e.g., 1.0.0]

**Additional context** Any other relevant information
```

---

## ✨ Requesting Features

### Feature Request Template

```markdown
**Is your feature request related to a problem?** Description of the problem

**Describe the solution you'd like** Clear description of desired solution

**Describe alternatives you've considered** Other approaches you've thought about

**Additional context** Any other relevant information, mockups, examples, etc.

**Would you like to implement this feature?**

- [ ] Yes, I can implement this
- [ ] No, I'm just suggesting
```

---

## 📖 Architecture

### Project Structure

```
load-test/
├── config/              # Configuration files
│   ├── config.js        # Main configuration
│   └── thresholds.js    # Performance thresholds
├── utils/               # Utility modules
│   ├── constants.js     # Constants and limits
│   ├── requestBuilder.js # Request builder
│   ├── authHelper.js    # Authentication
│   ├── metrics.js       # Metrics tracking
│   ├── responseValidator.js # Validation
│   └── ...             # Other utilities
├── tests/
│   ├── scenarios/       # k6 test scenarios
│   └── unit/           # Unit tests
├── server/             # UI Panel server
│   ├── middleware/     # Express middleware
│   ├── routes/         # API routes
│   └── testManager.js  # Test execution manager
├── scripts/            # Utility scripts
├── docs/               # Documentation
└── public/             # UI Panel frontend
```

### Key Concepts

**1. Request Builder Pattern**

- Fluent interface for building requests
- Retry logic with exponential backoff
- Rate limiting support

**2. Test Scenarios**

- Each scenario is a separate file
- Follows k6 test structure
- Uses shared utilities

**3. Metrics Collection**

- Custom metrics for tracking
- Real-time updates via WebSocket
- Aggregation and analysis

**4. UI Panel**

- Express.js server
- WebSocket for real-time updates
- REST API for control

---

## 💡 Tips for Contributors

1. **Start Small**: Begin with documentation or minor bug fixes
2. **Ask Questions**: Open an issue if you need clarification
3. **Be Patient**: Reviews may take time
4. **Stay Updated**: Pull main branch regularly
5. **Test Thoroughly**: Test your changes in different scenarios
6. **Document**: Update docs for any user-facing changes

---

## 📞 Getting Help

- **Documentation**: Check [README.md](./README.md) and [docs/](./docs/)
- **Issues**: Search existing issues or create new one
- **Discussion**: Use issue comments for questions
- **Email**: Contact the maintainers

---

## 🎉 Recognition

Contributors will be:

- Listed in release notes
- Mentioned in documentation
- Added to contributors list (if major contribution)

Thank you for contributing! 🚀

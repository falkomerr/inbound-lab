#!/usr/bin/env node

/**
 * Alternative environment setup script
 * Creates environment files with interactive prompts
 * @module create-env-files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

/**
 * Create readline interface for user input
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Prompt user for input
 * @param {string} question - Question to ask
 * @returns {Promise<string>} User input
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Create environment file
 * @param {string} envName - Environment name
 * @param {Object} config - Configuration values
 */
function createEnvFile(envName, config) {
  const envPath = path.join(projectRoot, `.env.${envName}`);

  const envContent = `# ${envName.toUpperCase()} Environment Configuration
# Generated automatically - Update with your values

# Environment
ENV=${config.ENV || envName}

# API Configuration
BASE_URL=${config.BASE_URL || ''}
API_TIMEOUT=${config.API_TIMEOUT || '30000'}
MAX_REDIRECTS=${config.MAX_REDIRECTS || '10'}

# Test User Configuration
TEST_USER_PHONE=${config.TEST_USER_PHONE || '15550000001'}
TEST_USER_EMAIL=${config.TEST_USER_EMAIL || 'loadtest@example.com'}
TEST_OTP=${config.TEST_OTP || '12345'}

# Load Test Configuration
VUS=${config.VUS || '10'}
DURATION=${config.DURATION || '30s'}
RAMP_UP_TIME=${config.RAMP_UP_TIME || '10s'}
RAMP_DOWN_TIME=${config.RAMP_DOWN_TIME || '10s'}

# Retry Configuration
RETRY_ATTEMPTS=${config.RETRY_ATTEMPTS || '3'}
RETRY_DELAY=${config.RETRY_DELAY || '1000'}

# Think Time Configuration (milliseconds)
MIN_THINK_TIME=${config.MIN_THINK_TIME || '1000'}
MAX_THINK_TIME=${config.MAX_THINK_TIME || '3000'}

# Rate Limiting
RATE_LIMIT_ENABLED=${config.RATE_LIMIT_ENABLED || 'false'}
RATE_LIMIT_RPS=${config.RATE_LIMIT_RPS || '100'}

# Reporting
REPORT_FORMAT=${config.REPORT_FORMAT || 'json'}
REPORT_PATH=${config.REPORT_PATH || 'reports/'}

# Performance Monitoring
ENABLE_METRICS=${config.ENABLE_METRICS || 'true'}
METRICS_INTERVAL=${config.METRICS_INTERVAL || '1000'}

# Security
ENABLE_SSL_VERIFY=${config.ENABLE_SSL_VERIFY || 'true'}
TLS_VERSION=${config.TLS_VERSION || '1.2'}

# Test Type
TEST_TYPE=${config.TEST_TYPE || 'load'}
`;

  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Created .env.${envName} file`);
}

/**
 * Get default configuration for environment
 * @param {string} envName - Environment name
 * @returns {Object} Default configuration
 */
function getDefaultConfig(envName) {
  const defaults = {
    staging: {
      ENV: 'staging',
      BASE_URL: 'https://httpbin.org',
      API_TIMEOUT: '30000',
      VUS: '10',
      DURATION: '5m',
      RAMP_UP_TIME: '1m',
      RAMP_DOWN_TIME: '1m',
    },
    production: {
      ENV: 'production',
      BASE_URL: 'https://httpbin.org',
      API_TIMEOUT: '60000',
      VUS: '20',
      DURATION: '10m',
      RAMP_UP_TIME: '2m',
      RAMP_DOWN_TIME: '2m',
      RETRY_ATTEMPTS: '5',
      RETRY_DELAY: '2000',
    },
    development: {
      ENV: 'development',
      BASE_URL: 'http://localhost:8000/api/v1',
      API_TIMEOUT: '10000',
      VUS: '2',
      DURATION: '1m',
      RAMP_UP_TIME: '5s',
      RAMP_DOWN_TIME: '5s',
    },
  };

  return defaults[envName] || {};
}

/** Interactive prompts for one environment (sequential CLI). */
async function promptForEnvConfig(env) {
  console.log(`\n📝 Creating .env.${env}...`);

  const defaultConfig = getDefaultConfig(env);
  const customize = await prompt(`Use defaults for ${env}? (y/n): `);
  const config = { ...defaultConfig };

  if (customize.toLowerCase() === 'n') {
    const baseUrl = await prompt(`Base URL [${defaultConfig.BASE_URL || ''}]: `);
    if (baseUrl) {
      config.BASE_URL = baseUrl;
    }

    const vus = await prompt(`Virtual Users [${defaultConfig.VUS || '10'}]: `);
    if (vus) {
      config.VUS = vus;
    }

    const duration = await prompt(`Test Duration [${defaultConfig.DURATION || '30s'}]: `);
    if (duration) {
      config.DURATION = duration;
    }
  }

  return config;
}

/** Process environments one at a time without await-in-loop. */
async function createEnvironmentsSequentially(envs) {
  if (envs.length === 0) {
    return;
  }
  const [first, ...rest] = envs;
  const config = await promptForEnvConfig(first);
  createEnvFile(first, config);
  await createEnvironmentsSequentially(rest);
}

/**
 * Interactive environment setup
 */
async function interactiveSetup() {
  try {
    console.log('🔧 Interactive Environment Setup for Load Test\n');
    console.log('This script will help you create environment configuration files.\n');

    // Ask which environments to create
    console.log('Which environments would you like to create?');
    console.log('1. All (staging, production, development)');
    console.log('2. Staging only');
    console.log('3. Production only');
    console.log('4. Development only');
    console.log('5. Custom selection');

    const choice = await prompt('\nEnter your choice (1-5): ');

    const environments = [];
    if (choice === '1') {
      environments.push('staging', 'production', 'development');
    } else if (choice === '2') {
      environments.push('staging');
    } else if (choice === '3') {
      environments.push('production');
    } else if (choice === '4') {
      environments.push('development');
    } else if (choice === '5') {
      const staging = await prompt('Create staging? (y/n): ');
      if (staging.toLowerCase() === 'y') {
        environments.push('staging');
      }

      const production = await prompt('Create production? (y/n): ');
      if (production.toLowerCase() === 'y') {
        environments.push('production');
      }

      const development = await prompt('Create development? (y/n): ');
      if (development.toLowerCase() === 'y') {
        environments.push('development');
      }
    } else {
      console.log('Invalid choice. Creating all environments by default.');
      environments.push('staging', 'production', 'development');
    }

    await createEnvironmentsSequentially(environments);

    // Create base .env file
    const createBase = await prompt('\nCreate base .env file? (y/n): ');
    if (createBase.toLowerCase() === 'y') {
      const envExamplePath = path.join(projectRoot, 'env.example');
      if (fs.existsSync(envExamplePath)) {
        const envPath = path.join(projectRoot, '.env');
        if (!fs.existsSync(envPath)) {
          fs.copyFileSync(envExamplePath, envPath);
          console.log('✅ Created .env file from env.example');
        } else {
          console.log('⏭️  .env file already exists, skipping');
        }
      }
    }

    // Create directories
    console.log('\n📁 Creating necessary directories...');
    const directories = ['reports', 'reports/html-report', 'logs', 'test-results'];

    for (const dir of directories) {
      const dirPath = path.join(projectRoot, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      }
    }

    console.log('\n✅ Environment setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Review and update the created .env files');
    console.log('   2. Add sensitive values (API keys, tokens, etc.)');
    console.log('   3. Run tests: npm run test:smoke');
  } catch (error) {
    console.error('❌ Error during setup:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  interactiveSetup();
}

export { createEnvFile, getDefaultConfig };

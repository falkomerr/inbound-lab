#!/usr/bin/env node

/**
 * Cross-platform environment setup script for Load Test
 * Creates .env, .env.staging, .env.production, and .env.development files from env.example
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

async function setupEnvironment() {
  try {
    console.log('🔧 Setting up load test environment configuration...');

    const envExamplePath = path.join(projectRoot, 'env.example');

    // Check if env.example exists
    if (!fs.existsSync(envExamplePath)) {
      console.error('❌ env.example file not found');
      process.exit(1);
    }

    // Read the example file
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

    // Define environment files to create
    const envFiles = [
      { name: '.env', path: path.join(projectRoot, '.env') },
      { name: '.env.staging', path: path.join(projectRoot, '.env.staging') },
      { name: '.env.production', path: path.join(projectRoot, '.env.production') },
    ];

    // Create .env (base file)
    if (!fs.existsSync(envFiles[0].path)) {
      fs.copyFileSync(envExamplePath, envFiles[0].path);
      console.log(`✅ Created ${envFiles[0].name} file from env.example`);
    } else {
      console.log(`⏭️  ${envFiles[0].name} file already exists, skipping`);
    }

    // Create .env.production (for production)
    if (!fs.existsSync(envFiles[2].path)) {
      const productionContent = envExampleContent
        .replace(/ENV=staging/, 'ENV=production')
        .replace(/# BASE_URL=https:\/\/httpbin\.org/, 'BASE_URL=https://httpbin.org')
        .replace(/API_TIMEOUT=30000/, 'API_TIMEOUT=60000')
        .replace(/VUS=10/, 'VUS=20')
        .replace(/DURATION=30s/, 'DURATION=10m')
        .replace(/RAMP_UP_TIME=10s/, 'RAMP_UP_TIME=2m')
        .replace(/RAMP_DOWN_TIME=10s/, 'RAMP_DOWN_TIME=2m')
        .replace(/RETRY_ATTEMPTS=3/, 'RETRY_ATTEMPTS=5')
        .replace(/RETRY_DELAY=1000/, 'RETRY_DELAY=2000')
        .replace(/MIN_THINK_TIME=1000/, 'MIN_THINK_TIME=2000')
        .replace(/MAX_THINK_TIME=3000/, 'MAX_THINK_TIME=5000')
        .replace(/RATE_LIMIT_RPS=100/, 'RATE_LIMIT_RPS=200')
        .replace(/ENABLE_METRICS=true/, 'ENABLE_METRICS=true')
        .replace(/LOG_LEVEL=info/, 'LOG_LEVEL=warn')
        .replace(/TEST_TYPE=load/, 'TEST_TYPE=load');
      fs.writeFileSync(envFiles[2].path, productionContent);
      console.log(`✅ Created ${envFiles[2].name} file`);
    } else {
      console.log(`⏭️  ${envFiles[2].name} file already exists, skipping`);
    }

    // Create .env.staging (for staging)
    if (!fs.existsSync(envFiles[1].path)) {
      const stagingContent = envExampleContent
        .replace(/ENV=staging/, 'ENV=staging')
        .replace(/# BASE_URL=https:\/\/httpbin\.org/, 'BASE_URL=https://httpbin.org')
        .replace(/API_TIMEOUT=30000/, 'API_TIMEOUT=30000')
        .replace(/VUS=10/, 'VUS=10')
        .replace(/DURATION=30s/, 'DURATION=5m')
        .replace(/RAMP_UP_TIME=10s/, 'RAMP_UP_TIME=1m')
        .replace(/RAMP_DOWN_TIME=10s/, 'RAMP_DOWN_TIME=1m')
        .replace(/RETRY_ATTEMPTS=3/, 'RETRY_ATTEMPTS=3')
        .replace(/RETRY_DELAY=1000/, 'RETRY_DELAY=1000')
        .replace(/MIN_THINK_TIME=1000/, 'MIN_THINK_TIME=1000')
        .replace(/MAX_THINK_TIME=3000/, 'MAX_THINK_TIME=3000')
        .replace(/RATE_LIMIT_RPS=100/, 'RATE_LIMIT_RPS=100')
        .replace(/ENABLE_METRICS=true/, 'ENABLE_METRICS=true')
        .replace(/LOG_LEVEL=info/, 'LOG_LEVEL=info')
        .replace(/TEST_TYPE=load/, 'TEST_TYPE=load');
      fs.writeFileSync(envFiles[1].path, stagingContent);
      console.log(`✅ Created ${envFiles[1].name} file`);
    } else {
      console.log(`⏭️  ${envFiles[1].name} file already exists, skipping`);
    }

    // Create necessary directories
    const directories = ['reports', 'reports/html-report', 'logs', 'test-results'];

    for (const dir of directories) {
      const dirPath = path.join(projectRoot, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } else {
        console.log(`⏭️  Directory already exists: ${dir}`);
      }
    }

    console.log('\n✅ Environment setup completed successfully!');
    console.log('\n📝 Environment files created:');
    console.log('   • .env - Base configuration');
    console.log('   • .env.staging - Staging environment');
    console.log('   • .env.production - Production environment');
    console.log('\n🔧 Next steps:');
    console.log('   1. Update .env with your base configuration');
    console.log('   2. Update .env.staging with your staging settings');
    console.log('   3. Update .env.production with your production configuration');
    console.log('   5. Add .env* files to .gitignore (except .env.example)');
    console.log('\n🚀 Run tests:');
    console.log('   • npm run test:smoke - Quick smoke test');
    console.log('   • npm run test:load - Load test');
    console.log('   • npm run test:stress - Stress test');
    console.log('   • npm run test:staging - Run on staging');
    console.log('   • npm run test:production - Run on production (use with caution!)');
  } catch (error) {
    console.error('❌ Error setting up environment:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

setupEnvironment();

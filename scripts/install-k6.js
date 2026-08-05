#!/usr/bin/env node

/**
 * Cross-platform k6 installer and project setup script.
 * Auto-detects the current OS and runs the appropriate install commands.
 * Allows the user to override the detected OS interactively.
 */

import { execSync } from 'child_process';
import readline from 'readline';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

const log = {
  info: (msg) => console.log(`${CYAN}ℹ${RESET}  ${msg}`),
  success: (msg) => console.log(`${GREEN}✔${RESET}  ${msg}`),
  warn: (msg) => console.log(`${YELLOW}⚠${RESET}  ${msg}`),
  error: (msg) => console.error(`${RED}✖${RESET}  ${msg}`),
  step: (msg) => console.log(`\n${BOLD}${CYAN}▶ ${msg}${RESET}`),
  cmd: (msg) => console.log(`  ${DIM}$ ${msg}${RESET}`),
};

function detectOS() {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return null;
  }
}

function run(cmd, options = {}) {
  log.cmd(cmd);
  try {
    execSync(cmd, { stdio: 'inherit', ...options });
  } catch (err) {
    if (options.optional) {
      log.warn(`Command failed (continuing): ${cmd}`);
    } else {
      log.error(`Command failed: ${cmd}`);
      throw err;
    }
  }
}

function isCommandAvailable(cmd) {
  try {
    execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${cmd}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function selectOS(detected) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const osLabel = {
    macos: 'macOS  (Homebrew)',
    linux: 'Linux  (apt-get)',
    windows: 'Windows (Chocolatey / winget)',
  };

  console.log(`\n${BOLD}Select your operating system:${RESET}`);
  console.log(
    `  ${CYAN}1${RESET}  ${osLabel.macos}${detected === 'macos' ? `  ${DIM}← detected${RESET}` : ''}`
  );
  console.log(
    `  ${CYAN}2${RESET}  ${osLabel.linux}${detected === 'linux' ? `  ${DIM}← detected${RESET}` : ''}`
  );
  console.log(
    `  ${CYAN}3${RESET}  ${osLabel.windows}${detected === 'windows' ? `  ${DIM}← detected${RESET}` : ''}`
  );

  const defaultChoice =
    detected === 'macos' ? '1' : detected === 'linux' ? '2' : detected === 'windows' ? '3' : '';
  const hint = defaultChoice ? ` (press Enter for ${defaultChoice})` : '';

  const answer = await prompt(rl, `\nEnter choice [1/2/3]${hint}: `);
  rl.close();

  const choice = answer.trim() || defaultChoice;
  if (choice === '1') {
    return 'macos';
  }
  if (choice === '2') {
    return 'linux';
  }
  if (choice === '3') {
    return 'windows';
  }

  log.error('Invalid choice. Please run the script again.');
  process.exit(1);
}

function installK6macOS() {
  log.step('Installing k6 on macOS via Homebrew');

  if (!isCommandAvailable('brew')) {
    log.warn('Homebrew not found. Installing Homebrew first...');
    run(
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    );
  } else {
    log.info('Homebrew detected.');
  }

  run('brew install k6');
}

function installK6Linux() {
  log.step('Installing k6 on Linux via apt-get');

  const cmds = [
    'sudo gpg -k',
    'sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D9B',
    'echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list',
    'sudo apt-get update',
    'sudo apt-get install -y k6',
  ];

  for (const cmd of cmds) {
    run(cmd);
  }
}

function installK6Windows() {
  log.step('Installing k6 on Windows');

  if (isCommandAvailable('choco')) {
    log.info('Chocolatey detected — using choco.');
    run('choco install k6 -y');
  } else if (isCommandAvailable('winget')) {
    log.info('winget detected — using winget.');
    run('winget install k6 --k6.io.k6');
  } else {
    log.warn('Neither Chocolatey nor winget found.');
    log.info('Install Chocolatey: https://chocolatey.org/install');
    log.info('Or download k6 directly: https://dl.k6.io/msi/k6-latest-amd64.msi');
    process.exit(1);
  }
}

function verifyK6() {
  log.step('Verifying k6 installation');
  try {
    const version = execSync('k6 version', { encoding: 'utf8' }).trim();
    log.success(`k6 installed: ${version}`);
    return true;
  } catch {
    log.error('k6 not found in PATH after installation.');
    log.info('You may need to restart your terminal or add k6 to your PATH.');
    return false;
  }
}

function installNodeDependencies() {
  log.step('Installing project npm dependencies');
  run('npm install');
  log.success('npm dependencies installed.');
}

function validateConfig() {
  log.step('Validating project configuration');
  run('npm run validate:config', { optional: true });
}

function setupEnv() {
  log.step('Setting up environment files (npm run setup:env)');
  run('npm run setup:env');
  log.success('Environment files created.');
}

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   k6 + Project Setup Installer           ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`);

  const detected = detectOS();
  if (detected) {
    log.info(`Detected OS: ${BOLD}${detected}${RESET}`);
  } else {
    log.warn('Could not auto-detect OS.');
  }

  const os = await selectOS(detected);
  log.info(`Installing for: ${BOLD}${os}${RESET}\n`);

  try {
    if (os === 'macos') {
      installK6macOS();
    } else if (os === 'linux') {
      installK6Linux();
    } else if (os === 'windows') {
      installK6Windows();
    }

    verifyK6();
    installNodeDependencies();
    validateConfig();
    setupEnv();

    console.log(`\n${BOLD}${GREEN}✅  Setup complete! You're ready to run load tests.${RESET}`);
    console.log(
      `${DIM}   Run \`npm run ui\` to open the dashboard, or \`npm run test:smoke\` to start testing.${RESET}\n`
    );
  } catch (err) {
    log.error(`Setup failed: ${err.message}`);
    process.exit(1);
  }
}

main();

import { readFileSync } from 'node:fs';

const secret = (name) => readFileSync(`/run/secrets/${name}`, 'utf8').trim();
process.env.JWT_SECRET = secret('jwt_secret');
process.env.MYSQL_PASSWORD = secret('mysql_password');
process.env.VPN_KEY = secret('vpn_key');
const adminPassword = secret('admin_password');

try {
  if (process.argv[2] === 'orchestrator') {
    await import('./orchestrator.js');
  } else {
    if (process.getuid?.() === 0) {
      process.setgid(10001);
      process.setuid(10001);
    }
    const { initStorage } = await import('../db/index.js');
    const { getAllUsers, createUser } = await import('../userStore.js');
    await initStorage();
    if (!(await getAllUsers()).length) {
      await createUser(
        process.env.ADMIN_USERNAME || 'admin',
        adminPassword,
        'admin',
        '',
        { teams: [], modes: [] },
        { enabled: false, maxVus: 10000, maxDurationMinutes: 1440 }
      );
    }
    await import('../index.js');
  }
} catch {
  console.error('Не удалось запустить сервис. Проверьте доступность MySQL и файлы секретов.');
  process.exitCode = 1;
}

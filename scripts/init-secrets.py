import base64
import getpass
import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'secrets'
root.mkdir(mode=0o700, exist_ok=True)
values = {
    'mysql_password': secrets.token_urlsafe(32),
    'mysql_root_password': secrets.token_urlsafe(32),
    'jwt_secret': secrets.token_urlsafe(48),
    'vpn_key': base64.b64encode(secrets.token_bytes(32)).decode(),
    'subscription_device_id': 'InboundLab-' + secrets.token_hex(16),
}
if not (root / 'admin_password').exists():
    password = getpass.getpass('Пароль администратора (не менее 12 символов): ')
    if len(password) < 12 or not any(c.isupper() for c in password) or not any(c.isdigit() for c in password) or password.isalnum():
        raise SystemExit('Нужны минимум 12 символов, заглавная буква, цифра и специальный символ')
    values['admin_password'] = password
for name, value in values.items():
    path = root / name
    if path.exists():
        continue
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(descriptor, 'w') as file:
        file.write(value + '\n')
print('Секреты подготовлены. Существующие файлы сохранены.')

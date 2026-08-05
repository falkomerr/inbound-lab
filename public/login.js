// If already logged in, redirect to main app
const token = localStorage.getItem('authToken');
if (token) {
  fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .then((d) => {
      if (d.success) {
        location.replace('/');
      }
    })
    .catch(() => {});
}

// Password toggle
const pwToggle = document.getElementById('pwToggle');
const pwInput = document.getElementById('password');
const eyeIcon = document.getElementById('eyeIcon');

pwToggle.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  eyeIcon.innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// Forgot password panel
const forgotBtn = document.getElementById('forgotBtn');
const contactPanel = document.getElementById('contactPanel');
const contactClose = document.getElementById('contactClose');
forgotBtn.addEventListener('click', () => contactPanel.classList.toggle('show'));
contactClose.addEventListener('click', () => contactPanel.classList.remove('show'));

// Form submit
const form = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const submitBtn = document.getElementById('submitBtn');

function setLoading(on) {
  submitBtn.disabled = on;
  document.getElementById('btnContent').innerHTML = on
    ? '<div class="spinner"></div>'
    : 'Sign in <svg class="btn-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
}

function showError(msg) {
  errorText.textContent = msg;
  errorMsg.classList.add('show');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.classList.remove('show');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showError('Please enter your username and password.');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('authToken', data.data.token);
      localStorage.setItem('authUser', JSON.stringify(data.data.user));
      location.replace('/');
    } else {
      showError(data.error || 'Invalid credentials. Please try again.');
    }
  } catch {
    showError('Cannot connect to server. Please try again.');
  } finally {
    setLoading(false);
  }
});

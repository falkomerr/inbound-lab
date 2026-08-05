const params = new URLSearchParams(location.search);
const token = params.get('token');

const loadingState = document.getElementById('loadingState');
const invalidState = document.getElementById('invalidState');
const invalidIcon = document.getElementById('invalidIcon');
const invalidTitle = document.getElementById('invalidTitle');
const invalidDesc = document.getElementById('invalidDesc');
const formState = document.getElementById('formState');

function showInvalid(msg) {
  loadingState.style.display = 'none';
  invalidIcon.textContent = '🔗';
  invalidTitle.textContent = 'Invite link invalid';
  if (msg) {
    invalidDesc.textContent = msg;
  } else {
    invalidDesc.innerHTML =
      'This invite link is invalid or has expired.<br>Please ask an admin to send a new invite.';
  }
  invalidState.classList.add('show');
}

function showAlreadyUsed(email) {
  loadingState.style.display = 'none';
  invalidIcon.textContent = '✓';
  invalidTitle.textContent = 'Account already created';
  invalidDesc.textContent = `This invite was already used to create an account.${
    email ? ` You can sign in as ${email}.` : ' You can sign in with the username you chose.'
  } If you forgot your password, ask an admin for a password reset link — not a new invite.`;
  invalidState.classList.add('show');
}

function showForm() {
  loadingState.style.display = 'none';
  formState.style.display = 'block';
}

if (!token) {
  showInvalid('No invite token found in the URL.');
} else {
  // Validate token — abort after 12 seconds so the spinner never hangs forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  fetch(`/api/invite/${token}`, { signal: controller.signal })
    .then((r) => {
      clearTimeout(timeoutId);
      return r.json();
    })
    .then((data) => {
      if (!data.success) {
        showInvalid(data.error || 'Invite link is invalid or expired.');
        return;
      }
      const payload = data.data || {};
      if (payload.alreadyUsed) {
        showAlreadyUsed(payload.email || '');
        return;
      }
      const { email } = payload;
      if (!email) {
        showInvalid('Invite data is missing. Please ask an admin to resend.');
        return;
      }
      document.getElementById('chipEmail').textContent = email;
      document.getElementById('chipAvatar').textContent = email[0].toUpperCase();
      document.getElementById('username').value = email.split('@')[0];
      showForm();
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        showInvalid('Server did not respond in time. Please try refreshing the page.');
      } else {
        showInvalid('Could not reach server. Please check your connection and try again.');
      }
    });
}

// Password toggle
document.getElementById('pwToggle').addEventListener('click', () => {
  const inp = document.getElementById('password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  document.getElementById('eyeIcon').innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// Form submit
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const submitBtn = document.getElementById('submitBtn');

function setLoading(on) {
  submitBtn.disabled = on;
  document.getElementById('btnContent').innerHTML = on
    ? '<div class="spinner"></div>'
    : 'Create account <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
}

document.getElementById('acceptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.classList.remove('show');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username) {
    errorText.textContent = 'Please choose a username.';
    errorMsg.classList.add('show');
    return;
  }
  if (password.length < 6) {
    errorText.textContent = 'Password must be at least 6 characters.';
    errorMsg.classList.add('show');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(`/api/invite/${token}/accept`, {
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
      errorText.textContent = data.error || 'Registration failed.';
      errorMsg.classList.add('show');
    }
  } catch {
    errorText.textContent = 'Cannot connect to server. Please try again.';
    errorMsg.classList.add('show');
  } finally {
    setLoading(false);
  }
});

const params = new URLSearchParams(location.search);
const token = params.get('token');

const loadingEl = document.getElementById('loadingState');
const invalidEl = document.getElementById('invalidState');
const formEl = document.getElementById('resetForm');

const EYE_OPEN =
  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const EYE_SLASH =
  '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';

function showInvalid() {
  loadingEl.style.display = 'none';
  invalidEl.style.display = 'block';
}

async function init() {
  if (!token) {
    showInvalid();
    return;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`/api/reset/${token}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!data.success) {
      showInvalid();
      return;
    }
    const name = (data.data || {}).username;
    if (!name) {
      showInvalid();
      return;
    }
    document.getElementById('usernameLabel').textContent = name;
    document.getElementById('userAvatar').textContent = name[0].toUpperCase();
    loadingEl.style.display = 'none';
    formEl.style.display = 'block';
  } catch {
    clearTimeout(timeoutId);
    showInvalid();
  }
}

function makeToggle(btnId, inputId, eyeId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    document.getElementById(eyeId).innerHTML = show ? EYE_SLASH : EYE_OPEN;
  });
}
makeToggle('pw1Toggle', 'password', 'eye1');
makeToggle('pw2Toggle', 'confirm', 'eye2');

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;
  const errorMsg = document.getElementById('errorMsg');
  const errorTxt = document.getElementById('errorText');
  const successMsg = document.getElementById('successMsg');
  const btn = document.getElementById('submitBtn');

  errorMsg.classList.remove('show');

  if (password.length < 6) {
    errorTxt.textContent = 'Password must be at least 6 characters.';
    errorMsg.classList.add('show');
    return;
  }
  if (password !== confirm) {
    errorTxt.textContent = 'Passwords do not match.';
    errorMsg.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin .8s linear infinite"><polyline points="23 4 23 11 16 11"/><path d="M20.49 15a9 9 0 1 1-.28-3.37"/></svg> Saving\u2026';
  try {
    const res = await fetch(`/api/reset/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      successMsg.classList.add('show');
      btn.style.display = 'none';
      setTimeout(() => {
        location.href = '/login';
      }, 2400);
    } else {
      errorTxt.textContent = data.error;
      errorMsg.classList.add('show');
      btn.disabled = false;
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Set Password';
    }
  } catch {
    errorTxt.textContent = 'Request failed. Please try again.';
    errorMsg.classList.add('show');
    btn.disabled = false;
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Set Password';
  }
});

/* spinner keyframe injected once */
const s = document.createElement('style');
s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(s);

init();

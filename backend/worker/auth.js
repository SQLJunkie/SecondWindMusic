// Session TTL: 7 days
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Generate a cryptographically random session token. */
async function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Hash a password using PBKDF2 (SHA-256, 100k iterations). */
async function hashPassword(password) {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMat, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

/** Verify a plaintext password against a stored hash. */
async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = stored.split(':');
  const salt    = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMat, 256
  );
  const derived = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return derived === hashHex;
}

/** Parse the session cookie from a request. */
function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

/** Build a Set-Cookie header string. */
function buildSessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const parts = [
    `session=${token}`,
    `Max-Age=${maxAge}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  return parts.join('; ');
}

// ── Session helpers (exported for oauth.js) ───────────────────────────────────

export async function createSession(env, userId) {
  const token = await generateSessionToken();
  await env.SESSIONS.put(token, String(userId), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function getUserFromSession(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;

  const userId = await env.SESSIONS.get(token);
  if (!userId) return null;

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(Number(userId))
    .first();

  return user ?? null;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function handleRegister(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return jsonResponse({ error: 'Email and password are required' }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first();

  if (existing) {
    return jsonResponse({ error: 'An account with that email already exists' }, 409);
  }

  const hash = await hashPassword(password);

  const result = await env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id'
  ).bind(email.trim().toLowerCase(), hash).first();

  const token  = await createSession(env, result.id);
  const cookie = buildSessionCookie(token);

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}

export async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return jsonResponse({ error: 'Email and password are required' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, password_hash FROM users WHERE email = ?'
  ).bind(email.trim().toLowerCase()).first();

  // Deliberate vague error — don't reveal whether email exists
  if (!user || !user.password_hash) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }

  const token  = await createSession(env, user.id);
  const cookie = buildSessionCookie(token);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}

export async function handleLogout(request, env) {
  const token = getSessionToken(request);

  if (token) {
    await env.SESSIONS.delete(token);
  }

  const expiredCookie = buildSessionCookie('', 0);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': expiredCookie },
  });
}

export async function handleMe(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return jsonResponse({ id: user.id, email: user.email });
}

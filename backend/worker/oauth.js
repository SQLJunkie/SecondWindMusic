import { createSession } from './auth.js';

// Session TTL mirrors auth.js
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// ── Provider config ───────────────────────────────────────────────────────────

function getProviderConfig(env, provider) {
  const base = 'https://secondwindmusic.com';

  const configs = {
    google: {
      authUrl:     'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl:    'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientId:     env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri:  `${base}/api/oauth/google/callback`,
      scope:        'openid email',
    },
    microsoft: {
      authUrl:     'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl:    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
      clientId:     env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      redirectUri:  `${base}/api/oauth/microsoft/callback`,
      scope:        'openid email',
    },
    apple: {
      authUrl:      'https://appleid.apple.com/auth/authorize',
      tokenUrl:     'https://appleid.apple.com/auth/token',
      userinfoUrl:  null, // Apple returns identity via id_token only
      clientId:      env.APPLE_CLIENT_ID,
      clientSecret:  null, // Generated dynamically via JWT
      redirectUri:   `${base}/api/oauth/apple/callback`,
      scope:         'name email',
    },
  };

  return configs[provider] ?? null;
}

// ── CSRF state helpers ────────────────────────────────────────────────────────

async function generateState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStateCookie(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(/(?:^|;\s*)oauth_state=([^;]+)/);
  return match ? match[1] : null;
}

function buildStateCookie(state, maxAge = 600) {
  return `oauth_state=${state}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function buildSessionCookie(token) {
  return `session=${token}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// ── Apple client_secret (signed JWT) ─────────────────────────────────────────

async function generateAppleClientSecret(env) {
  const header  = { alg: 'ES256', kid: env.APPLE_KEY_ID };
  const payload = {
    iss: env.APPLE_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    aud: 'https://appleid.apple.com',
    sub: env.APPLE_CLIENT_ID,
  };

  const encode  = obj => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const message = `${encode(header)}.${encode(payload)}`;

  // APPLE_PRIVATE_KEY stored with literal \n chars as secret
  const pem      = env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const pemBody  = pem.replace(/-----.*?-----/g, '').replace(/\s+/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(message)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${message}.${sigB64}`;
}

// ── Parse id_token payload (no sig verify — already validated by token exchange) ──

function parseIdToken(token) {
  try {
    const payload = token.split('.')[1];
    const json    = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Upsert user and return id ─────────────────────────────────────────────────

async function upsertOAuthUser(env, provider, sub, email) {
  // 1. Match on OAuth identity
  let user = await env.DB.prepare(
    'SELECT id FROM users WHERE oauth_provider = ? AND oauth_sub = ?'
  ).bind(provider, sub).first();
  if (user) return user.id;

  // 2. Merge with existing email account
  if (email) {
    user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email.trim().toLowerCase()).first();
    if (user) {
      await env.DB.prepare(
        'UPDATE users SET oauth_provider = ?, oauth_sub = ? WHERE id = ?'
      ).bind(provider, sub, user.id).run();
      return user.id;
    }
  }

  // 3. Create new account
  const result = await env.DB.prepare(
    'INSERT INTO users (email, oauth_provider, oauth_sub) VALUES (?, ?, ?) RETURNING id'
  ).bind(email ? email.trim().toLowerCase() : null, provider, sub).first();

  return result.id;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function handleOAuthRedirect(request, env, provider) {
  const config = getProviderConfig(env, provider);
  if (!config) {
    return new Response(JSON.stringify({ error: 'Unknown provider' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const state  = await generateState();
  const params = new URLSearchParams({
    client_id:     config.clientId,
    redirect_uri:  config.redirectUri,
    response_type: 'code',
    scope:         config.scope,
    state,
  });

  if (provider === 'apple') params.set('response_mode', 'form_post');

  return new Response(null, {
    status: 302,
    headers: {
      Location:     `${config.authUrl}?${params}`,
      'Set-Cookie':  buildStateCookie(state),
    },
  });
}

export async function handleOAuthCallback(request, env, provider) {
  const config = getProviderConfig(env, provider);
  if (!config) {
    return Response.redirect('https://secondwindmusic.com/login?error=unknown_provider', 302);
  }

  // Apple POSTs form data; Google/Microsoft use GET query params
  let code, state;
  if (provider === 'apple' && request.method === 'POST') {
    const form = await request.formData();
    code  = form.get('code');
    state = form.get('state');
  } else {
    const { searchParams } = new URL(request.url);
    code  = searchParams.get('code');
    state = searchParams.get('state');
  }

  // CSRF check
  const storedState = getStateCookie(request);
  if (!state || state !== storedState) {
    return Response.redirect('https://secondwindmusic.com/login?error=state_mismatch', 302);
  }
  if (!code) {
    return Response.redirect('https://secondwindmusic.com/login?error=no_code', 302);
  }

  // Exchange code for tokens
  const clientSecret = provider === 'apple'
    ? await generateAppleClientSecret(env)
    : config.clientSecret;

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  config.redirectUri,
      client_id:     config.clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text());
    return Response.redirect('https://secondwindmusic.com/login?error=token_exchange', 302);
  }

  const tokens = await tokenRes.json();

  // Resolve identity
  let sub, email;

  if (provider === 'apple') {
    const claims = parseIdToken(tokens.id_token);
    if (!claims) return Response.redirect('https://secondwindmusic.com/login?error=invalid_token', 302);
    sub   = claims.sub;
    email = claims.email;
  } else {
    const userRes = await fetch(config.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) return Response.redirect('https://secondwindmusic.com/login?error=userinfo', 302);
    const info = await userRes.json();
    sub   = info.sub;
    email = info.email;
  }

  if (!sub) {
    return Response.redirect('https://secondwindmusic.com/login?error=no_identity', 302);
  }

  const userId = await upsertOAuthUser(env, provider, sub, email);
  const token  = await createSession(env, userId);

  return new Response(null, {
    status: 302,
    headers: {
      Location:     'https://secondwindmusic.com/downloads',
      'Set-Cookie':  buildSessionCookie(token),
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAddVideo(request, env) {
  // Authenticate via X-Admin-Password header
  const adminPassword = request.headers.get('X-Admin-Password');
  if (!adminPassword || adminPassword !== env.ADMIN_PASSWORD) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { user_email, title, dropbox_path, thumbnail_url } = body;

  if (!user_email || !title || !dropbox_path) {
    return jsonResponse({ error: 'user_email, title, and dropbox_path are required' }, 400);
  }

  // Resolve user
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(user_email.trim().toLowerCase()).first();

  if (!user) {
    return jsonResponse({ error: `No account found for ${user_email}` }, 404);
  }

  const result = await env.DB.prepare(
    'INSERT INTO videos (user_id, title, dropbox_path, thumbnail_url) VALUES (?, ?, ?, ?) RETURNING id'
  ).bind(user.id, title.trim(), dropbox_path.trim(), thumbnail_url ?? null).first();

  return jsonResponse({ ok: true, video_id: result.id }, 201);
}

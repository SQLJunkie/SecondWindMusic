import { getUserFromSession } from './auth.js';

const DROPBOX_TEMP_LINK_URL = 'https://api.dropboxapi.com/2/files/get_temporary_link';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleVideos(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT id, title, thumbnail_url, created_at FROM videos WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  return jsonResponse({ videos: results });
}

export async function handleDownload(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('video_id');

  if (!videoId) return jsonResponse({ error: 'video_id is required' }, 400);

  // Verify ownership before issuing a link
  const video = await env.DB.prepare(
    'SELECT dropbox_path FROM videos WHERE id = ? AND user_id = ?'
  ).bind(Number(videoId), user.id).first();

  if (!video) return jsonResponse({ error: 'Not found' }, 404);

  // Request a temporary Dropbox link (valid for ~4 hours)
  const dropboxRes = await fetch(DROPBOX_TEMP_LINK_URL, {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${env.DROPBOX_TOKEN}`,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({ path: video.dropbox_path }),
  });

  if (!dropboxRes.ok) {
    const err = await dropboxRes.text();
    console.error('Dropbox error:', err);
    return jsonResponse({ error: 'Could not generate download link' }, 502);
  }

  const { link } = await dropboxRes.json();

  // Redirect the client directly to the Dropbox temporary link
  return new Response(null, {
    status: 302,
    headers: { Location: link },
  });
}

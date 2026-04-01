import { handleRegister, handleLogin, handleLogout, handleMe } from './auth.js';
import { handleOAuthRedirect, handleOAuthCallback }              from './oauth.js';
import { handleVideos, handleDownload }                          from './videos.js';
import { handleAddVideo }                                        from './admin.js';

const json404 = () =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

const json405 = () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

export async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const method       = request.method;

  // Strip /api prefix
  const path = pathname.startsWith('/api') ? pathname.slice(4) : pathname;

  // Auth
  if (path === '/register' && method === 'POST') return handleRegister(request, env);
  if (path === '/login'    && method === 'POST') return handleLogin(request, env);
  if (path === '/logout'   && method === 'POST') return handleLogout(request, env);
  if (path === '/me'       && method === 'GET')  return handleMe(request, env);

  // OAuth — /oauth/:provider/redirect and /oauth/:provider/callback
  const oauthMatch = path.match(/^\/oauth\/(google|microsoft|apple)\/(redirect|callback)$/);
  if (oauthMatch) {
    const [, provider, action] = oauthMatch;
    if (action === 'redirect') return handleOAuthRedirect(request, env, provider);
    if (action === 'callback') return handleOAuthCallback(request, env, provider);
  }

  // Videos
  if (path === '/videos'  && method === 'GET') return handleVideos(request, env);
  if (path === '/download' && method === 'GET') return handleDownload(request, env);

  // Admin
  if (path === '/admin/add-video' && method === 'POST') return handleAddVideo(request, env);

  // Method check for known paths with wrong method
  const knownPaths = ['/register', '/login', '/logout', '/me', '/videos', '/download', '/admin/add-video'];
  if (knownPaths.includes(path)) return json405();

  return json404();
}

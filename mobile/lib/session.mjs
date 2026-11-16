import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.mjs';

const cookieName = 'dryspool_session';
const lifetime = 12 * 60 * 60;
function password() {
  const value = process.env.DRYSPOOL_PASSWORD;
  if (!value || value.length < 16) throw new ApiError(503, '服务器尚未配置看板登录密码');
  return value;
}
const digest = str => createHash('sha256').update(str).digest();
function signature(text) {
  return createHmac('sha256', password()).update('dryspool-session-v1:' + text).digest('base64url');
}
function cookie(token, seconds, req) {
  const secure = new URL(req.url).protocol === 'https:' || Boolean(process.env.VERCEL);
  return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + seconds +
    (secure ? '; Secure' : '');
}
export function login(req, attempt, now = Date.now()) {
  const secret = password();
  if (typeof attempt !== 'string' || !timingSafeEqual(digest(secret), digest(attempt))) {
    throw new ApiError(401, '登录密码不正确');
  }
  const exp = Math.floor(now / 1000) + lifetime;
  const token = exp + '.' + randomBytes(16).toString('hex');
  return cookie(token + '.' + signature(token), lifetime, req);
}
export const logout = req => cookie('', 0, req);
export function requireSession(req, now = Date.now()) {
  const cookie = (req.headers.get('cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(cookieName + '='));
  const match = cookie?.slice(cookieName.length + 1).match(/^(\d{10})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/);
  if (!match || Number(match[1]) <= now / 1000 ||
      !timingSafeEqual(digest(signature(match[1] + '.' + match[2])), digest(match[3]))) {
    throw new ApiError(401, '请登录看板');
  }
}

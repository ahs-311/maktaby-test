import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const env = (name: string) => Deno.env.get(name)?.trim() || '';
const supabaseUrl = env('SUPABASE_URL');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const pepper = env('ACTIVATION_CODE_PEPPER');
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function normalizePhone(input: string) {
  let p = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d+]/g, '');
  if (/^01[0125]\d{8}$/.test(p)) p = '+20' + p.slice(1);
  else if (/^201[0125]\d{8}$/.test(p)) p = '+' + p;
  else if (/^00/.test(p)) p = '+' + p.slice(2);
  else if (/^\d/.test(p) && !p.startsWith('+')) p = '+' + p;
  return p;
}
function mask(channel: string, destination: string) {
  return channel === 'email'
    ? `${destination.slice(0, 1)}***@${destination.split('@')[1] || ''}`
    : `••••${destination.slice(-4)}`;
}
function randomCode() {
  const max = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= max);
  return String(value[0] % 1_000_000).padStart(6, '0');
}
async function digest(id: string, code: string) {
  const data = new TextEncoder().encode(`${pepper}|${id}|${code}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64Url(bytes: Uint8Array) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function gmailAccessToken() {
  const clientId = env('ACTIVATION_GMAIL_CLIENT_ID');
  const clientSecret = env('ACTIVATION_GMAIL_CLIENT_SECRET');
  const refreshToken = env('ACTIVATION_GMAIL_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('activation_provider_not_configured');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('activation_delivery_failed');
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('activation_delivery_failed');
  return result.access_token as string;
}
async function sendEmail(to: string, code: string) {
  const from = env('ACTIVATION_GMAIL_FROM');
  if (!from || /[\r\n]/.test(from) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    throw new Error('activation_provider_not_configured');
  }
  const accessToken = await gmailAccessToken();
  const encoder = new TextEncoder();
  const subject = `=?UTF-8?B?${base64(encoder.encode('رمز تفعيل حساب مكتبي'))}?=`;
  const text = `رمز تفعيل حسابك: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد. إذا لم تطلبه فتجاهل هذه الرسالة.`;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(encoder.encode(text)),
  ].join('\r\n');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64Url(encoder.encode(mime)) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('activation_delivery_failed');
}
async function sendWhatsApp(to: string, code: string) {
  const token = env('ACTIVATION_META_ACCESS_TOKEN');
  const phoneNumberId = env('ACTIVATION_META_PHONE_NUMBER_ID');
  const template = env('ACTIVATION_META_TEMPLATE_NAME');
  const language = env('ACTIVATION_META_TEMPLATE_LANGUAGE');
  const version = env('ACTIVATION_META_GRAPH_VERSION') || 'v23.0';
  if (!token || !phoneNumberId || !template || !language) throw new Error('activation_provider_not_configured');
  // Template must be an approved Meta AUTHENTICATION template with the OTP Copy Code button.
  // Per Meta's template example, the code is passed in both the body parameter and URL-style
  // OTP button parameter; no business number is registered by this function.
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, ''), type: 'template',
      template: {
        name: template, language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  if (!response.ok) throw new Error('activation_delivery_failed');
}
async function authenticatedUser(req: Request) {
  const match = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('unauthorized');
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new Error('unauthorized');
  return data.user;
}
async function pendingManager(userId: string) {
  const { data: profile, error } = await admin.from('profiles')
    .select('user_id, role, active, office_id, extra')
    .eq('user_id', userId).maybeSingle();
  if (error || !profile || profile.role !== 'manager' || profile.active !== false || profile.extra?.activationRequired !== true) {
    throw new Error('manager_activation_required');
  }
  const { data: office } = await admin.from('offices').select('active').eq('id', profile.office_id).maybeSingle();
  if (!office?.active) throw new Error('manager_activation_required');
  return profile;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !pepper) return json({ error: 'activation_backend_not_configured' }, 503);
  try {
    const user = await authenticatedUser(req);
    const body = await req.json();
    const action = String(body.action || '');
    await pendingManager(user.id);

    if (action === 'start') {
      const channel = String(body.channel || '');
      if (channel !== 'email' && channel !== 'whatsapp') return json({ error: 'bad_channel' }, 400);
      let destination = String(body.destination || '').trim();
      if (channel === 'email') {
        destination = destination.toLowerCase();
        if (destination.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return json({ error: 'bad_destination' }, 400);
      } else {
        destination = normalizePhone(destination);
        if (!/^\+[1-9]\d{7,14}$/.test(destination)) return json({ error: 'bad_destination' }, 400);
      }
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count, error: countError } = await admin.from('manager_activation_challenges')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
      if (countError) throw new Error('activation_store_unavailable');
      if ((count || 0) >= 3) throw new Error('activation_rate_limited');

      const id = crypto.randomUUID();
      const code = randomCode();
      const { error: insertError } = await admin.from('manager_activation_challenges').insert({
        id, user_id: user.id, channel, destination, code_hash: await digest(id, code),
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (insertError) throw new Error('activation_store_unavailable');
      try {
        if (channel === 'email') await sendEmail(destination, code);
        else await sendWhatsApp(destination, code);
      } catch (error) {
        await admin.from('manager_activation_challenges').delete().eq('id', id).eq('user_id', user.id);
        if (error instanceof Error && error.message === 'activation_provider_not_configured') throw error;
        throw new Error('activation_delivery_failed');
      }
      return json({ ok: true, challenge_id: id, masked: mask(channel, destination) });
    }

    if (action === 'verify') {
      const id = String(body.challenge_id || '');
      const code = String(body.code || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code)) return json({ error: 'invalid_or_expired_code' }, 400);
      const { data: challenge, error } = await admin.from('manager_activation_challenges')
        .select('id, channel, destination, expires_at').eq('id', id).eq('user_id', user.id).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (error || !challenge) return json({ error: 'invalid_or_expired_code' }, 400);
      const complete = await admin.rpc('mk_manager_activation_complete', {
        p_challenge_id: id, p_user_id: user.id, p_code_hash: await digest(id, code),
      });
      if (complete.error || complete.data !== true) return json({ error: 'invalid_or_expired_code' }, 400);
      return json({ ok: true, channel: challenge.channel, masked: mask(challenge.channel, challenge.destination) });
    }
    return json({ error: 'bad_action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request_failed';
    const status = message === 'unauthorized' ? 401
      : message === 'activation_rate_limited' ? 429
      : message === 'activation_provider_not_configured' || message === 'activation_backend_not_configured' ? 503
      : message === 'manager_activation_required' ? 403
      : message === 'activation_delivery_failed' ? 502 : 500;
    return json({ error: message.startsWith('activation_') ? message : 'request_failed' }, status);
  }
});

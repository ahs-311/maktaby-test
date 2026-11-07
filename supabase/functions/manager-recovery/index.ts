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
const anonKey = env('SUPABASE_ANON_KEY');
const pepper = env('RECOVERY_CODE_PEPPER');
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function normalizePhone(input: string) {
  let p = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d+]/g, '');
  if (/^01[0125]\d{8}$/.test(p)) p = '+20' + p.slice(1);
  else if (/^201[0125]\d{8}$/.test(p)) p = '+' + p;
  else if (/^00/.test(p)) p = '+' + p.slice(2);
  else if (/^\d/.test(p) && !p.startsWith('+')) p = '+' + p;
  return p;
}
function validChannel(channel: string) { return ['email', 'sms', 'whatsapp'].includes(channel); }
function masked(destination: string, channel: string) {
  if (channel === 'email') {
    const [name, domain] = destination.split('@');
    return `${(name || '').slice(0, 1)}***@${domain || ''}`;
  }
  return `••••${destination.slice(-4)}`;
}
async function codeDigest(id: string, code: string) {
  const bytes = new TextEncoder().encode(`${pepper}|${id}|${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCode() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, '0');
}
function missingProvider(channel: string) {
  if (channel === 'email') return !env('RESEND_API_KEY') || !env('RECOVERY_EMAIL_FROM');
  return !env('TWILIO_ACCOUNT_SID') || !env('TWILIO_AUTH_TOKEN') || !env('TWILIO_VERIFY_SERVICE_SID');
}
async function sendCode(channel: string, destination: string, code: string) {
  if (channel === 'email') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env('RECOVERY_EMAIL_FROM'), to: [destination],
        subject: 'رمز استعادة حساب مكتبي',
        text: `رمز التحقق: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد. إذا لم تطلبه فتجاهل الرسالة.`,
      }),
    });
    if (!res.ok) throw new Error('email_delivery_failed');
    return;
  }
  const sid = env('TWILIO_ACCOUNT_SID');
  const service = env('TWILIO_VERIFY_SERVICE_SID');
  const form = new URLSearchParams({ To: destination, Channel: channel === 'whatsapp' ? 'whatsapp' : 'sms' });
  const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/Verifications`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  if (!res.ok) throw new Error('phone_delivery_failed');
}
async function checkCode(channel: string, destination: string, code: string) {
  if (channel === 'email') return false; // Email is verified against the stored digest below.
  const sid = env('TWILIO_ACCOUNT_SID');
  const service = env('TWILIO_VERIFY_SERVICE_SID');
  const form = new URLSearchParams({ To: destination, Code: code });
  const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/VerificationCheck`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  if (!res.ok) return false;
  const result = await res.json();
  return result.status === 'approved';
}
async function createChallenge(userId: string, purpose: 'recovery' | 'contact', channel: string, destination: string) {
  if (!validChannel(channel)) throw new Error('bad_channel');
  if (missingProvider(channel)) throw new Error(channel === 'email' ? 'email_provider_not_configured' : 'phone_provider_not_configured');

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: countError } = await admin.from('manager_recovery_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('purpose', purpose).gte('created_at', since);
  if (countError) throw new Error('challenge_store_unavailable');
  if ((count || 0) >= 3) throw new Error('rate_limited');

  const code = channel === 'email' ? randomCode() : null;
  const id = crypto.randomUUID();
  const { error: insertError } = await admin.from('manager_recovery_challenges').insert({
    id, user_id: userId, purpose, channel, destination,
    code_hash: code ? await codeDigest(id, code) : null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (insertError) throw new Error('challenge_store_unavailable');
  try {
    await sendCode(channel, destination, code || '');
  } catch {
    await admin.from('manager_recovery_challenges').delete().eq('id', id);
    throw new Error('delivery_failed');
  }
  return { id, masked: masked(destination, channel) };
}
async function signedInManager(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('unauthorized');
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new Error('unauthorized');
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('user_id, username, role, active, office_id, extra')
    .eq('user_id', data.user.id).maybeSingle();
  if (profileError || !profile || profile.role !== 'manager' || !profile.active) throw new Error('manager_only');
  const { data: office } = await admin.from('offices').select('active').eq('id', profile.office_id).maybeSingle();
  if (!office?.active) throw new Error('office_inactive');
  return { user: data.user, profile };
}
async function verifyManagerPassword(email: string, password: string) {
  if (!anonKey || !password) return false;
  const verifier = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;
  await verifier.auth.signOut();
  return true;
}
async function verifyChallenge(challenge: any, code: string) {
  const bumped = await admin.rpc('mk_recovery_bump_attempt', { p_challenge_id: challenge.id });
  if (bumped.error || !bumped.data) return false;
  if (challenge.channel === 'email') {
    if (!challenge.code_hash) return false;
    return (await codeDigest(challenge.id, code)) === challenge.code_hash;
  }
  return await checkCode(challenge.channel, challenge.destination, code);
}
async function consumeChallenge(id: string) {
  const result = await admin.rpc('mk_recovery_consume', { p_challenge_id: id });
  return !result.error && result.data === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!supabaseUrl || !serviceKey || !pepper) return json({ error: 'recovery_backend_not_configured' }, 503);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const action = String(body.action || '');
  try {
    if (action === 'start-recovery') {
      const username = String(body.username || '').trim().toLowerCase();
      const channel = String(body.channel || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username) || !validChannel(channel)) return json({ error: 'bad_request' }, 400);
      if (missingProvider(channel)) return json({ error: channel === 'email' ? 'email_provider_not_configured' : 'phone_provider_not_configured' }, 503);
      const { data: profile } = await admin.from('profiles')
        .select('user_id, username, role, active, office_id, extra')
        .eq('username', username).eq('role', 'manager').eq('active', true).maybeSingle();
      if (!profile) return json({ ok: true, challenge_id: crypto.randomUUID() });
      const { data: office } = await admin.from('offices').select('active').eq('id', profile.office_id).maybeSingle();
      if (!office?.active) return json({ ok: true, challenge_id: crypto.randomUUID() });
      const { data: contacts } = await admin.from('manager_recovery_contacts').select('recovery_email,recovery_email_verified,recovery_phone,recovery_phone_verified').eq('user_id', profile.user_id).maybeSingle();
      const destination = channel === 'email'
        ? (contacts?.recovery_email_verified === true ? String(contacts.recovery_email || '').trim().toLowerCase() : '')
        : (contacts?.recovery_phone_verified === true ? normalizePhone(String(contacts.recovery_phone || '')) : '');
      if (!destination || (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) || (channel !== 'email' && !/^\+[1-9]\d{7,14}$/.test(destination))) {
        return json({ ok: true, challenge_id: crypto.randomUUID() });
      }
      try {
        const result = await createChallenge(profile.user_id, 'recovery', channel, destination);
        return json({ ok: true, challenge_id: result.id });
      } catch {
        // Keep the public response generic even when a delivery attempt fails for a real account.
        return json({ ok: true, challenge_id: crypto.randomUUID() });
      }
    }

    if (action === 'finish-recovery') {
      const id = String(body.challenge_id || '');
      const code = String(body.code || '').trim();
      const password = String(body.password || '');
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code) || password.length < 8 || password.length > 72) return json({ error: 'invalid_or_expired_code' }, 400);
      const { data: challenge } = await admin.from('manager_recovery_challenges').select('*')
        .eq('id', id).eq('purpose', 'recovery').is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!challenge || !await verifyChallenge(challenge, code)) return json({ error: 'invalid_or_expired_code' }, 400);
      const { data: profile } = await admin.from('profiles').select('user_id, role, active, office_id')
        .eq('user_id', challenge.user_id).maybeSingle();
      if (!profile || profile.role !== 'manager' || !profile.active) return json({ error: 'invalid_or_expired_code' }, 400);
      const { data: office } = await admin.from('offices').select('active').eq('id', profile.office_id).maybeSingle();
      if (!office?.active) return json({ error: 'invalid_or_expired_code' }, 400);
      if (!await consumeChallenge(id)) return json({ error: 'invalid_or_expired_code' }, 400);
      const { error: passwordError } = await admin.auth.admin.updateUserById(challenge.user_id, { password });
      if (passwordError) return json({ error: 'password_update_failed' }, 500);
      const { error: versionError } = await admin.rpc('mk_recovery_increment_pw_version', { p_user_id: challenge.user_id });
      if (versionError) return json({ error: 'password_updated_refresh_required' }, 500);
      return json({ ok: true });
    }

    if (action === 'start-contact-verification') {
      const { user, profile } = await signedInManager(req);
      const channel = String(body.channel || '');
      const raw = String(body.destination || '').trim();
      const currentPassword = String(body.current_password || '');
      if (!validChannel(channel) || !raw || currentPassword.length < 8) return json({ error: 'bad_request' }, 400);
      const destination = channel === 'email' ? raw.toLowerCase() : normalizePhone(raw);
      if ((channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) || (channel !== 'email' && !/^\+[1-9]\d{7,14}$/.test(destination))) return json({ error: 'invalid_destination' }, 400);
      if (!user.email || !await verifyManagerPassword(user.email, currentPassword)) return json({ error: 'current_password_invalid' }, 401);
      const result = await createChallenge(profile.user_id, 'contact', channel, destination);
      return json({ ok: true, challenge_id: result.id, masked: result.masked });
    }

    if (action === 'finish-contact-verification') {
      const { profile } = await signedInManager(req);
      const id = String(body.challenge_id || '');
      const code = String(body.code || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code)) return json({ error: 'invalid_or_expired_code' }, 400);
      const { data: challenge } = await admin.from('manager_recovery_challenges').select('*')
        .eq('id', id).eq('purpose', 'contact').eq('user_id', profile.user_id).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!challenge || !await verifyChallenge(challenge, code)) return json({ error: 'invalid_or_expired_code' }, 400);
      if (!await consumeChallenge(id)) return json({ error: 'invalid_or_expired_code' }, 400);
      const { error } = await admin.rpc('mk_set_recovery_contact', {
        p_user_id: profile.user_id, p_channel: challenge.channel, p_destination: challenge.destination,
      });
      if (error) return json({ error: 'contact_save_failed' }, 500);
      return json({ ok: true, channel: challenge.channel, masked: masked(challenge.destination, challenge.channel) });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'request_failed';
    const status = message === 'unauthorized' ? 401 : message === 'manager_only' ? 403
      : message === 'office_inactive' ? 403 : message === 'rate_limited' ? 429
      : message.endsWith('_not_configured') ? 503 : 500;
    return json({ error: message }, status);
  }
});

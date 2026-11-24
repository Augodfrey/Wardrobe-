// Owner: invite a staff member by email (public sign-ups stay disabled).
import { adminClient, requireStaff } from '../_shared/clients.ts';
import { env, fail, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const staff = await requireStaff(req);
  if (!staff || staff.profile.role !== 'owner') return fail('Only the owner can invite users', 403);
  const { email, full_name, role = 'staff' } = await req.json();
  if (!email) return fail('Email required');
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name }, redirectTo: env('PUBLIC_APP_URL') || undefined,
  });
  if (error) return fail(error.message);
  await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { shop_id: staff.profile.shop_id, role } });
  // The auth trigger created the profile; make sure it is in this shop with the right role.
  await admin.from('profiles').upsert({ id: data.user.id, shop_id: staff.profile.shop_id, full_name: full_name ?? email,
    role: role === 'owner' ? 'owner' : 'staff' });
  return json({ ok: true, user_id: data.user.id });
});

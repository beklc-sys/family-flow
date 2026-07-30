import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

export const supabase = createClient(
  CONFIG.supabaseUrl,
  CONFIG.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  }
);

export async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) return sessionData.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

export async function getCurrentFamily() {
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) return null;

  const { data: memberships, error: membershipError } = await supabase
    .from("family_users")
    .select("family_id, user_id, display_name, role")
    .eq("user_id", user.id)
    .limit(1);

  if (membershipError) throw membershipError;

  const membership = memberships?.[0] || null;
  if (!membership) return null;

  const { data: families, error: familyError } = await supabase
    .from("families")
    .select("id, name, invite_token, created_at")
    .eq("id", membership.family_id)
    .limit(1);

  if (familyError) throw familyError;

  const family = families?.[0] || null;

  if (!family) {
    return {
      id: membership.family_id,
      name: "Unsere Familie",
      invite_token: null,
      created_at: null,
      membership
    };
  }

  return { ...family, membership };
}

export async function createFamily(displayName) {
  const { data, error } = await supabase.rpc("create_family", {
    family_name: "Unsere Familie",
    member_name: displayName.trim()
  });
  if (error) throw error;
  return data;
}

export async function joinFamily(inviteToken, displayName) {
  const { data, error } = await supabase.rpc("join_family", {
    invitation_token: inviteToken.trim(),
    member_name: displayName.trim()
  });
  if (error) throw error;
  return data;
}

export function subscribeToShoppingItems(familyId, onChange) {
  return supabase
    .channel(`shopping:${familyId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shopping_items",
        filter: `family_id=eq.${familyId}`
      },
      onChange
    )
    .subscribe();
}

export async function unsubscribe(channel) {
  if (channel) await supabase.removeChannel(channel);
}

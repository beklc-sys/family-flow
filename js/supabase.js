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
  const { data: membership, error: membershipError } = await supabase
    .from("family_users")
    .select("family_id, display_name, role")
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) return null;

  const { data: family, error: familyError } = await supabase
    .from("families")
    .select("id, name, invite_token, created_at")
    .eq("id", membership.family_id)
    .single();

  if (familyError) throw familyError;
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

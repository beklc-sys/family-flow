import { supabase } from "./supabase.js";
import { getState, setState } from "./store.js";
import { addShoppingItem } from "./shopping.js";

export async function loadFavorites(familyId) {
  const { data, error } = await supabase
    .from("shopping_favorites")
    .select("*")
    .eq("family_id", familyId)
    .order("category")
    .order("sort_order")
    .order("item_text");
  if (error) throw error;
  setState({ favorites: data || [] });
}

export async function createFavorite(itemText, category = "Sonstiges", repeatWeekday = null) {
  const { family } = getState();
  const text = itemText.trim();
  if (!family || !text) return;
  const { error } = await supabase.from("shopping_favorites").insert({
    family_id: family.id,
    item_text: text,
    category: category.trim() || "Sonstiges",
    repeat_weekday: repeatWeekday === "" || repeatWeekday == null ? null : Number(repeatWeekday)
  });
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function updateFavorite(id, changes) {
  const { family } = getState();
  if (!family) return;
  const payload = { ...changes, updated_at: new Date().toISOString() };
  if (Object.hasOwn(payload, "repeat_weekday")) {
    payload.repeat_weekday = payload.repeat_weekday === "" || payload.repeat_weekday == null ? null : Number(payload.repeat_weekday);
  }
  const { error } = await supabase.from("shopping_favorites").update(payload).eq("id", id);
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function deleteFavorite(id) {
  const { family } = getState();
  if (!family) return;
  const { error } = await supabase.from("shopping_favorites").delete().eq("id", id);
  if (error) throw error;
  await loadFavorites(family.id);
}

export async function addFavoriteToShoppingList(favorite) {
  await addShoppingItem(favorite.item_text);
}

export async function ensureRecurringFavoritesForDate(date) {
  const { favorites, items } = getState();
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  const weekday = parsed.getDay();
  const recurring = favorites.filter((favorite) => favorite.repeat_weekday === weekday);
  for (const favorite of recurring) {
    const exists = items.some(
      (item) => item.shopping_date === date && item.item_text.trim().toLowerCase() === favorite.item_text.trim().toLowerCase()
    );
    if (!exists) await addShoppingItem(favorite.item_text);
  }
}

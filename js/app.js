import { createFamily, ensureAnonymousSession, getCurrentFamily, joinFamily, subscribeToFavorites, subscribeToShoppingItems, unsubscribe } from "./supabase.js";
import { addShoppingItem, deleteShoppingItem, flushPendingOperations, loadShoppingItems, updateShoppingItem } from "./shopping.js";
import { addFavoriteToShoppingList, createFavorite, deleteFavorite, loadFavorites } from "./favorites.js";
import { getState, removeFavoriteFromStore, removeItemFromStore, setState, upsertFavorite, upsertItem } from "./store.js";
import { clearSelectedFavorites, closeEditDialog, closeFavoritesDialog, copyInviteLink, elements, friendlyError, getInviteTokenFromUrl, getSelectedFavorites, openFavoritesDialog, prepareInviteJoin, resetFavoriteForm, setSelectedDate, showShareDialog, showToast, startRendering } from "./ui.js";

let realtimeChannel = null;
let favoritesChannel = null;

const handlers = {
  async onToggle(item) { await runAction(() => updateShoppingItem(item.id, { is_done: !item.is_done })); },
  async onDeleteFavorite(favorite) {
    if (!confirm(`Favorit „${favorite.item_text}“ löschen?`)) return;
    await runAction(async () => {
      await deleteFavorite(favorite.id);
      showToast("Favorit gelöscht");
    });
  },
  async onSelectDate(date) { setSelectedDate(date); }
};

async function init() {
  bindEvents();
  startRendering(handlers);
  prepareInviteJoin(getInviteTokenFromUrl());
  registerServiceWorker();

  try {
    await ensureAnonymousSession();
    const family = await loadCurrentFamilyWithRetry(3);
    if (!family) { setState({ family: null, loading: false, error: null }); return; }
    await enterFamily(family);
    clearInviteFromAddress();
  } catch (error) {
    setState({ loading: false, error: friendlyError(error) });
  }
}

function bindEvents() {
  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await createFamily(elements.creatorName.value);
      await enterFamily(await loadCurrentFamilyWithRetry());
      showShareDialog();
    });
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await joinFamily(elements.inviteToken.value, elements.joinName.value);
      await enterFamily(await loadCurrentFamilyWithRetry());
      clearInviteFromAddress();
    });
  });

  elements.addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = elements.newItemText.value.trim();
    if (!text) return;
    elements.newItemText.value = "";
    await runAction(() => addShoppingItem(text));
  });

  elements.openFavoritesButton.addEventListener("click", openFavoritesDialog);
  elements.listDate.addEventListener("change", () => {
    if (elements.listDate.value) setSelectedDate(elements.listDate.value);
  });

  elements.favoriteSearch.addEventListener("input", () => setState({ favorites: [...getState().favorites] }));
  elements.closeFavoritesButton.addEventListener("click", closeFavoritesDialog);

  elements.addSelectedFavoritesButton.addEventListener("click", async () => {
    const selected = getSelectedFavorites();
    if (!selected.length) return;

    elements.addSelectedFavoritesButton.disabled = true;
    await runAction(async () => {
      for (const favorite of selected) {
        await addFavoriteToShoppingList(favorite);
      }
      clearSelectedFavorites();
      closeFavoritesDialog();
      showToast(`${selected.length} ${selected.length === 1 ? "Favorit" : "Favoriten"} hinzugefügt`);
    });
  });

  elements.favoriteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = elements.favoriteText.value.trim();
    if (!text) return;

    await runAction(async () => {
      await createFavorite(text);
      resetFavoriteForm();
      showToast("Favorit gespeichert");
    });
  });

  elements.saveAsFavoriteButton.addEventListener("click", async () => {
    const text = elements.editItemText.value.trim();
    if (!text) return;
    await runAction(async () => {
      await createFavorite(text);
      showToast("Als Favorit gespeichert");
    });
  });

  elements.shareButton.addEventListener("click", showShareDialog);
  elements.copyInviteButton.addEventListener("click", copyInviteLink);

  elements.editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await updateShoppingItem(elements.editItemId.value, { item_text: elements.editItemText.value.trim() });
      closeEditDialog();
    });
  });

  elements.deleteItemButton.addEventListener("click", async () => {
    const id = elements.editItemId.value;
    if (!id || !confirm("Diesen Eintrag wirklich löschen?")) return;
    await runAction(async () => {
      await deleteShoppingItem(id);
      closeEditDialog();
    });
  });

  document.querySelector("[data-close-edit]").addEventListener("click", closeEditDialog);

  elements.deleteDoneButton.addEventListener("click", async () => {
    const { items, selectedDate } = getState();
    const done = items.filter((item) => item.shopping_date === selectedDate && item.is_done);
    if (!done.length || !confirm(`${done.length} erledigte Einträge löschen?`)) return;
    await runAction(async () => {
      for (const item of done) await deleteShoppingItem(item.id);
    });
  });

  window.addEventListener("online", synchronizeAfterReconnect);
  window.addEventListener("offline", () => setState({ online: false }));
}

async function synchronizeAfterReconnect() {
  const family = getState().family;
  if (!family) return;
  setState({ online: true, error: null });
  const synchronized = await flushPendingOperations();
  if (synchronized) {
    await loadShoppingItems(family.id);
    await loadFavorites(family.id);
  }
}

async function loadCurrentFamilyWithRetry(attempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const family = await getCurrentFamily();
      if (family) return family;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
  }
  if (lastError) throw lastError;
  return null;
}

function clearInviteFromAddress() {
  history.replaceState({}, "", `${location.pathname}${location.hash || ""}`);
}

async function enterFamily(family) {
  if (!family) throw new Error("Familie konnte nicht geladen werden.");
  setState({ family, loading: false, error: null });

  if (navigator.onLine) {
    const synchronized = await flushPendingOperations();
    if (synchronized) await loadShoppingItems(family.id);
    await loadFavorites(family.id);
  }

  await unsubscribe(realtimeChannel);
  await unsubscribe(favoritesChannel);
  realtimeChannel = subscribeToShoppingItems(family.id, (payload) => {
    if (payload.eventType === "DELETE") removeItemFromStore(payload.old.id);
    else if (payload.new) upsertItem(payload.new);
  });
  favoritesChannel = subscribeToFavorites(family.id, (payload) => {
    if (payload.eventType === "DELETE") removeFavoriteFromStore(payload.old.id);
    else if (payload.new) upsertFavorite(payload.new);
  });
}

async function runAction(action, showErrors = true) {
  try {
    setState({ error: null });
    await action();
  } catch (error) {
    const message = friendlyError(error);
    if (showErrors) showToast(message);
    setState({ error: message });
    console.error(error);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
  }
}

init();

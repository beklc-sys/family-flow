import {
  createFamily,
  ensureAnonymousSession,
  getCurrentFamily,
  joinFamily,
  subscribeToShoppingItems,
  unsubscribe
} from "./supabase.js";
import {
  addShoppingItem,
  deleteShoppingItem,
  flushPendingOperations,
  loadShoppingItems,
  updateShoppingItem
} from "./shopping.js";
import { getState, removeItemFromStore, setState, upsertItem } from "./store.js";
import {
  closeEditDialog,
  copyInviteLink,
  elements,
  friendlyError,
  getInviteTokenFromUrl,
  prepareInviteJoin,
  setSelectedDate,
  showShareDialog,
  showToast,
  startRendering
} from "./ui.js";

let realtimeChannel = null;

const handlers = {
  async onToggle(item) {
    await runAction(async () => {
      await updateShoppingItem(item.id, { is_done: !item.is_done });
    });
  }
};

async function init() {
  bindEvents();
  startRendering(handlers);
  prepareInviteJoin(getInviteTokenFromUrl());

  try {
    await ensureAnonymousSession();
    const family = await getCurrentFamily();

    if (!family) {
      setState({ family: null, loading: false, error: null });
      return;
    }

    await enterFamily(family);
  } catch (error) {
    setState({ loading: false, error: friendlyError(error) });
  }

  registerServiceWorker();
}

function bindEvents() {
  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await createFamily(elements.creatorName.value);
      const family = await getCurrentFamily();
      await enterFamily(family);
      showShareDialog();
    });
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await joinFamily(elements.inviteToken.value, elements.joinName.value);
      const family = await getCurrentFamily();
      await enterFamily(family);
      history.replaceState({}, "", window.location.pathname);
      showToast("Familie erfolgreich verbunden");
    });
  });

  elements.addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = elements.newItemText.value;
    if (!text.trim()) return;

    elements.newItemText.value = "";
    await runAction(async () => {
      await addShoppingItem(text);
      elements.newItemText.focus();
    });
  });

  elements.listDate.addEventListener("change", () => {
    if (elements.listDate.value) setSelectedDate(elements.listDate.value);
  });

  elements.shareButton.addEventListener("click", showShareDialog);
  elements.copyInviteButton.addEventListener("click", copyInviteLink);

  elements.editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(async () => {
      await updateShoppingItem(elements.editItemId.value, {
        item_text: elements.editItemText.value.trim()
      });
      closeEditDialog();
    });
  });

  elements.deleteItemButton.addEventListener("click", async () => {
    const id = elements.editItemId.value;
    if (!id || !window.confirm("Diesen Eintrag wirklich löschen?")) return;
    await runAction(async () => {
      await deleteShoppingItem(id);
      closeEditDialog();
    });
  });

  document.querySelector("[data-close-edit]").addEventListener("click", closeEditDialog);

  window.addEventListener("online", async () => {
    setState({ online: true, error: null });
    await runAction(flushPendingOperations, false);
    const family = getState().family;
    if (family) await runAction(() => loadShoppingItems(family.id), false);
  });

  window.addEventListener("offline", () => setState({ online: false }));
}

async function enterFamily(family) {
  if (!family) throw new Error("Familie konnte nicht geladen werden.");

  setState({ family, loading: false, error: null });

  if (navigator.onLine) {
    await loadShoppingItems(family.id);
    await flushPendingOperations();
  }

  await unsubscribe(realtimeChannel);
  realtimeChannel = subscribeToShoppingItems(family.id, (payload) => {
    if (payload.eventType === "DELETE") {
      removeItemFromStore(payload.old.id);
    } else if (payload.new) {
      upsertItem(payload.new);
    }
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
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(console.error);
    });
  }
}

init();

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
  registerServiceWorker();

  try {
    await ensureAnonymousSession();
    const family = await loadCurrentFamilyWithRetry(3);

    if (!family) {
      setState({ family: null, loading: false, error: null });
      return;
    }

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
      const family = await loadCurrentFamilyWithRetry();
      await enterFamily(family);
      showShareDialog();
    });
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = elements.joinForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Wird verbunden …";

    try {
      setState({ error: null });

      try {
        await joinFamily(elements.inviteToken.value, elements.joinName.value);
      } catch (error) {
        const message = error?.message || "";
        const alreadyJoined = message.includes("bereits zu einer Familie") || message.includes("already belongs");
        if (!alreadyJoined) throw error;
      }

      const family = await loadCurrentFamilyWithRetry();
      if (!family) throw new Error("Der Beitritt wurde gespeichert, aber die Familie konnte noch nicht geladen werden. Bitte die Seite neu laden.");

      await enterFamily(family);
      clearInviteFromAddress();
      showToast("Familie erfolgreich verbunden");
    } catch (error) {
      const message = friendlyError(error);
      showToast(message);
      setState({ error: message });
      console.error(error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Familie beitreten";
    }
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
    await synchronizeAfterReconnect();
  });

  window.addEventListener("offline", () => setState({ online: false }));
}

async function synchronizeAfterReconnect() {
  const family = getState().family;
  if (!family) return;

  const synchronized = await flushPendingOperations();
  if (synchronized) {
    await loadShoppingItems(family.id);
    setState({ error: null, online: true });
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

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  if (lastError) throw lastError;
  return null;
}

function clearInviteFromAddress() {
  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  history.replaceState({}, "", cleanUrl);
}

async function enterFamily(family) {
  if (!family) throw new Error("Familie konnte nicht geladen werden.");

  setState({ family, loading: false, error: null });

  if (navigator.onLine) {
    const synchronized = await flushPendingOperations();
    if (synchronized) await loadShoppingItems(family.id);
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const UPDATE_ANNOUNCEMENT_ID = "2026-03-mod-library-update";

const firebaseConfig = {
  apiKey: "AIzaSyBuLkEI4HXOtl6RTGNRXadflBu6YGsX9F8",
  authDomain: "skylanda-211e2.firebaseapp.com",
  projectId: "skylanda-211e2",
  storageBucket: "skylanda-211e2.firebasestorage.app",
  messagingSenderId: "225103922974",
  appId: "1:225103922974:web:c3761c5ce3201c8a466b0f",
  measurementId: "G-DJMF29LBWL"
};

const FIREBASE_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1";
const FIREBASE_TOKEN_BASE = "https://securetoken.googleapis.com/v1";
const REALTIME_DB_BASE = "https://skylanda-211e2-default-rtdb.firebaseio.com";

const AUTH_MODE_COPY = {
  login: {
    badge: "Prime access",
    title: "SkyLand hesabina giris yap",
    description: "Launcher, surumler ve profil kontrolun tek merkezde. Dogrudan gir, surum sec, oyuna gec."
  },
  register: {
    badge: "Yeni hesap",
    title: "Yeni bir SkyLand profili olustur",
    description: "Kullanici adini sabitle, profilini kaydet ve launcher oturumunu tek tikta hazir hale getir."
  }
};

const dom = {
  shell: document.querySelector("#shell"),
  authScreen: document.querySelector("#authScreen"),
  launcherScreen: document.querySelector("#launcherScreen"),
  authModeBadge: document.querySelector("#authModeBadge"),
  authModeTitle: document.querySelector("#authModeTitle"),
  authModeDescription: document.querySelector("#authModeDescription"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  authMessage: document.querySelector("#authMessage"),
  tabButtons: document.querySelectorAll("[data-auth-mode]"),
  resendVerificationButton: document.querySelector("#resendVerificationButton"),
  sessionUserLabel: document.querySelector("#sessionUserLabel"),
  sessionExpiryLabel: document.querySelector("#sessionExpiryLabel"),
  profileForm: document.querySelector("#profileForm"),
  launcherUsernameInput: document.querySelector("#launcherUsernameInput"),
  displayNameInput: document.querySelector("#displayNameInput"),
  mcNicknameInput: document.querySelector("#mcNicknameInput"),
  skinPreview: document.querySelector("#skinPreview"),
  versionSelect: document.querySelector("#versionSelect"),
  versionTypeBadge: document.querySelector("#versionTypeBadge"),
  versionSourceBadge: document.querySelector("#versionSourceBadge"),
  versionInstallBadge: document.querySelector("#versionInstallBadge"),
  modsSearchForm: document.querySelector("#modsSearchForm"),
  modSearchInput: document.querySelector("#modSearchInput"),
  modLoaderSelect: document.querySelector("#modLoaderSelect"),
  searchModsButton: document.querySelector("#searchModsButton"),
  modsVersionBadge: document.querySelector("#modsVersionBadge"),
  modsLoaderBadge: document.querySelector("#modsLoaderBadge"),
  modsCountBadge: document.querySelector("#modsCountBadge"),
  modsGameDirLabel: document.querySelector("#modsGameDirLabel"),
  modsNotice: document.querySelector("#modsNotice"),
  modsGrid: document.querySelector("#modsGrid"),
  installedModsVersionBadge: document.querySelector("#installedModsVersionBadge"),
  installedModsLoaderBadge: document.querySelector("#installedModsLoaderBadge"),
  installedModsCountBadge: document.querySelector("#installedModsCountBadge"),
  installedModsNotice: document.querySelector("#installedModsNotice"),
  installedModsGrid: document.querySelector("#installedModsGrid"),
  refreshInstalledModsButton: document.querySelector("#refreshInstalledModsButton"),
  checkInstalledUpdatesButton: document.querySelector("#checkInstalledUpdatesButton"),
  clearInstalledModsButton: document.querySelector("#clearInstalledModsButton"),
  refreshVersionsButton: document.querySelector("#refreshVersionsButton"),
  playButton: document.querySelector("#playButton"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  progressFill: document.querySelector("#progressFill"),
  launchNotice: document.querySelector("#launchNotice"),
  settingsSummary: document.querySelector("#settingsSummary"),
  logList: document.querySelector("#logList"),
  logoutButton: document.querySelector("#logoutButton"),
  updateAnnouncementModal: document.querySelector("#updateAnnouncementModal"),
  dismissUpdateAnnouncementButton: document.querySelector("#dismissUpdateAnnouncementButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsForm: document.querySelector("#settingsForm"),
  openSettingsButton: document.querySelector("#openSettingsButton"),
  launcherNavButtons: document.querySelectorAll("[data-launcher-view]"),
  launcherViews: document.querySelectorAll("[data-view-panel]"),
  pickJavaButton: document.querySelector("#pickJavaButton"),
  pickGameDirButton: document.querySelector("#pickGameDirButton"),
  launchOverlay: document.querySelector("#launchOverlay"),
  launchOverlayText: document.querySelector("#launchOverlayText"),
  launchOverlayFill: document.querySelector("#launchOverlayFill")
};

const appState = {
  bootstrap: null,
  settings: null,
  profile: null,
  session: null,
  announcements: {
    seenIds: []
  },
  versions: [],
  currentUser: null,
  launcherView: "play",
  updateAnnouncementVisible: false,
  mods: {
    items: [],
    totalHits: 0,
    loading: false,
    searchedOnce: false,
    installingProjectId: null,
    installedProjectIds: new Set(),
    installedItems: [],
    installedLoading: false,
    installedChecking: false,
    removingInstallId: null,
    clearingInstalled: false
  }
};

function normalizeUsername(value) {
  return `${value ?? ""}`.trim().toLowerCase().replace(/\s+/g, "");
}

function sanitizeMcNickname(value, fallback = "SkylandTiger") {
  const cleaned = `${value ?? ""}`.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  return cleaned || fallback;
}

function normalizeModLoader(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (normalized === "neo-forge") {
    return "neoforge";
  }
  return ["fabric", "forge", "quilt", "neoforge"].includes(normalized) ? normalized : null;
}

function inferMinecraftVersionId(selectedVersion) {
  const directCandidates = [selectedVersion?.baseVersion, selectedVersion?.id, selectedVersion?.customId]
    .map((value) => `${value ?? ""}`.trim())
    .filter(Boolean);

  for (const candidate of directCandidates) {
    if (/^\d+\.\d+(?:\.\d+)?$/i.test(candidate) || /^\d{2}w\d{2}[a-z]$/i.test(candidate)) {
      return candidate;
    }
  }

  const fingerprint = directCandidates.join(" ");
  const releaseMatch = fingerprint.match(/\b1\.\d+(?:\.\d+)?\b/i);
  if (releaseMatch) {
    return releaseMatch[0];
  }

  const snapshotMatch = fingerprint.match(/\b\d{2}w\d{2}[a-z]\b/i);
  if (snapshotMatch) {
    return snapshotMatch[0];
  }

  return directCandidates[0] || null;
}

function inferVersionModLoader(selectedVersion, requestedLoader = null) {
  const explicitLoader = normalizeModLoader(requestedLoader);
  if (explicitLoader) {
    return explicitLoader;
  }

  const fingerprint = [
    selectedVersion?.type,
    selectedVersion?.customId,
    selectedVersion?.baseVersion,
    selectedVersion?.id,
    selectedVersion?.label
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (fingerprint.includes("neo forge")) {
    return "neoforge";
  }

  for (const loader of ["fabric", "forge", "quilt", "neoforge"]) {
    if (fingerprint.includes(loader)) {
      return loader;
    }
  }

  return null;
}

function capitalizeWord(value) {
  const text = `${value ?? ""}`.trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "-";
}

function buildProjectMetaFromItem(item) {
  if (!item?.projectId) {
    return null;
  }

  return {
    slug: item.slug || "",
    title: item.title || item.projectId,
    description: item.description || "",
    iconUrl: item.iconUrl || "",
    author: item.author || ""
  };
}

function getLoaderBadgeLabel(context, mode = "search") {
  if (context.effectiveLoader) {
    return capitalizeWord(context.effectiveLoader);
  }

  if (context.selectedLoader) {
    return capitalizeWord(context.selectedLoader);
  }

  if (context.requestedLoader === "auto") {
    return mode === "installed" ? "Tum loaderlar" : "Otomatik";
  }

  return "-";
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("tr-TR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value) || 0);
}

function buildModCardMedia(item) {
  const media = document.createElement("div");
  media.className = "mod-card-media";

  if (item.iconUrl) {
    const image = document.createElement("img");
    image.src = item.iconUrl;
    image.alt = `${item.title} logosu`;
    image.loading = "lazy";
    media.append(image);
    return media;
  }

  const fallback = document.createElement("div");
  fallback.className = "mod-card-fallback";
  fallback.textContent = (item.title || "M").slice(0, 2).toUpperCase();
  media.append(fallback);
  return media;
}

function playEntrance(element) {
  if (!element) {
    return;
  }

  element.classList.remove("screen-reveal");
  void element.offsetWidth;
  element.classList.add("screen-reveal");
}

function hasSeenAnnouncement(announcementId) {
  return Boolean(announcementId) && (appState.announcements?.seenIds || []).includes(announcementId);
}

function showUpdateAnnouncement() {
  if (!dom.updateAnnouncementModal || hasSeenAnnouncement(UPDATE_ANNOUNCEMENT_ID)) {
    return;
  }

  appState.updateAnnouncementVisible = true;
  dom.updateAnnouncementModal.classList.remove("hidden");
}

function hideUpdateAnnouncement() {
  if (!dom.updateAnnouncementModal) {
    return;
  }

  appState.updateAnnouncementVisible = false;
  dom.updateAnnouncementModal.classList.add("hidden");
}

function maybeShowUpdateAnnouncement() {
  if (appState.updateAnnouncementVisible || hasSeenAnnouncement(UPDATE_ANNOUNCEMENT_ID)) {
    return;
  }

  showUpdateAnnouncement();
}

function showMessage(message, type = "info") {
  dom.authMessage.textContent = message;
  dom.authMessage.classList.remove("hidden", "error", "success");
  if (type === "error") {
    dom.authMessage.classList.add("error");
  }
  if (type === "success") {
    dom.authMessage.classList.add("success");
  }
}

function clearMessage() {
  dom.authMessage.classList.add("hidden");
  dom.authMessage.classList.remove("error", "success");
  dom.authMessage.textContent = "";
}

function addLogEntry(message) {
  if (!dom.logList) {
    return;
  }
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${new Date().toLocaleTimeString("tr-TR")}] ${message}`;
  dom.logList.prepend(entry);
}

function showLaunchNotice(message, type = "info") {
  if (!dom.launchNotice) {
    return;
  }

  dom.launchNotice.textContent = message;
  dom.launchNotice.classList.remove("hidden", "error", "success");
  if (type === "error") {
    dom.launchNotice.classList.add("error");
  }
  if (type === "success") {
    dom.launchNotice.classList.add("success");
  }
}

function clearLaunchNotice() {
  if (!dom.launchNotice) {
    return;
  }

  dom.launchNotice.textContent = "";
  dom.launchNotice.classList.add("hidden");
  dom.launchNotice.classList.remove("error", "success");
}

function showModsNotice(message, type = "info") {
  if (!dom.modsNotice) {
    return;
  }

  dom.modsNotice.textContent = message;
  dom.modsNotice.classList.remove("hidden", "error", "success");
  if (type === "error") {
    dom.modsNotice.classList.add("error");
  }
  if (type === "success") {
    dom.modsNotice.classList.add("success");
  }
}

function clearModsNotice() {
  if (!dom.modsNotice) {
    return;
  }

  dom.modsNotice.textContent = "";
  dom.modsNotice.classList.add("hidden");
  dom.modsNotice.classList.remove("error", "success");
}

function showInstalledModsNotice(message, type = "info") {
  if (!dom.installedModsNotice) {
    return;
  }

  dom.installedModsNotice.textContent = message;
  dom.installedModsNotice.classList.remove("hidden", "error", "success");
  if (type === "error") {
    dom.installedModsNotice.classList.add("error");
  }
  if (type === "success") {
    dom.installedModsNotice.classList.add("success");
  }
}

function clearInstalledModsNotice() {
  if (!dom.installedModsNotice) {
    return;
  }

  dom.installedModsNotice.textContent = "";
  dom.installedModsNotice.classList.add("hidden");
  dom.installedModsNotice.classList.remove("error", "success");
}

function formatLaunchErrorMessage(error) {
  const message = `${error?.message ?? error ?? ""}`;
  if (message.includes("Java paketi bozuk indi")) {
    return "Java paketi bozuk indi. Launcher yeniden indirecek; sorun devam ederse antivirusu veya baglantiyi kontrol et.";
  }
  if (message.includes("Kurulan Java icinde javaw.exe bulunamadi")) {
    return "Java kuruldu ama javaw.exe bulunamadi. Launcher yeni kurulum deneyecek.";
  }
  return message || "Minecraft baslatilamadi.";
}

function setProgress(progress, label) {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  dom.progressFill.style.width = `${percent}%`;
  dom.progressPercent.textContent = `${percent}%`;
  dom.launchOverlayFill.style.width = `${percent}%`;
  if (label) {
    dom.progressLabel.textContent = label;
    dom.launchOverlayText.textContent = label;
  }
}

function showLaunchOverlay(label = "Dosyalar kontrol ediliyor...") {
  dom.launchOverlay.classList.remove("hidden");
  dom.launchOverlayText.textContent = label;
}

function hideLaunchOverlay() {
  dom.launchOverlay.classList.add("hidden");
}

function toggleAuthMode(mode) {
  const nextForm = mode === "login" ? dom.loginForm : dom.registerForm;
  const currentForm = mode === "login" ? dom.registerForm : dom.loginForm;
  const copy = AUTH_MODE_COPY[mode] || AUTH_MODE_COPY.login;

  dom.authScreen.dataset.mode = mode;
  dom.authModeBadge.textContent = copy.badge;
  dom.authModeTitle.textContent = copy.title;
  dom.authModeDescription.textContent = copy.description;

  dom.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });

  currentForm.classList.add("hidden");
  currentForm.classList.remove("form-pop");
  nextForm.classList.remove("hidden");
  nextForm.classList.remove("form-pop");

  window.requestAnimationFrame(() => {
    playEntrance(dom.authScreen.querySelector(".showcase-panel"));
    nextForm.classList.add("form-pop");
  });

  clearMessage();
}

function getSkinUrl(nickname) {
  const safeNickname = `${nickname ?? ""}`.trim() || "Steve";
  return `https://mc-heads.net/body/${encodeURIComponent(safeNickname)}/right`;
}

function updateSkinPreview() {
  dom.skinPreview.src = getSkinUrl(dom.mcNicknameInput.value);
}

function sessionIsActive(session) {
  return Boolean(session?.expiryAt) && Date.now() < session.expiryAt;
}

function formatSessionExpiry(expiryAt) {
  return expiryAt ? `Aktif bitis: ${new Date(expiryAt).toLocaleString("tr-TR")}` : "Oturum kapali";
}

function renderSettingsSummary() {
  if (!dom.settingsSummary) {
    return;
  }

  const settings = appState.settings;
  const items = [
    { label: "RAM", value: `${settings.ramMb} MB / min ${settings.minRamMb} MB` },
    { label: "Dil", value: settings.language },
    { label: "Snapshot", value: settings.showSnapshots ? "Acik" : "Kapali" },
    { label: "Ekran", value: settings.fullscreen ? "Tam ekran" : "Pencereli" },
    { label: "Cozunurluk", value: `${settings.resolutionWidth} x ${settings.resolutionHeight}` },
    { label: "Java", value: settings.javaPath || "Sistem varsayilani" },
    { label: "Klasor", value: settings.gameDir }
  ];

  dom.settingsSummary.innerHTML = items
    .map(
      (item) => `
        <div class="setting-chip">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </div>
      `
    )
    .join("");
}

function fillSettingsForm() {
  const form = dom.settingsForm.elements;
  form.ramMb.value = appState.settings.ramMb;
  form.minRamMb.value = appState.settings.minRamMb;
  form.language.value = appState.settings.language;
  form.fullscreen.value = String(appState.settings.fullscreen);
  form.resolutionWidth.value = appState.settings.resolutionWidth;
  form.resolutionHeight.value = appState.settings.resolutionHeight;
  form.showSnapshots.value = String(Boolean(appState.settings.showSnapshots));
  form.javaPath.value = appState.settings.javaPath || "";
  form.gameDir.value = appState.settings.gameDir;
}

function fillProfileForm() {
  dom.launcherUsernameInput.value = appState.profile.launcherUsername || "";
  dom.displayNameInput.value = appState.profile.displayName || "";
  dom.mcNicknameInput.value = appState.profile.mcNickname || "SkylandTiger";
  updateSkinPreview();
}

function setLauncherView(viewName) {
  appState.launcherView = viewName;
  dom.launcherNavButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.launcherView === viewName);
  });

  dom.launcherViews.forEach((view) => {
    const isActive = view.dataset.viewPanel === viewName;
    view.classList.toggle("hidden", !isActive);
    if (isActive) {
      playEntrance(view);
    }
  });

  if (viewName === "mods") {
    renderModsMeta();
    loadInstalledMods().catch((error) => {
      showInstalledModsNotice(`Kurulu modlar yuklenemedi: ${error.message}`, "error");
    });
    if (!appState.mods.searchedOnce) {
      loadMods().catch((error) => {
        showModsNotice(`Modlar yuklenemedi: ${error.message}`, "error");
      });
    }
  }
}

function updateSessionHeader() {
  const name = appState.profile.displayName || appState.profile.launcherUsername || "Misafir";
  dom.sessionUserLabel.textContent = name;
  dom.sessionExpiryLabel.textContent = formatSessionExpiry(appState.session?.expiryAt);
}

function getVersionSelectionKey(version) {
  if (!version?.id) {
    return "";
  }

  return `${version.id}::${version.source || ""}::${version.root ?? ""}:${version.customId ?? ""}`;
}

function selectVersionByKey(selectionKey) {
  if (!selectionKey || !dom.versionSelect) {
    return false;
  }

  const nextIndex = Array.from(dom.versionSelect.options).findIndex((option) => {
    const optionKey = `${option.value}::${option.dataset.source || ""}::${option.dataset.variant || ""}`;
    return optionKey === selectionKey;
  });

  if (nextIndex < 0) {
    return false;
  }

  dom.versionSelect.selectedIndex = nextIndex;
  updateVersionMeta();
  return true;
}

function findLaunchVersionFor(gameVersion, loader = null) {
  const normalizedLoader = normalizeModLoader(loader);
  if (!gameVersion) {
    return null;
  }

  if (normalizedLoader) {
    return (
      appState.versions.find(
        (item) => item.managedLoader === normalizedLoader && inferMinecraftVersionId(item) === gameVersion
      ) ||
      appState.versions.find(
        (item) => inferVersionModLoader(item) === normalizedLoader && inferMinecraftVersionId(item) === gameVersion
      ) ||
      null
    );
  }

  return (
    appState.versions.find(
      (item) => !item.managedLoader && !inferVersionModLoader(item) && inferMinecraftVersionId(item) === gameVersion
    ) || null
  );
}

function getSelectedVersion() {
  const selectedOption = dom.versionSelect.selectedOptions[0];
  if (!selectedOption) {
    return null;
  }

  return (
    appState.versions.find(
      (item) =>
        item.id === selectedOption.value &&
        item.source === selectedOption.dataset.source &&
        `${item.root ?? ""}:${item.customId ?? ""}` === selectedOption.dataset.variant
    ) || null
  );
}

function updateVersionMeta() {
  const selected = getSelectedVersion();
  if (!selected) {
    dom.versionTypeBadge.textContent = "-";
    dom.versionSourceBadge.textContent = "-";
    dom.versionInstallBadge.textContent = "-";
    renderModsMeta();
    renderInstalledModsMeta();
    return;
  }

  dom.versionTypeBadge.textContent = selected.managedLoader ? capitalizeWord(selected.managedLoader) : selected.type;
  dom.versionSourceBadge.textContent = selected.managedLoader
    ? "Yonetilen modlu"
    : selected.source === "official"
      ? "Mojang"
      : "Yerel";
  dom.versionInstallBadge.textContent = selected.managedLoader
    ? `${capitalizeWord(selected.managedLoader)} hazir`
    : selected.installed
      ? "Hazir"
      : "Indirilecek";
  renderModsMeta();
  renderInstalledModsMeta();
}

function getModsContext() {
  const selectedVersion = getSelectedVersion();
  const requestedLoader = dom.modLoaderSelect?.value || "auto";
  const selectedLoader = normalizeModLoader(selectedVersion?.managedLoader) || inferVersionModLoader(selectedVersion);
  const effectiveLoader =
    normalizeModLoader(requestedLoader) ||
    normalizeModLoader(selectedVersion?.managedLoader) ||
    inferVersionModLoader(selectedVersion, requestedLoader);
  const gameVersion = inferMinecraftVersionId(selectedVersion);

  return {
    selectedVersion,
    gameVersion,
    selectedLoader,
    effectiveLoader,
    requestedLoader,
    installReady: Boolean(selectedLoader && effectiveLoader && selectedLoader === effectiveLoader)
  };
}

function getModsStatusMessage(context) {
  if (!context.selectedVersion) {
    return {
      type: "error",
      message: "Modlari listelemek icin once bir Minecraft surumu sec."
    };
  }

  if (!context.gameVersion) {
    return {
      type: "error",
      message: "Secili surumun Minecraft numarasi anlasilamadi."
    };
  }

  if (!context.selectedLoader) {
    if (context.requestedLoader === "auto") {
      return {
        type: "info",
        message: `Secili surum vanilla gorunuyor. Kurulumda modun loader tipi tespit edilecek; Fabric veya Forge ise otomatik hazirlanip oyun onunla acilacak.`
      };
    }

    if (context.effectiveLoader === "fabric" || context.effectiveLoader === "forge") {
      return {
        type: "info",
        message: `Secili surum vanilla gorunuyor. ${capitalizeWord(context.effectiveLoader)} gerekli oldugunda mod kurulurken otomatik hazirlanacak ve oyun ${capitalizeWord(context.effectiveLoader)} ile acilacak.`
      };
    }

    return {
      type: "info",
      message: `Secili surum vanilla gorunuyor. Simdilik otomatik loader kurulumu sadece Fabric ve Forge icin acik.`
    };
  }

  if (context.effectiveLoader && context.selectedLoader !== context.effectiveLoader) {
    return {
      type: "info",
      message: `Secili surum ${capitalizeWord(context.selectedLoader)}. Filtre ise ${capitalizeWord(context.effectiveLoader)} olarak duruyor; kurulumda uyumsuzluk olabilir.`
    };
  }

  return null;
}

function renderModsMeta() {
  if (!dom.modsVersionBadge) {
    return;
  }

  const context = getModsContext();
  dom.modsVersionBadge.textContent = context.gameVersion || context.selectedVersion?.id || "-";
  dom.modsLoaderBadge.textContent = getLoaderBadgeLabel(context, "search");
  dom.modsCountBadge.textContent = appState.mods.loading
    ? "Yukleniyor..."
    : `${appState.mods.items.length} / ${appState.mods.totalHits || 0}`;
  dom.modsGameDirLabel.textContent = appState.settings?.gameDir || "-";

  const status = getModsStatusMessage(context);
  if (!status) {
    return;
  }

  if (!appState.mods.loading) {
    showModsNotice(status.message, status.type);
  }
}

function renderInstalledModsMeta() {
  if (!dom.installedModsVersionBadge) {
    return;
  }

  const context = getModsContext();
  const busy =
    appState.mods.installedLoading ||
    appState.mods.installedChecking ||
    appState.mods.clearingInstalled ||
    Boolean(appState.mods.removingInstallId) ||
    Boolean(appState.mods.installingProjectId);

  dom.installedModsVersionBadge.textContent = context.gameVersion || context.selectedVersion?.id || "-";
  dom.installedModsLoaderBadge.textContent = getLoaderBadgeLabel(context, "installed");
  dom.installedModsCountBadge.textContent = appState.mods.installedLoading
    ? "Yukleniyor..."
    : appState.mods.installedChecking
      ? "Kontrol..."
      : `${appState.mods.installedItems.length}`;

  if (dom.refreshInstalledModsButton) {
    dom.refreshInstalledModsButton.disabled = busy || !context.selectedVersion;
  }
  if (dom.checkInstalledUpdatesButton) {
    dom.checkInstalledUpdatesButton.disabled = busy || !context.selectedVersion || !appState.mods.installedItems.length;
  }
  if (dom.clearInstalledModsButton) {
    dom.clearInstalledModsButton.disabled = busy || !appState.mods.installedItems.length;
  }
}

function renderModsGrid() {
  if (!dom.modsGrid) {
    return;
  }

  dom.modsGrid.innerHTML = "";

  if (appState.mods.loading) {
    const state = document.createElement("div");
    state.className = "mods-empty-state";
    state.textContent = "Modrinth modlari yukleniyor...";
    dom.modsGrid.append(state);
    renderModsMeta();
    return;
  }

  if (!appState.mods.items.length) {
    const state = document.createElement("div");
    state.className = "mods-empty-state";
    state.textContent = appState.mods.searchedOnce
      ? "Bu filtrelerle mod bulunamadi."
      : "Modlari listelemek icin yukaridan ara veya sekmeyi ac.";
    dom.modsGrid.append(state);
    renderModsMeta();
    return;
  }

  for (const item of appState.mods.items) {
    const card = document.createElement("article");
    card.className = "mod-card";

    const media = buildModCardMedia(item);

    const body = document.createElement("div");
    body.className = "mod-card-body";

    const head = document.createElement("div");
    head.className = "mod-card-head";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const author = document.createElement("div");
    author.className = "mod-card-author";
    author.textContent = `Gelistirici: ${item.author}`;
    head.append(title, author);

    const description = document.createElement("p");
    description.className = "mod-card-description";
    description.textContent = item.description || "Aciklama yok.";

    const stats = document.createElement("div");
    stats.className = "mod-card-stats";
    const downloadStat = document.createElement("span");
    downloadStat.className = "mod-stat";
    downloadStat.innerHTML = `<strong>${formatCompactNumber(item.downloads)}</strong> indirme`;
    const followStat = document.createElement("span");
    followStat.className = "mod-stat";
    followStat.innerHTML = `<strong>${formatCompactNumber(item.followers)}</strong> takip`;
    stats.append(downloadStat, followStat);

    const categories = document.createElement("div");
    categories.className = "mod-card-categories";
    for (const category of (item.categories || []).slice(0, 4)) {
      const chip = document.createElement("span");
      chip.className = "mod-chip";
      chip.textContent = category;
      categories.append(chip);
    }

    const actions = document.createElement("div");
    actions.className = "mod-card-actions";
    const installButton = document.createElement("button");
    const installing = appState.mods.installingProjectId === item.projectId;
    const installBusy =
      Boolean(appState.mods.installingProjectId) ||
      Boolean(appState.mods.removingInstallId) ||
      appState.mods.clearingInstalled;
    installButton.type = "button";
    installButton.className = "primary-button";
    installButton.dataset.installMod = item.projectId;
    installButton.disabled = installBusy;
    installButton.textContent = installing
      ? "Kuruluyor..."
      : item.installed && !item.hasUpdate
        ? "Oyna"
        : appState.mods.installedProjectIds.has(item.projectId) || item.installed
        ? "Guncelle"
        : "Indir";

    const pageButton = document.createElement("button");
    pageButton.type = "button";
    pageButton.className = "ghost-button";
    pageButton.dataset.openUrl = `https://modrinth.com/mod/${item.slug}`;
    pageButton.textContent = "Sayfa";

    actions.append(installButton, pageButton);
    body.append(head, description, stats);
    if (categories.childNodes.length) {
      body.append(categories);
    }
    body.append(actions);
    card.append(media, body);
    dom.modsGrid.append(card);
  }

  renderModsMeta();
}

function renderInstalledModsGrid() {
  if (!dom.installedModsGrid) {
    return;
  }

  dom.installedModsGrid.innerHTML = "";

  if (appState.mods.installedLoading || appState.mods.installedChecking) {
    const state = document.createElement("div");
    state.className = "mods-empty-state";
    state.textContent = appState.mods.installedChecking
      ? "Kurulu modlar icin guncelleme kontrolu yapiliyor..."
      : "Kurulu modlar yukleniyor...";
    dom.installedModsGrid.append(state);
    renderInstalledModsMeta();
    return;
  }

  const context = getModsContext();
  if (!context.selectedVersion) {
    const state = document.createElement("div");
    state.className = "mods-empty-state";
    state.textContent = "Kurulu modlari gormek icin once bir Minecraft surumu sec.";
    dom.installedModsGrid.append(state);
    renderInstalledModsMeta();
    return;
  }

  if (!appState.mods.installedItems.length) {
    const state = document.createElement("div");
    state.className = "mods-empty-state";
    state.textContent = "Bu filtre icin kurulu mod yok.";
    dom.installedModsGrid.append(state);
    renderInstalledModsMeta();
    return;
  }

  for (const item of appState.mods.installedItems) {
    const card = document.createElement("article");
    card.className = "mod-card installed-mod-card";

    const media = buildModCardMedia(item);

    const body = document.createElement("div");
    body.className = "mod-card-body";

    const head = document.createElement("div");
    head.className = "mod-card-head";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const author = document.createElement("div");
    author.className = "mod-card-author";
    author.textContent = `${item.gameVersion || "-"} • ${capitalizeWord(item.loader || "loader")}`;
    head.append(title, author);

    const description = document.createElement("p");
    description.className = "mod-card-description";
    description.textContent = item.description || "Bu mod bu surum icin kutuphanede hazir.";

    const stats = document.createElement("div");
    stats.className = "mod-card-stats";

    const versionStat = document.createElement("span");
    versionStat.className = "mod-stat";
    versionStat.innerHTML = `<strong>${item.versionNumber || "-"}</strong> kurulu`;
    stats.append(versionStat);

    const loaderStat = document.createElement("span");
    loaderStat.className = "mod-stat";
    loaderStat.innerHTML = `<strong>${capitalizeWord(item.loader || "-")}</strong> loader`;
    stats.append(loaderStat);

    if (item.hasUpdate && item.latestKnownVersionNumber) {
      const updateStat = document.createElement("span");
      updateStat.className = "mod-stat";
      updateStat.innerHTML = `<strong>${item.latestKnownVersionNumber}</strong> yeni surum`;
      stats.append(updateStat);
    } else if (item.updateChecked) {
      const freshStat = document.createElement("span");
      freshStat.className = "mod-stat";
      freshStat.innerHTML = "<strong>Guncel</strong> durum";
      stats.append(freshStat);
    }

    const actions = document.createElement("div");
    actions.className = "mod-card-actions";
    const busy =
      Boolean(appState.mods.installingProjectId) ||
      Boolean(appState.mods.removingInstallId) ||
      appState.mods.clearingInstalled ||
      appState.mods.installedLoading ||
      appState.mods.installedChecking;

    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = item.hasUpdate ? "primary-button" : "ghost-button";
    updateButton.dataset.updateInstalledMod = item.projectId;
    updateButton.disabled = busy || !item.hasUpdate;
    updateButton.textContent =
      appState.mods.installingProjectId === item.projectId
        ? "Guncelleniyor..."
        : item.hasUpdate
          ? "Guncelle"
          : item.updateChecked
            ? "Guncel"
            : "Kontrol bekliyor";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost-button";
    removeButton.dataset.removeInstalledMod = item.installId;
    removeButton.disabled = busy;
    removeButton.textContent =
      appState.mods.removingInstallId === item.installId ? "Siliniyor..." : "Sil";

    actions.append(updateButton, removeButton);

    if (item.pageUrl) {
      const pageButton = document.createElement("button");
      pageButton.type = "button";
      pageButton.className = "ghost-button";
      pageButton.dataset.openUrl = item.pageUrl;
      pageButton.textContent = "Sayfa";
      pageButton.disabled = busy;
      actions.append(pageButton);
    }

    body.append(head, description, stats);

    if (item.updateError) {
      const note = document.createElement("p");
      note.className = "mod-card-note";
      note.textContent = item.updateError;
      body.append(note);
    }

    body.append(actions);
    card.append(media, body);
    dom.installedModsGrid.append(card);
  }

  renderInstalledModsMeta();
}

function renderVersionOptions(preferredSelectionKey = "") {
  dom.versionSelect.innerHTML = "";

  if (!appState.versions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Surum bulunamadi";
    dom.versionSelect.append(option);
    dom.versionSelect.disabled = true;
    dom.playButton.disabled = true;
    updateVersionMeta();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const version of appState.versions) {
    const option = document.createElement("option");
    option.value = version.id;
    option.dataset.source = version.source;
    option.dataset.variant = `${version.root ?? ""}:${version.customId ?? ""}`;
    option.textContent = version.label;
    fragment.append(option);
  }

  dom.versionSelect.append(fragment);
  dom.versionSelect.disabled = false;
  dom.playButton.disabled = false;

  const nextIndex = Array.from(dom.versionSelect.options).findIndex((option) => {
    const optionKey = `${option.value}::${option.dataset.source || ""}::${option.dataset.variant || ""}`;
    return optionKey === preferredSelectionKey;
  });

  if (nextIndex >= 0) {
    dom.versionSelect.selectedIndex = nextIndex;
  } else if (dom.versionSelect.options.length > 0) {
    dom.versionSelect.selectedIndex = 0;
  }

  updateVersionMeta();
}

function setShellScene(scene) {
  dom.shell.dataset.scene = scene;
}

function openAuthScreen() {
  setShellScene("auth");
  hideUpdateAnnouncement();
  dom.authScreen.classList.remove("hidden");
  dom.launcherScreen.classList.add("hidden");
  playEntrance(dom.authScreen);
}

function openLauncherScreen() {
  setShellScene("launcher");
  dom.authScreen.classList.add("hidden");
  dom.launcherScreen.classList.remove("hidden");
  setLauncherView("play");
  playEntrance(dom.launcherScreen);
  maybeShowUpdateAnnouncement();
}

async function saveLocalSession(user) {
  appState.session = {
    expiryAt: Date.now() + THIRTY_DAYS_MS,
    user
  };
  await window.skylandAPI.saveSession(appState.session);
  updateSessionHeader();
}

async function clearLocalSession() {
  appState.session = {
    expiryAt: 0,
    user: null
  };
  await window.skylandAPI.clearSession();
  updateSessionHeader();
}

async function dismissUpdateAnnouncement() {
  const nextAnnouncements = await window.skylandAPI.markAnnouncementSeen(UPDATE_ANNOUNCEMENT_ID);
  appState.announcements = {
    seenIds: Array.from(new Set(nextAnnouncements?.seenIds || [UPDATE_ANNOUNCEMENT_ID]))
  };
  hideUpdateAnnouncement();
}

function firebaseErrorMessage(error) {
  const message = `${error?.message ?? error ?? ""}`;
  if (message.includes("EMAIL_EXISTS")) {
    return "Bu e-posta zaten kayitli.";
  }
  if (message.includes("EMAIL_NOT_FOUND") || message.includes("INVALID_LOGIN_CREDENTIALS")) {
    return "Kullanici adi veya sifre hatali.";
  }
  if (message.includes("INVALID_PASSWORD")) {
    return "Sifre hatali.";
  }
  if (message.includes("USER_DISABLED")) {
    return "Bu hesap devre disi.";
  }
  if (message.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
    return "Cok fazla deneme yapildi, biraz sonra tekrar dene.";
  }
  if (message.includes("WEAK_PASSWORD")) {
    return "Sifre daha guclu olmali.";
  }
  if (message.includes("Permission denied") || message.includes("Missing or insufficient permissions")) {
    return "Firebase Realtime Database izinleri kapali. Sana biraktigim database.rules.json kurallarini yayinla.";
  }
  if (message.includes("Java paketi bozuk indi")) {
    return "Gerekli Java paketi bozuk indi. Launcher tekrar indirecek; olmuyorsa internet veya antivirusu kontrol et.";
  }
  return message || "Bilinmeyen Firebase hatasi.";
}

async function postJson(url, body, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || response.statusText);
  }
  return data;
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body).toString()
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || response.statusText);
  }
  return data;
}

function realtimeDbUrl(pathSuffix, token) {
  const safePath = pathSuffix.replace(/^\/+/, "");
  const query = token ? `?auth=${encodeURIComponent(token)}` : "";
  return `${REALTIME_DB_BASE}/${safePath}.json${query}`;
}

async function realtimeGet(pathSuffix, token) {
  const response = await fetch(realtimeDbUrl(pathSuffix, token));
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || response.statusText);
  }
  return data;
}

async function realtimePatch(pathSuffix, payload, token) {
  const response = await fetch(realtimeDbUrl(pathSuffix, token), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || response.statusText);
  }
  return data;
}

function authUrl(endpoint) {
  return `${FIREBASE_AUTH_BASE}/${endpoint}?key=${firebaseConfig.apiKey}`;
}

async function authSignUp(email, password) {
  return postJson(authUrl("accounts:signUp"), {
    email,
    password,
    returnSecureToken: true
  });
}

async function authSignIn(email, password) {
  return postJson(authUrl("accounts:signInWithPassword"), {
    email,
    password,
    returnSecureToken: true
  });
}

async function authSendVerification(idToken) {
  return postJson(authUrl("accounts:sendOobCode"), {
    requestType: "VERIFY_EMAIL",
    idToken
  });
}

async function authLookup(idToken) {
  const payload = await postJson(authUrl("accounts:lookup"), { idToken });
  return payload.users?.[0] ?? null;
}

async function authRefresh(refreshToken) {
  return postForm(`${FIREBASE_TOKEN_BASE}/token?key=${firebaseConfig.apiKey}`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
}

async function authDeleteAccount(idToken) {
  return postJson(authUrl("accounts:delete"), { idToken });
}

async function writeRemoteUserBootstrap(authResult, { username, displayName, email, mcNickname }) {
  const now = new Date().toISOString();

  return realtimePatch(
    "",
    {
      [`usernames/${normalizeUsername(username)}`]: {
        uid: authResult.localId,
        email,
        username,
        createdAt: now
      },
      [`launcherUsers/${authResult.localId}`]: {
        username,
        usernameLower: normalizeUsername(username),
        displayName,
        email,
        mcNickname,
        createdAt: now,
        updatedAt: now
      }
    },
    authResult.idToken
  );
}

async function loadVersions(preferredSelectionKey = getVersionSelectionKey(getSelectedVersion())) {
  dom.refreshVersionsButton.disabled = true;
  dom.versionSelect.disabled = true;
  dom.playButton.disabled = true;

  if (!appState.versions.length) {
    dom.versionSelect.innerHTML = "<option>Surumler yukleniyor...</option>";
  }

  addLogEntry("Surum listesi yenileniyor...");
  try {
    appState.versions = await window.skylandAPI.getVersions();
    renderVersionOptions(preferredSelectionKey);
    addLogEntry(`${appState.versions.length} surum listelendi.`);
  } catch (error) {
    renderVersionOptions(preferredSelectionKey);
    addLogEntry(`Surum listesi alinamadi: ${error.message}`);
  } finally {
    dom.refreshVersionsButton.disabled = false;
    dom.versionSelect.disabled = appState.versions.length === 0;
    dom.playButton.disabled = appState.versions.length === 0;
    renderModsMeta();
    renderInstalledModsMeta();
  }
}

async function loadInstalledMods({ checkUpdates = false } = {}) {
  const context = getModsContext();
  if (!context.selectedVersion) {
    appState.mods.installedItems = [];
    renderInstalledModsGrid();
    showInstalledModsNotice("Kurulu modlari gormek icin once bir surum sec.", "error");
    return;
  }

  appState.mods.installedLoading = !checkUpdates;
  appState.mods.installedChecking = checkUpdates;
  renderInstalledModsGrid();

  try {
    const result = await window.skylandAPI.listInstalledMods({
      loader: dom.modLoaderSelect.value,
      selectedVersion: context.selectedVersion,
      gameDir: appState.settings.gameDir,
      checkUpdates
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Kurulu modlar alinamadi.");
    }

    appState.mods.installedItems = result.items || [];
    renderInstalledModsGrid();

    if (checkUpdates) {
      showInstalledModsNotice(
        appState.mods.installedItems.length
          ? `${appState.mods.installedItems.length} kurulu mod icin guncellemeler denetlendi.`
          : "Kontrol edilecek kurulu mod bulunamadi.",
        "success"
      );
    } else if (!appState.mods.installedItems.length) {
      showInstalledModsNotice("Bu filtre icin kurulu mod yok.", "info");
    } else {
      clearInstalledModsNotice();
    }

    addLogEntry(
      checkUpdates
        ? `${context.selectedVersion.id} icin kurulu mod guncellemeleri denetlendi.`
        : `${context.selectedVersion.id} icin ${appState.mods.installedItems.length} kurulu mod listelendi.`
    );
  } catch (error) {
    if (!checkUpdates) {
      appState.mods.installedItems = [];
      renderInstalledModsGrid();
    }
    showInstalledModsNotice(`Kurulu modlar alinamadi: ${error.message}`, "error");
    addLogEntry(`Kurulu modlar alinamadi: ${error.message}`);
  } finally {
    appState.mods.installedLoading = false;
    appState.mods.installedChecking = false;
    renderInstalledModsGrid();
  }
}

async function loadMods() {
  const context = getModsContext();
  if (!context.selectedVersion) {
    appState.mods.items = [];
    appState.mods.totalHits = 0;
    appState.mods.searchedOnce = true;
    renderModsGrid();
    showModsNotice("Modlari acmadan once bir Minecraft surumu sec.", "error");
    return;
  }

  appState.mods.loading = true;
  appState.mods.searchedOnce = true;
  dom.searchModsButton.disabled = true;
  dom.modLoaderSelect.disabled = true;
  dom.modSearchInput.disabled = true;
  renderModsGrid();

  try {
    const result = await window.skylandAPI.searchMods({
      query: dom.modSearchInput.value.trim(),
      loader: dom.modLoaderSelect.value,
      selectedVersion: context.selectedVersion,
      gameDir: appState.settings.gameDir
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Mod listesi alinamadi.");
    }

    appState.mods.items = result.items || [];
    appState.mods.totalHits = Number(result.totalHits || 0);
    appState.mods.installedProjectIds = new Set(
      appState.mods.items.filter((item) => item.installed).map((item) => item.projectId)
    );
    renderModsGrid();

    const status = getModsStatusMessage(getModsContext());
    if (status) {
      showModsNotice(status.message, status.type);
    } else if (!appState.mods.items.length) {
      showModsNotice("Bu filtrelerle mod bulunamadi.", "info");
    } else {
      clearModsNotice();
    }

    addLogEntry(
      `${context.selectedVersion.id} icin ${appState.mods.items.length} Modrinth modu listelendi.`
    );
  } catch (error) {
    appState.mods.items = [];
    appState.mods.totalHits = 0;
    renderModsGrid();
    showModsNotice(`Mod listesi alinamadi: ${error.message}`, "error");
    addLogEntry(`Mod listesi alinamadi: ${error.message}`);
  } finally {
    appState.mods.loading = false;
    dom.searchModsButton.disabled = false;
    dom.modLoaderSelect.disabled = false;
    dom.modSearchInput.disabled = false;
    renderModsGrid();
  }
}

async function installMod(projectId, fallbackItem = null) {
  const context = getModsContext();
  if (!context.selectedVersion) {
    showModsNotice("Kurulum icin once bir surum sec.", "error");
    return;
  }

  const knownItem =
    appState.mods.items.find((item) => item.projectId === projectId) ||
    appState.mods.installedItems.find((item) => item.projectId === projectId) ||
    fallbackItem;

  appState.mods.installingProjectId = projectId;
  renderModsGrid();
  renderInstalledModsGrid();

  try {
    const result = await window.skylandAPI.installMod({
      projectId,
      loader: dom.modLoaderSelect.value,
      loaderHint: knownItem?.supportedLoaders?.join(",") || knownItem?.loader || "",
      projectMeta: buildProjectMetaFromItem(knownItem),
      selectedVersion: context.selectedVersion,
      gameDir: appState.settings.gameDir
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Mod kurulumu basarisiz.");
    }

    appState.mods.installedProjectIds.add(projectId);
    appState.mods.items = appState.mods.items.map((item) =>
      item.projectId === projectId
        ? {
            ...item,
            installed: true,
            hasUpdate: false,
            installedLoader: result.loader,
            installedGameVersion: result.gameVersion,
            installedVersionId: result.versionId,
            installedVersionNumber: result.versionNumber
          }
        : item
    );
    const installedCount = (result.installedFiles || []).length;
    const skippedCount = (result.skippedFiles || []).length;
    const details = [];
    if (result.preparedLoader?.loader) {
      details.push(`${capitalizeWord(result.preparedLoader.loader)} hazirlandi`);
    }
    if (installedCount) {
      details.push(`${installedCount} dosya indirildi`);
    }
    if (skippedCount) {
      details.push(`${skippedCount} dosya zaten vardi`);
    }

    showModsNotice(
      `${result.title} kuruldu. ${details.join(", ") || "Mod klasore eklendi"}.`,
      "success"
    );
    addLogEntry(`${result.title} modu kuruldu. Loader: ${capitalizeWord(result.loader)}.`);
    await loadVersions(getVersionSelectionKey(context.selectedVersion));
    await loadInstalledMods();
    showInstalledModsNotice(`${result.title} kurulu modlara eklendi.`, "success");
  } catch (error) {
    showModsNotice(`Mod kurulamadi: ${error.message}`, "error");
    addLogEntry(`Mod kurulamadi: ${error.message}`);
  } finally {
    appState.mods.installingProjectId = null;
    renderModsGrid();
    renderInstalledModsGrid();
  }
}

async function removeInstalledMod(installId) {
  const installedItem = appState.mods.installedItems.find((item) => item.installId === installId);
  if (!installedItem) {
    showInstalledModsNotice("Silinecek mod bulunamadi.", "error");
    return;
  }

  appState.mods.removingInstallId = installId;
  renderModsGrid();
  renderInstalledModsGrid();

  try {
    const result = await window.skylandAPI.removeInstalledMod({
      installId,
      gameDir: appState.settings.gameDir
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Mod silinemedi.");
    }

    appState.mods.installedItems = appState.mods.installedItems.filter((item) => item.installId !== installId);
    appState.mods.items = appState.mods.items.map((item) =>
      item.projectId === installedItem.projectId &&
      item.installedGameVersion === installedItem.gameVersion &&
      item.installedLoader === installedItem.loader
        ? {
            ...item,
            installed: false,
            hasUpdate: false,
            installedLoader: null,
            installedGameVersion: null,
            installedVersionId: null,
            installedVersionNumber: null
          }
        : item
    );
    appState.mods.installedProjectIds = new Set(
      appState.mods.items.filter((item) => item.installed).map((item) => item.projectId)
    );

    await loadInstalledMods();
    showInstalledModsNotice(`${installedItem.title} silindi.`, "success");
    addLogEntry(`${installedItem.title} kurulu modlardan silindi.`);
  } catch (error) {
    showInstalledModsNotice(`Mod silinemedi: ${error.message}`, "error");
    addLogEntry(`Mod silinemedi: ${error.message}`);
  } finally {
    appState.mods.removingInstallId = null;
    renderModsGrid();
    renderInstalledModsGrid();
  }
}

async function clearInstalledMods() {
  const context = getModsContext();
  if (!context.selectedVersion) {
    showInstalledModsNotice("Tum modlari silmeden once bir surum sec.", "error");
    return;
  }

  appState.mods.clearingInstalled = true;
  renderModsGrid();
  renderInstalledModsGrid();

  try {
    const result = await window.skylandAPI.clearInstalledMods({
      loader: dom.modLoaderSelect.value,
      selectedVersion: context.selectedVersion,
      gameDir: appState.settings.gameDir
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Kurulu modlar temizlenemedi.");
    }

    appState.mods.items = appState.mods.items.map((item) =>
      item.installedGameVersion === context.gameVersion &&
      (!context.effectiveLoader || item.installedLoader === context.effectiveLoader)
        ? {
            ...item,
            installed: false,
            hasUpdate: false,
            installedLoader: null,
            installedGameVersion: null,
            installedVersionId: null,
            installedVersionNumber: null
          }
        : item
    );
    appState.mods.installedProjectIds = new Set(
      appState.mods.items.filter((item) => item.installed).map((item) => item.projectId)
    );

    await loadInstalledMods();
    showInstalledModsNotice(`${result.removedCount || 0} kurulu mod silindi.`, "success");
    addLogEntry(`${result.removedCount || 0} kurulu mod temizlendi.`);
  } catch (error) {
    showInstalledModsNotice(`Kurulu modlar temizlenemedi: ${error.message}`, "error");
    addLogEntry(`Kurulu modlar temizlenemedi: ${error.message}`);
  } finally {
    appState.mods.clearingInstalled = false;
    renderModsGrid();
    renderInstalledModsGrid();
  }
}

async function loadRemoteProfile(uid, idToken) {
  const profileData = (await realtimeGet(`launcherUsers/${uid}`, idToken)) || {};
  appState.profile = {
    launcherUsername: profileData.username || appState.profile.launcherUsername || "",
    displayName: profileData.displayName || profileData.username || "",
    mcNickname: profileData.mcNickname || profileData.username || "SkylandTiger"
  };

  await window.skylandAPI.saveProfile(appState.profile);
  fillProfileForm();
  updateSessionHeader();
}

async function syncProfileToRealtimeDb() {
  if (!appState.currentUser?.uid || !appState.currentUser?.idToken) {
    return;
  }

  await realtimePatch(
    `launcherUsers/${appState.currentUser.uid}`,
    {
      username: appState.profile.launcherUsername,
      usernameLower: normalizeUsername(appState.profile.launcherUsername),
      displayName: appState.profile.displayName,
      mcNickname: sanitizeMcNickname(appState.profile.mcNickname, "SkylandTiger"),
      updatedAt: new Date().toISOString()
    },
    appState.currentUser.idToken
  );
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  clearMessage();

  const formData = new FormData(dom.registerForm);
  const username = `${formData.get("username") ?? ""}`.trim();
  const displayName = `${formData.get("displayName") ?? ""}`.trim();
  const email = `${formData.get("email") ?? ""}`.trim();
  const password = `${formData.get("password") ?? ""}`;
  const passwordConfirm = `${formData.get("passwordConfirm") ?? ""}`;

  if (!username || !displayName || !email || !password) {
    showMessage("Tum alanlari doldurman gerekiyor.", "error");
    return;
  }

  if (password !== passwordConfirm) {
    showMessage("Sifreler ayni degil.", "error");
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    showMessage("Kullanici adi 3-24 karakter olmali ve sadece harf, rakam, alt cizgi icermeli.", "error");
    return;
  }

  let authResult = null;
  let remoteSaved = false;
  let verificationSent = false;

  try {
    const existing = await realtimeGet(`usernames/${normalizeUsername(username)}`);
    if (existing) {
      showMessage("Bu kullanici adi zaten alinmis.", "error");
      return;
    }

    authResult = await authSignUp(email, password);

    const fallbackNick = sanitizeMcNickname(username, "SkylandTiger");
    const mcNickname = sanitizeMcNickname(displayName.replace(/\s+/g, ""), fallbackNick);

    await writeRemoteUserBootstrap(authResult, {
      username,
      displayName,
      email,
      mcNickname
    });
    remoteSaved = true;

    try {
      await authSendVerification(authResult.idToken);
      verificationSent = true;
    } catch (verificationError) {
      addLogEntry(`Dogrulama e-postasi gonderilemedi: ${firebaseErrorMessage(verificationError)}`);
    }

    dom.registerForm.reset();
    dom.loginForm.elements.username.value = username;
    toggleAuthMode("login");

    if (verificationSent) {
      showMessage("Kayit tamamlandi. E-postana dogrulama baglantisi gonderildi, onaylayip giris yapabilirsin.", "success");
    } else {
      showMessage("Kayit tamamlandi. Hesap acildi ama dogrulama e-postasi gonderilemedi; Firebase mail ayarlarini kontrol et.");
    }
  } catch (error) {
    if (authResult?.idToken && !remoteSaved) {
      await authDeleteAccount(authResult.idToken).catch(() => {});
    }
    showMessage(`Kayit olusturulamadi: ${firebaseErrorMessage(error)}`, "error");
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  clearMessage();

  const formData = new FormData(dom.loginForm);
  const username = `${formData.get("username") ?? ""}`.trim();
  const password = `${formData.get("password") ?? ""}`;

  if (!username || !password) {
    showMessage("Kullanici adi ve sifre zorunlu.", "error");
    return;
  }

  try {
    const usernameDoc = await realtimeGet(`usernames/${normalizeUsername(username)}`);
    if (!usernameDoc?.email) {
      throw new Error("Bu kullanici adi bulunamadi.");
    }

    const authResult = await authSignIn(usernameDoc.email, password);
    const accountInfo = await authLookup(authResult.idToken);

    if (!accountInfo?.emailVerified) {
      await authSendVerification(authResult.idToken);
      throw new Error("E-posta dogrulaman tamamlanmamis. Yeni dogrulama e-postasi gonderildi.");
    }

    appState.currentUser = {
      uid: authResult.localId,
      email: authResult.email,
      idToken: authResult.idToken,
      refreshToken: authResult.refreshToken,
      emailVerified: true
    };

    await loadRemoteProfile(authResult.localId, authResult.idToken);
    await saveLocalSession({
      uid: authResult.localId,
      email: authResult.email,
      username,
      refreshToken: authResult.refreshToken,
      idToken: authResult.idToken
    });

    openLauncherScreen();
    addLogEntry(`${username} oturumu acildi.`);
  } catch (error) {
    showMessage(`Giris basarisiz: ${firebaseErrorMessage(error)}`, "error");
  }
}

async function resendVerification() {
  const username = `${dom.loginForm.elements.username.value ?? ""}`.trim();
  const password = `${dom.loginForm.elements.password.value ?? ""}`;

  if (!username || !password) {
    showMessage("Dogrulama e-postasini yeniden gondermek icin kullanici adi ve sifre gerekli.", "error");
    return;
  }

  try {
    const usernameDoc = await realtimeGet(`usernames/${normalizeUsername(username)}`);
    if (!usernameDoc?.email) {
      throw new Error("Bu kullanici adi bulunamadi.");
    }

    const authResult = await authSignIn(usernameDoc.email, password);
    await authSendVerification(authResult.idToken);
    showMessage("Dogrulama e-postasi yeniden gonderildi.", "success");
  } catch (error) {
    showMessage(firebaseErrorMessage(error), "error");
  }
}

async function handleProfileSave(event) {
  event.preventDefault();

  try {
    appState.profile = {
      launcherUsername: appState.profile.launcherUsername,
      displayName: dom.displayNameInput.value.trim(),
      mcNickname: sanitizeMcNickname(dom.mcNicknameInput.value.trim(), "SkylandTiger")
    };

    await window.skylandAPI.saveProfile(appState.profile);
    await syncProfileToRealtimeDb();
    fillProfileForm();
    updateSessionHeader();
    addLogEntry("Profil ayarlari kaydedildi.");
  } catch (error) {
    addLogEntry(`Profil ayarlari kaydedilemedi: ${firebaseErrorMessage(error)}`);
  }
}

async function handleSettingsSave(event) {
  event.preventDefault();
  const form = dom.settingsForm.elements;
  const nextSettings = {
    ramMb: Number(form.ramMb.value),
    minRamMb: Number(form.minRamMb.value),
    language: form.language.value,
    fullscreen: form.fullscreen.value === "true",
    resolutionWidth: Number(form.resolutionWidth.value),
    resolutionHeight: Number(form.resolutionHeight.value),
    showSnapshots: form.showSnapshots.value === "true",
    javaPath: form.javaPath.value.trim(),
    gameDir: form.gameDir.value.trim()
  };

  if (nextSettings.minRamMb > nextSettings.ramMb) {
    showMessage("Min RAM, Max RAM'den buyuk olamaz.", "error");
    return;
  }

  appState.settings = await window.skylandAPI.saveSettings(nextSettings);
  renderSettingsSummary();
  fillSettingsForm();
  await loadVersions(getVersionSelectionKey(getSelectedVersion()));
  renderModsMeta();
  renderInstalledModsMeta();
  if (appState.launcherView === "mods") {
    await loadInstalledMods();
  }
  dom.settingsModal.classList.add("hidden");
  addLogEntry("Launcher ayarlari kaydedildi.");
}

async function handlePlay() {
  const selectedVersion = getSelectedVersion();
  if (!selectedVersion) {
    showLaunchNotice("Play icin bir surum secilmedi.", "error");
    addLogEntry("Play icin bir surum secilmedi.");
    return;
  }

  if (!appState.profile.mcNickname?.trim()) {
    showLaunchNotice("Minecraft nicki bos olamaz.", "error");
    addLogEntry("Minecraft nicki bos olamaz.");
    return;
  }

  clearLaunchNotice();
  addLogEntry(`${selectedVersion.id} icin launch basladi.`);
  setProgress(8, "Launcher baslatiliyor...");
  showLaunchOverlay("Launcher baslatiliyor...");
  showLaunchNotice(`${selectedVersion.id} hazirlaniyor...`);

  const result = await window.skylandAPI.launchGame({
    version: selectedVersion,
    settings: appState.settings,
    profile: appState.profile
  });

  if (!result.ok) {
    hideLaunchOverlay();
    const formattedError = formatLaunchErrorMessage(result.error);
    showLaunchNotice(formattedError, "error");
    addLogEntry(`Launch hatasi: ${formattedError}`);
    return;
  }

  showLaunchNotice("Minecraft acilis komutu gonderildi.", "success");
  addLogEntry(`Minecraft islemi baslatildi. PID: ${result.pid ?? "?"}`);
}

async function logOut() {
  await clearLocalSession();
  appState.currentUser = null;
  openAuthScreen();
  addLogEntry("Oturum kapatildi.");
}

function wireModal() {
  dom.openSettingsButton.addEventListener("click", () => {
    fillSettingsForm();
    dom.settingsModal.classList.remove("hidden");
  });

  document.querySelectorAll("[data-close-modal='true']").forEach((element) => {
    element.addEventListener("click", () => {
      dom.settingsModal.classList.add("hidden");
    });
  });
}

function wireMods() {
  dom.modsSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadMods().catch((error) => {
      showModsNotice(`Mod listesi alinamadi: ${error.message}`, "error");
    });
  });

  dom.modLoaderSelect.addEventListener("change", () => {
    renderModsMeta();
    renderInstalledModsMeta();
    if (appState.launcherView === "mods" && appState.mods.searchedOnce) {
      loadMods().catch((error) => {
        showModsNotice(`Mod listesi alinamadi: ${error.message}`, "error");
      });
    }
    if (appState.launcherView === "mods") {
      loadInstalledMods().catch((error) => {
        showInstalledModsNotice(`Kurulu modlar alinamadi: ${error.message}`, "error");
      });
    }
  });

  dom.modsGrid.addEventListener("click", (event) => {
    const installButton = event.target.closest("[data-install-mod]");
    if (installButton) {
      const modItem = appState.mods.items.find((item) => item.projectId === installButton.dataset.installMod);
      if (modItem?.installed && !modItem.hasUpdate) {
        const targetVersion = findLaunchVersionFor(
          modItem.installedGameVersion || getModsContext().gameVersion,
          modItem.installedLoader
        );
        if (targetVersion) {
          selectVersionByKey(getVersionSelectionKey(targetVersion));
        }
        setLauncherView("play");
        handlePlay().catch((error) => {
          showLaunchNotice(`Minecraft baslatilamadi: ${error.message}`, "error");
        });
      } else {
        installMod(installButton.dataset.installMod, modItem).catch((error) => {
          showModsNotice(`Mod kurulumu basarisiz: ${error.message}`, "error");
        });
      }
      return;
    }

    const pageButton = event.target.closest("[data-open-url]");
    if (pageButton) {
      window.skylandAPI.openExternal(pageButton.dataset.openUrl);
    }
  });

  dom.installedModsGrid.addEventListener("click", (event) => {
    const updateButton = event.target.closest("[data-update-installed-mod]");
    if (updateButton) {
      const installedItem = appState.mods.installedItems.find(
        (item) => item.projectId === updateButton.dataset.updateInstalledMod
      );
      if (installedItem?.hasUpdate) {
        installMod(updateButton.dataset.updateInstalledMod, installedItem).catch((error) => {
          showInstalledModsNotice(`Mod guncellenemedi: ${error.message}`, "error");
        });
      }
      return;
    }

    const removeButton = event.target.closest("[data-remove-installed-mod]");
    if (removeButton) {
      removeInstalledMod(removeButton.dataset.removeInstalledMod).catch((error) => {
        showInstalledModsNotice(`Mod silinemedi: ${error.message}`, "error");
      });
      return;
    }

    const pageButton = event.target.closest("[data-open-url]");
    if (pageButton) {
      window.skylandAPI.openExternal(pageButton.dataset.openUrl);
    }
  });

  dom.refreshInstalledModsButton.addEventListener("click", () => {
    loadInstalledMods().catch((error) => {
      showInstalledModsNotice(`Kurulu modlar alinamadi: ${error.message}`, "error");
    });
  });

  dom.checkInstalledUpdatesButton.addEventListener("click", () => {
    loadInstalledMods({ checkUpdates: true }).catch((error) => {
      showInstalledModsNotice(`Guncellemeler denetlenemedi: ${error.message}`, "error");
    });
  });

  dom.clearInstalledModsButton.addEventListener("click", () => {
    clearInstalledMods().catch((error) => {
      showInstalledModsNotice(`Kurulu modlar temizlenemedi: ${error.message}`, "error");
    });
  });
}

function wireLauncherEvents() {
  window.skylandAPI.onLauncherEvent((event) => {
    if (event.type === "progress") {
      const value = Number(event.payload?.progress ?? event.payload?.value ?? 0);
      const total = Number(event.payload?.total ?? 100);
      const percent = total > 0 ? (value / total) * 100 : value;
      setProgress(percent, "Surum dosyalari indiriliyor...");
      showLaunchOverlay("Surum dosyalari indiriliyor...");
      return;
    }

    if (event.type === "download-status") {
      const progress = Number(event.payload?.progress ?? 0);
      const total = Number(event.payload?.total ?? 0);
      const percent = total > 0 ? (progress / total) * 100 : 0;
      setProgress(percent, "Paketler indiriliyor...");
      return;
    }

    if (event.type === "java-download-status") {
      const progress = Number(event.payload?.progress ?? 0);
      const total = Number(event.payload?.total ?? 0);
      const percent = total > 0 ? (progress / total) * 100 : 0;
      setProgress(percent, `Java ${event.payload?.requiredJava ?? ""} indiriliyor...`);
      showLaunchOverlay(`Java ${event.payload?.requiredJava ?? ""} indiriliyor...`);
      showLaunchNotice(`Gerekli Java otomatik indiriliyor...`);
      return;
    }

    if (event.type === "java-install-status") {
      const stage = `${event.payload?.stage ?? ""}`;
      if (stage === "download-start") {
        setProgress(6, event.payload?.message ?? "Java indiriliyor...");
        showLaunchOverlay(event.payload?.message ?? "Java indiriliyor...");
        showLaunchNotice(event.payload?.message ?? "Java indiriliyor...");
        return;
      }

      if (stage === "extract-start") {
        setProgress(88, event.payload?.message ?? "Java kuruluyor...");
        showLaunchOverlay(event.payload?.message ?? "Java kuruluyor...");
        showLaunchNotice(event.payload?.message ?? "Java kuruluyor...");
        return;
      }

      if (stage === "ready") {
        setProgress(100, event.payload?.message ?? "Java hazir.");
        showLaunchNotice(event.payload?.message ?? "Java hazir.", "success");
        return;
      }
    }

    if (event.type === "download") {
      addLogEntry(`Indirildi: ${event.payload?.fileName ?? "dosya"}`);
      return;
    }

    if (event.type === "launch-start") {
      showLaunchOverlay(`${event.payload?.versionId} hazirlaniyor...`);
      const launchMessage = event.payload?.managedLoader
        ? `${event.payload?.versionId} icin ${capitalizeWord(event.payload.managedLoader)} otomatik hazirlandi ve oyuna ekleniyor.`
        : event.payload?.autoInstalled
        ? `${event.payload?.versionId} icin Java ${event.payload?.installedJava} otomatik kuruldu ve secildi.`
        : `${event.payload?.versionId} icin Java ${event.payload?.installedJava} kullaniliyor.`;
      showLaunchNotice(launchMessage, "success");
      addLogEntry(`${event.payload?.nickname} icin oyun baslatiliyor.`);
      return;
    }

    if (event.type === "launch-ready") {
      setProgress(100, "Minecraft acildi.");
      showLaunchNotice("Minecraft baslatildi.", "success");
      window.setTimeout(() => hideLaunchOverlay(), 1400);
      return;
    }

    if (event.type === "launch-error") {
      hideLaunchOverlay();
      const formattedError = formatLaunchErrorMessage(event.payload?.message ?? "Bilinmeyen hata");
      showLaunchNotice(`Launch hatasi: ${formattedError}`, "error");
      addLogEntry(`Launch hatasi: ${formattedError}`);
      return;
    }

    if (event.type === "game-close") {
      hideLaunchOverlay();
      setProgress(0, "Hazir");
      const exitCode = Number(event.payload?.exitCode ?? 0);
      showLaunchNotice(
        exitCode === 0
          ? "Minecraft kapandi."
          : `Minecraft beklenmedik sekilde kapandi. Cikis kodu: ${exitCode}`,
        exitCode === 0 ? "info" : "error"
      );
      addLogEntry(`Minecraft kapandi. Cikis kodu: ${exitCode}`);
      return;
    }

    if (event.type === "minecraft-log" || event.type === "debug" || event.type === "warning") {
      addLogEntry(event.payload?.message ?? JSON.stringify(event.payload));
    }
  });
}

async function chooseJavaPath() {
  const selectedPath = await window.skylandAPI.chooseJavaPath();
  if (selectedPath) {
    dom.settingsForm.elements.javaPath.value = selectedPath;
  }
}

async function chooseGameDir() {
  const selectedPath = await window.skylandAPI.chooseGameDirectory();
  if (selectedPath) {
    dom.settingsForm.elements.gameDir.value = selectedPath;
  }
}

async function restoreSessionFromRefreshToken() {
  const storedUser = appState.session?.user;
  if (!sessionIsActive(appState.session) || !storedUser?.refreshToken) {
    return false;
  }

  try {
    const refreshed = await authRefresh(storedUser.refreshToken);
    const idToken = refreshed.id_token;
    const refreshToken = refreshed.refresh_token;
    const accountInfo = await authLookup(idToken);

    if (!accountInfo?.emailVerified) {
      return false;
    }

    appState.currentUser = {
      uid: refreshed.user_id,
      email: accountInfo.email,
      idToken,
      refreshToken,
      emailVerified: true
    };

    await saveLocalSession({
      uid: refreshed.user_id,
      email: accountInfo.email,
      username: storedUser.username,
      refreshToken,
      idToken
    });
    await loadRemoteProfile(refreshed.user_id, idToken);
    return true;
  } catch (error) {
    addLogEntry(`Oturum yenilenemedi: ${firebaseErrorMessage(error)}`);
    return false;
  }
}

async function boot() {
  dom.shell.classList.remove("hidden");
  renderVersionOptions();
  renderModsGrid();
  renderInstalledModsGrid();

  appState.bootstrap = await window.skylandAPI.bootstrap();
  appState.settings = appState.bootstrap.state.settings;
  appState.profile = appState.bootstrap.state.profile;
  appState.session = appState.bootstrap.state.session;
  appState.announcements = appState.bootstrap.state.announcements || { seenIds: [] };

  renderSettingsSummary();
  fillSettingsForm();
  fillProfileForm();
  updateSessionHeader();
  renderModsMeta();
  renderInstalledModsMeta();
  addLogEntry("Launcher arayuzu hazirlandi.");

  if (!sessionIsActive(appState.session)) {
    await clearLocalSession();
  }

  wireLauncherEvents();

  const restored = await restoreSessionFromRefreshToken();
  if (restored) {
    openLauncherScreen();
    addLogEntry("Son oturum geri yuklendi.");
  } else {
    openAuthScreen();
  }

  loadVersions().catch((error) => {
    addLogEntry(`Surumler yuklenemedi: ${error.message}`);
  });
}

dom.tabButtons.forEach((button) => {
  button.addEventListener("click", () => toggleAuthMode(button.dataset.authMode));
});

dom.launcherNavButtons.forEach((button) => {
  button.addEventListener("click", () => setLauncherView(button.dataset.launcherView));
});

dom.loginForm.addEventListener("submit", handleLoginSubmit);
dom.registerForm.addEventListener("submit", handleRegisterSubmit);
dom.resendVerificationButton.addEventListener("click", resendVerification);
dom.profileForm.addEventListener("submit", handleProfileSave);
dom.settingsForm.addEventListener("submit", handleSettingsSave);
dom.dismissUpdateAnnouncementButton.addEventListener("click", () => {
  dismissUpdateAnnouncement().catch((error) => {
    addLogEntry(`Update duyurusu kapatilamadi: ${error.message}`);
  });
});
dom.refreshVersionsButton.addEventListener("click", loadVersions);
dom.versionSelect.addEventListener("change", () => {
  updateVersionMeta();
  if (appState.launcherView === "mods" && appState.mods.searchedOnce) {
    loadMods().catch((error) => {
      showModsNotice(`Modlar yenilenemedi: ${error.message}`, "error");
    });
  }
  if (appState.launcherView === "mods") {
    loadInstalledMods().catch((error) => {
      showInstalledModsNotice(`Kurulu modlar yenilenemedi: ${error.message}`, "error");
    });
  }
});
dom.playButton.addEventListener("click", handlePlay);
dom.logoutButton.addEventListener("click", logOut);
dom.pickJavaButton.addEventListener("click", chooseJavaPath);
dom.pickGameDirButton.addEventListener("click", chooseGameDir);
dom.mcNicknameInput.addEventListener("input", updateSkinPreview);

wireModal();
wireMods();
toggleAuthMode("login");
setProgress(0, "Hazir");
boot().catch((error) => {
  addLogEntry(`Acilis hatasi: ${error.message}`);
  showMessage(`Launcher baslatilamadi: ${error.message}`, "error");
  dom.shell.classList.remove("hidden");
  openAuthScreen();
});

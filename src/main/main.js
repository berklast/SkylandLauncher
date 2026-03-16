const { app, BrowserWindow, dialog, ipcMain, shell, Menu, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const { execFile } = require("child_process");
const { Readable } = require("stream");
const { Client, Authenticator } = require("minecraft-launcher-core");
const { readState, patchState } = require("./state");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MOJANG_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const ADOPTIUM_BINARY_URL = "https://api.adoptium.net/v3/binary/latest";
const MODRINTH_API_BASE = "https://api.modrinth.com/v2";
const FABRIC_META_BASE = "https://meta.fabricmc.net/v2";
const FORGE_MAVEN_BASE = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const MODRINTH_LOADERS = ["fabric", "forge", "quilt", "neoforge"];
const MANAGED_MODS_LIBRARY_DIRNAME = ".skyland-mod-library";
const APP_NAME = "SKYLAND 3";
const versionManifestCache = {
  fetchedAt: 0,
  versions: []
};
const versionMetaCache = new Map();
const managedJavaInstalls = new Map();

let mainWindow = null;
let minecraftOverlayWindow = null;
let minecraftOverlayInterval = null;
let minecraftOverlayTimeout = null;
let activeMinecraftProcess = null;
const MINECRAFT_OVERLAY_MARGIN = 16;
const MINECRAFT_OVERLAY_DELAY_MS = 1200;
const MINECRAFT_OVERLAY_INTERVAL_MS = 850;
const MINECRAFT_OVERLAY_MAX_TICKS = 10;

// Bazi Windows sistemlerde Electron siyah pencere cizebiliyor.
// GPU hizlandirmayi kapatmak launcher arayuzunu daha kararlı yapar.

function ensureDirectorySync(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function getBundled7ZipPath() {
  if (process.platform !== "win32") {
    return null;
  }

  const packagedPath = path.join(process.resourcesPath, "tools", "7za.exe");
  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  const devPath = path.join(__dirname, "../../node_modules/7zip-bin/win/x64/7za.exe");
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  return null;
}

function execFileAsync(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout: `${stdout ?? ""}`,
        stderr: `${stderr ?? ""}`
      });
    });
  });
}

function escapePowerShellString(value) {
  return `${value ?? ""}`.replace(/'/g, "''");
}

async function downloadFile(url, destinationPath, onProgress, failureMessage = "Dosya indirilemedi.") {
  const response = await fetch(url, {
    redirect: "follow"
  });

  if (!response.ok || !response.body) {
    throw new Error(failureMessage);
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const total = Number(response.headers.get("content-length") || 0);

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destinationPath);
    const bodyStream = Readable.fromWeb(response.body);
    let received = 0;

    bodyStream.on("data", (chunk) => {
      received += chunk.length;
      onProgress?.(received, total);
    });

    bodyStream.on("error", (error) => {
      fileStream.destroy();
      reject(error);
    });

    fileStream.on("error", reject);
    fileStream.on("finish", resolve);
    bodyStream.pipe(fileStream);
  });
}

async function downloadFileWindows(url, destinationPath) {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.unlink(destinationPath).catch(() => {});

  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `Invoke-WebRequest -UseBasicParsing -Uri '${escapePowerShellString(url)}' -OutFile '${escapePowerShellString(destinationPath)}'`
  ].join("; ");

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]);
}

function normalizeModLoader(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (normalized === "neo-forge") {
    return "neoforge";
  }
  return MODRINTH_LOADERS.includes(normalized) ? normalized : null;
}

function formatLoaderName(value) {
  const text = `${value ?? ""}`.trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "Loader";
}

function supportsManagedLoaderAutoProvision(loader) {
  return loader === "fabric" || loader === "forge";
}

function pickSupportedModLoader(loaders, preferredLoader = null) {
  const preferred = normalizeModLoader(preferredLoader);
  const normalizedLoaders = Array.from(
    new Set((Array.isArray(loaders) ? loaders : []).map(normalizeModLoader).filter(Boolean))
  );
  const fallbackOrder = ["fabric", "forge", "quilt", "neoforge"];

  if (preferred && normalizedLoaders.includes(preferred)) {
    return preferred;
  }

  return fallbackOrder.find((loader) => normalizedLoaders.includes(loader)) || normalizedLoaders[0] || null;
}

function inferMinecraftVersionId(selectedVersion) {
  const directCandidates = [
    selectedVersion?.baseVersion,
    selectedVersion?.id,
    selectedVersion?.customId
  ]
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

function inferModLoader(selectedVersion, requestedLoader = null) {
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

  for (const loader of MODRINTH_LOADERS) {
    if (fingerprint.includes(loader)) {
      return loader;
    }
  }

  return null;
}

function getSelectedVersionLoaderHint(selectedVersion) {
  return normalizeModLoader(selectedVersion?.managedLoader) || inferModLoader(selectedVersion);
}

async function fetchJsonWithMessage(url, defaultMessage) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": `${APP_NAME} Launcher`
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.description || payload?.error || response.statusText || defaultMessage);
  }

  return payload;
}

async function fetchModrinthJson(url) {
  return fetchJsonWithMessage(url, "Modrinth verisi alinamadi.");
}

async function fetchTextWithMessage(url, defaultMessage) {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": `${APP_NAME} Launcher`
    }
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(text || response.statusText || defaultMessage);
  }

  return text;
}

function parseMinecraftReleaseParts(gameVersion) {
  const match = `${gameVersion ?? ""}`.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0)
  };
}

function isSnapshotLikeVersion(entry) {
  const type = `${entry?.type ?? ""}`.toLowerCase();
  const id = `${entry?.id ?? entry?.baseVersion ?? entry?.customId ?? ""}`.toLowerCase();
  const label = `${entry?.label ?? ""}`.toLowerCase();

  return (
    type === "snapshot" ||
    type === "old_beta" ||
    type === "old_alpha" ||
    /^\d{2}w\d{2}[a-z]?$/.test(id) ||
    /\bsnapshot\b/.test(label)
  );
}

function usesForgeInstallerArtifact(gameVersion) {
  const parts = parseMinecraftReleaseParts(gameVersion);
  if (!parts) {
    return true;
  }

  if (parts.major > 1) {
    return true;
  }

  if (parts.minor > 12) {
    return true;
  }

  return parts.minor === 12 && parts.patch >= 2;
}

async function getLatestForgeVersionForGame(gameVersion) {
  const metadataXml = await fetchTextWithMessage(
    `${FORGE_MAVEN_BASE}/maven-metadata.xml`,
    "Forge surum listesi alinamadi."
  );
  const matches = [...metadataXml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => `${match[1]}`.trim());
  const compatibleVersions = matches.filter((value) => value.startsWith(`${gameVersion}-`));

  if (!compatibleVersions.length) {
    throw new Error(`${gameVersion} icin uygun Forge surumu bulunamadi.`);
  }

  return compatibleVersions[compatibleVersions.length - 1];
}

function getManagedLoaderCacheDir(loader, versionId) {
  return path.join(app.getPath("userData"), "managed-loaders", loader, versionId);
}

async function ensureManagedForgeInstaller(gameVersion) {
  const forgeVersion = await getLatestForgeVersionForGame(gameVersion);
  const artifact = usesForgeInstallerArtifact(gameVersion) ? "installer" : "universal";
  const fileName = `forge-${forgeVersion}-${artifact}.jar`;
  const cacheDir = getManagedLoaderCacheDir("forge", forgeVersion);
  const destinationPath = path.join(cacheDir, fileName);

  if (!fs.existsSync(destinationPath)) {
    await fsp.mkdir(cacheDir, { recursive: true });
    await downloadFile(
      `${FORGE_MAVEN_BASE}/${forgeVersion}/${fileName}`,
      destinationPath,
      null,
      "Forge paketi indirilemedi."
    );
  }

  return {
    loader: "forge",
    gameVersion,
    forgeVersion,
    artifact,
    installerPath: destinationPath,
    fileName
  };
}

async function getLatestFabricLoaderForGame(gameVersion) {
  const versions = await fetchJsonWithMessage(
    `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(gameVersion)}`,
    "Fabric surum listesi alinamadi."
  );

  if (!Array.isArray(versions) || !versions.length) {
    throw new Error(`${gameVersion} icin uygun Fabric loader bulunamadi.`);
  }

  const preferredEntry =
    versions.find((entry) => entry?.loader?.stable && entry?.loader?.version) ||
    versions.find((entry) => entry?.loader?.version);

  if (!preferredEntry?.loader?.version) {
    throw new Error(`${gameVersion} icin uygun Fabric loader bulunamadi.`);
  }

  return {
    gameVersion,
    loaderVersion: preferredEntry.loader.version,
    stable: Boolean(preferredEntry.loader.stable)
  };
}

async function ensureManagedFabricProfile(gameDir, gameVersion) {
  if (!gameDir) {
    throw new Error("Fabric kurulumu icin oyun klasoru bulunamadi.");
  }

  const fabricLoader = await getLatestFabricLoaderForGame(gameVersion);
  const profileJson = await fetchJsonWithMessage(
    `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(fabricLoader.loaderVersion)}/profile/json`,
    "Fabric profil bilgisi alinamadi."
  );
  const customId = `${profileJson?.id ?? ""}`.trim() || `fabric-loader-${fabricLoader.loaderVersion}-${gameVersion}`;
  const profileDir = path.join(gameDir, "versions", customId);
  const profilePath = path.join(profileDir, `${customId}.json`);

  await fsp.mkdir(profileDir, { recursive: true });
  await fsp.writeFile(
    profilePath,
    JSON.stringify(
      {
        ...profileJson,
        id: customId
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    loader: "fabric",
    gameVersion,
    loaderVersion: fabricLoader.loaderVersion,
    customId,
    profilePath
  };
}

async function ensureManagedLoaderReady(loader, gameVersion, gameDir = "") {
  if (loader === "fabric") {
    return ensureManagedFabricProfile(gameDir, gameVersion);
  }

  if (loader === "forge") {
    return ensureManagedForgeInstaller(gameVersion);
  }

  throw new Error(`${loader} otomatik kurulum henuz hazir degil. Simdilik Fabric ve Forge otomatik yukleniyor.`);
}

function pickPreferredModrinthVersion(versions) {
  const versionWeight = {
    release: 3,
    beta: 2,
    alpha: 1
  };

  return [...versions].sort((left, right) => {
    const leftFeatured = left?.featured ? 1 : 0;
    const rightFeatured = right?.featured ? 1 : 0;
    if (rightFeatured !== leftFeatured) {
      return rightFeatured - leftFeatured;
    }

    const leftWeight = versionWeight[left?.version_type] ?? 0;
    const rightWeight = versionWeight[right?.version_type] ?? 0;
    if (rightWeight !== leftWeight) {
      return rightWeight - leftWeight;
    }

    return Date.parse(right?.date_published || 0) - Date.parse(left?.date_published || 0);
  })[0];
}

function selectPrimaryModFile(version) {
  const files = Array.isArray(version?.files) ? version.files : [];
  return (
    files.find((file) => file?.primary && /\.jar$/i.test(file.filename || "")) ||
    files.find((file) => /\.jar$/i.test(file?.filename || ""))
  );
}

function getManagedModsManifestPath(gameDir) {
  return path.join(gameDir, ".skyland-modrinth.json");
}

function getManagedModsLibraryBaseDir(gameDir) {
  return path.join(gameDir, MANAGED_MODS_LIBRARY_DIRNAME);
}

function getManagedModsLibraryDir(gameDir, gameVersion, loader) {
  return path.join(
    getManagedModsLibraryBaseDir(gameDir),
    `${gameVersion || "unknown"}`,
    normalizeModLoader(loader) || "vanilla"
  );
}

function buildManagedModInstallId(projectId, gameVersion, loader) {
  return [projectId || "unknown", gameVersion || "unknown", normalizeModLoader(loader) || "vanilla"].join("::");
}

function normalizeManagedModEntry(fallbackKey, entry = {}) {
  const projectId = `${entry?.projectId ?? entry?.project_id ?? fallbackKey ?? ""}`.trim();
  if (!projectId) {
    return null;
  }

  const gameVersion = `${entry?.gameVersion ?? entry?.game_version ?? ""}`.trim();
  const loader = normalizeModLoader(entry?.loader);
  const files = Array.from(
    new Set((Array.isArray(entry?.files) ? entry.files : []).map((file) => `${file ?? ""}`.trim()).filter(Boolean))
  );

  return {
    installId: `${entry?.installId ?? ""}`.trim() || buildManagedModInstallId(projectId, gameVersion, loader),
    projectId,
    slug: `${entry?.slug ?? ""}`.trim(),
    title: `${entry?.title ?? entry?.name ?? projectId}`.trim() || projectId,
    description: `${entry?.description ?? ""}`.trim(),
    iconUrl: `${entry?.iconUrl ?? entry?.icon_url ?? ""}`.trim() || null,
    author: `${entry?.author ?? ""}`.trim() || null,
    versionId: `${entry?.versionId ?? entry?.version_id ?? ""}`.trim() || null,
    versionNumber: `${entry?.versionNumber ?? entry?.version_number ?? ""}`.trim() || null,
    gameVersion,
    loader,
    files,
    updatedAt: entry?.updatedAt || null,
    lastUpdateCheckAt: entry?.lastUpdateCheckAt || null,
    latestKnownVersionId: `${entry?.latestKnownVersionId ?? ""}`.trim() || null,
    latestKnownVersionNumber: `${entry?.latestKnownVersionNumber ?? ""}`.trim() || null
  };
}

function getManagedModEntries(manifest) {
  return Object.entries(manifest?.projects ?? {})
    .map(([key, entry]) => normalizeManagedModEntry(key, entry))
    .filter(Boolean);
}

function getManagedModEntry(manifest, projectId, gameVersion, loader) {
  const normalizedLoader = normalizeModLoader(loader);
  return (
    getManagedModEntries(manifest).find(
      (entry) =>
        entry.projectId === projectId &&
        (!gameVersion || entry.gameVersion === gameVersion) &&
        (!normalizedLoader || entry.loader === normalizedLoader)
    ) || null
  );
}

function setManagedModEntry(manifest, entry) {
  const normalizedEntry = normalizeManagedModEntry(entry?.installId, entry);
  if (!normalizedEntry) {
    return null;
  }

  manifest.projects[normalizedEntry.installId] = normalizedEntry;
  return normalizedEntry;
}

function createModSelectionVersionDescriptor(gameVersion, loader) {
  const normalizedLoader = normalizeModLoader(loader);
  return {
    id: gameVersion,
    baseVersion: gameVersion,
    customId: normalizedLoader ? `${normalizedLoader}-${gameVersion}` : gameVersion,
    type: normalizedLoader || "release",
    managedLoader: normalizedLoader || null,
    label: normalizedLoader ? `${gameVersion} (${formatLoaderName(normalizedLoader)})` : gameVersion
  };
}

async function ensureManagedModLibraryFile(gameDir, entry, fileName) {
  const storageDir = getManagedModsLibraryDir(gameDir, entry?.gameVersion, entry?.loader);
  const libraryPath = path.join(storageDir, fileName);
  if (fs.existsSync(libraryPath)) {
    return libraryPath;
  }

  const legacyPath = path.join(gameDir, "mods", fileName);
  if (fs.existsSync(legacyPath)) {
    await fsp.mkdir(storageDir, { recursive: true });
    await fsp.copyFile(legacyPath, libraryPath).catch(() => {});
    if (fs.existsSync(libraryPath)) {
      return libraryPath;
    }
    return legacyPath;
  }

  return libraryPath;
}

async function collectManagedModFilesForSync(gameDir, entries) {
  const activeFiles = new Map();

  for (const entry of entries) {
    for (const fileName of entry.files || []) {
      if (!fileName) {
        continue;
      }

      const sourcePath = await ensureManagedModLibraryFile(gameDir, entry, fileName);
      if (fs.existsSync(sourcePath)) {
        activeFiles.set(fileName, sourcePath);
      }
    }
  }

  return activeFiles;
}

async function readManagedModsManifest(gameDir) {
  const manifestPath = getManagedModsManifestPath(gameDir);
  try {
    const raw = await fsp.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const projects = {};
    for (const [key, entry] of Object.entries(parsed?.projects ?? {})) {
      const normalizedEntry = normalizeManagedModEntry(key, entry);
      if (normalizedEntry) {
        projects[normalizedEntry.installId] = normalizedEntry;
      }
    }

    return {
      projects,
      loaders: parsed?.loaders ?? {}
    };
  } catch (error) {
    return {
      projects: {},
      loaders: {}
    };
  }
}

async function writeManagedModsManifest(gameDir, manifest) {
  const manifestPath = getManagedModsManifestPath(gameDir);
  const projects = {};
  for (const entry of getManagedModEntries(manifest)) {
    projects[entry.installId] = entry;
  }
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  await fsp.writeFile(
    manifestPath,
    JSON.stringify(
      {
        projects,
        loaders: manifest?.loaders ?? {}
      },
      null,
      2
    ),
    "utf8"
  );
}

function mapModrinthSearchHit(hit) {
  const supportedLoaders = Array.from(
    new Set(
      [...(Array.isArray(hit?.display_categories) ? hit.display_categories : []), ...(Array.isArray(hit?.categories) ? hit.categories : [])]
        .map(normalizeModLoader)
        .filter(Boolean)
    )
  );

  return {
    projectId: hit?.project_id || hit?.slug || "",
    slug: hit?.slug || "",
    title: hit?.title || "Bilinmeyen mod",
    description: hit?.description || "Aciklama yok.",
    iconUrl: hit?.icon_url || null,
    downloads: Number(hit?.downloads || 0),
    followers: Number(hit?.follows || 0),
    author: hit?.author || "Bilinmeyen",
    categories: Array.isArray(hit?.display_categories) ? hit.display_categories : [],
    supportedLoaders,
    latestVersion: hit?.latest_version || "",
    gameVersions: Array.isArray(hit?.versions) ? hit.versions : []
  };
}

function buildModrinthSearchUrl({ query, selectedVersion, loader, limit = 24, offset = 0 }) {
  const params = new URLSearchParams();
  const gameVersion = inferMinecraftVersionId(selectedVersion);
  const effectiveLoader = normalizeModLoader(loader) || getSelectedVersionLoaderHint(selectedVersion);
  const facets = [["project_type:mod"]];

  if (gameVersion) {
    facets.push([`versions:${gameVersion}`]);
  }

  if (effectiveLoader) {
    facets.push([`categories:${effectiveLoader}`]);
  }

  params.set("limit", String(Math.min(Math.max(Number(limit) || 24, 1), 50)));
  params.set("offset", String(Math.max(Number(offset) || 0, 0)));
  params.set("index", "downloads");
  params.set("facets", JSON.stringify(facets));
  if (`${query ?? ""}`.trim()) {
    params.set("query", `${query}`.trim());
  }

  return {
    url: `${MODRINTH_API_BASE}/search?${params.toString()}`,
    gameVersion,
    effectiveLoader,
    suggestedLoader: getSelectedVersionLoaderHint(selectedVersion)
  };
}

async function getModrinthVersion(versionId) {
  return fetchModrinthJson(`${MODRINTH_API_BASE}/version/${encodeURIComponent(versionId)}`);
}

async function getModrinthProject(projectId) {
  return fetchModrinthJson(`${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}`);
}

async function resolveModrinthProjectVersions(projectId, selectedVersion, requestedLoader) {
  const gameVersion = inferMinecraftVersionId(selectedVersion);
  const loader = inferModLoader(selectedVersion, requestedLoader);
  const params = new URLSearchParams();

  if (loader) {
    params.set("loaders", JSON.stringify([loader]));
  }

  if (gameVersion) {
    params.set("game_versions", JSON.stringify([gameVersion]));
  }

  return fetchModrinthJson(
    `${MODRINTH_API_BASE}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
  );
}

async function resolveModrinthProjectVersion(projectId, selectedVersion, requestedLoader) {
  const gameVersion = inferMinecraftVersionId(selectedVersion);
  const loader = inferModLoader(selectedVersion, requestedLoader);
  const versions = await resolveModrinthProjectVersions(projectId, selectedVersion, requestedLoader);

  if (!Array.isArray(versions) || !versions.length) {
    const versionLabel = gameVersion ? `${gameVersion}` : "secili surum";
    const loaderLabel = loader ? `${loader}` : "loader";
    throw new Error(`${projectId} icin ${versionLabel} / ${loaderLabel} uyumlu mod dosyasi bulunamadi.`);
  }

  return pickPreferredModrinthVersion(versions);
}

async function resolveModInstallTarget(selectedVersion, requestedLoader, projectId, loaderHint = "") {
  const gameVersion = inferMinecraftVersionId(selectedVersion);
  const selectedLoader = getSelectedVersionLoaderHint(selectedVersion);
  const effectiveLoader = normalizeModLoader(requestedLoader);
  const hintedLoader = pickSupportedModLoader(`${loaderHint ?? ""}`.split(/[,\s]+/));

  if (!selectedVersion?.id) {
    throw new Error("Mod kurmak icin once bir surum sec.");
  }

  if (!gameVersion) {
    throw new Error("Secili Minecraft surumu anlasilamadi.");
  }

  if (selectedLoader) {
    if (effectiveLoader && selectedLoader !== effectiveLoader) {
      throw new Error(`Secili surum ${selectedLoader}. ${effectiveLoader} modu icin uyumlu bir surum sec.`);
    }

    return {
      gameVersion,
      loader: effectiveLoader || selectedLoader,
      autoProvisionLoader: false,
      rootVersion: null
    };
  }

  if (effectiveLoader) {
    if (!supportsManagedLoaderAutoProvision(effectiveLoader)) {
      throw new Error(
        `${selectedVersion.id} vanilla gorunuyor. Simdilik otomatik loader kurulumu sadece Fabric ve Forge icin acik.`
      );
    }

    return {
      gameVersion,
      loader: effectiveLoader,
      autoProvisionLoader: true,
      rootVersion: null
    };
  }

  const versions = await resolveModrinthProjectVersions(projectId, selectedVersion, null);
  const rootVersion = pickPreferredModrinthVersion(versions);

  if (!rootVersion) {
    throw new Error(`${projectId} icin ${gameVersion} uyumlu mod dosyasi bulunamadi.`);
  }

  const detectedLoader = pickSupportedModLoader(rootVersion.loaders, hintedLoader) || hintedLoader;
  if (!detectedLoader) {
    throw new Error("Bu modun loader tipi anlasilamadi. Fabric veya Forge secip tekrar dene.");
  }

  if (!supportsManagedLoaderAutoProvision(detectedLoader)) {
    throw new Error(
      `${selectedVersion.id} vanilla gorunuyor. ${formatLoaderName(detectedLoader)} otomatik kurulumu henuz hazir degil.`
    );
  }

  return {
    gameVersion,
    loader: detectedLoader,
    autoProvisionLoader: true,
    rootVersion
  };
}

async function resolveProjectPresentation(projectId, fallbackMeta = {}) {
  const fallbackTitle = `${fallbackMeta?.title ?? projectId}`.trim() || projectId;
  const fallbackDescription = `${fallbackMeta?.description ?? ""}`.trim();
  const fallbackSlug = `${fallbackMeta?.slug ?? ""}`.trim();
  const fallbackIconUrl = `${fallbackMeta?.iconUrl ?? ""}`.trim() || null;
  const fallbackAuthor = `${fallbackMeta?.author ?? ""}`.trim() || null;

  try {
    const project = await getModrinthProject(projectId);
    return {
      slug: `${project?.slug ?? fallbackSlug}`.trim(),
      title: `${project?.title ?? fallbackTitle}`.trim() || fallbackTitle,
      description: `${project?.description ?? fallbackDescription}`.trim(),
      iconUrl: `${project?.icon_url ?? fallbackIconUrl ?? ""}`.trim() || null,
      author: fallbackAuthor
    };
  } catch (error) {
    return {
      slug: fallbackSlug,
      title: fallbackTitle,
      description: fallbackDescription,
      iconUrl: fallbackIconUrl,
      author: fallbackAuthor
    };
  }
}

async function installModrinthVersionRecursive(version, installState) {
  if (!version?.id || installState.versionIds.has(version.id)) {
    return;
  }

  installState.versionIds.add(version.id);

  for (const dependency of version.dependencies || []) {
    if (dependency?.dependency_type !== "required") {
      continue;
    }

    let dependencyVersion = null;
    if (dependency.version_id) {
      dependencyVersion = await getModrinthVersion(dependency.version_id);
    } else if (dependency.project_id) {
      dependencyVersion = await resolveModrinthProjectVersion(
        dependency.project_id,
        installState.selectedVersion,
        installState.loader
      );
    }

    if (dependencyVersion) {
      await installModrinthVersionRecursive(dependencyVersion, installState);
    }
  }

  const modFile = selectPrimaryModFile(version);
  if (!modFile?.url || !modFile?.filename) {
    throw new Error(`${version.name || version.id} icin indirilebilir jar dosyasi bulunamadi.`);
  }

  const projectId = `${version.project_id ?? ""}`.trim();
  if (!projectId) {
    throw new Error(`${version.name || version.id} icin proje kimligi bulunamadi.`);
  }

  const installId = buildManagedModInstallId(projectId, installState.gameVersion, installState.loader);
  const storageDir = getManagedModsLibraryDir(installState.gameDir, installState.gameVersion, installState.loader);
  await fsp.mkdir(storageDir, { recursive: true });

  const existingEntry = installState.manifest.projects[installId];
  for (const previousFile of existingEntry?.files || []) {
    if (previousFile && previousFile !== modFile.filename) {
      await fsp.unlink(path.join(storageDir, previousFile)).catch(() => {});
    }
  }

  const destinationPath = path.join(storageDir, modFile.filename);
  if (!fs.existsSync(destinationPath)) {
    await downloadFile(modFile.url, destinationPath, null, "Mod dosyasi indirilemedi.");
    installState.installedFiles.push(modFile.filename);
  } else {
    installState.skippedFiles.push(modFile.filename);
  }

  let presentation = installState.projectPresentation.get(projectId);
  if (!presentation) {
    const fallbackMeta =
      projectId === installState.rootProjectId
        ? installState.rootProjectMeta
        : {
            title: version.name || projectId
          };
    presentation = await resolveProjectPresentation(projectId, fallbackMeta);
    installState.projectPresentation.set(projectId, presentation);
  }

  setManagedModEntry(installState.manifest, {
    ...existingEntry,
    ...presentation,
    installId,
    projectId,
    versionId: version.id,
    versionNumber: version.version_number,
    gameVersion: installState.gameVersion,
    loader: installState.loader,
    title: presentation?.title || version.name || version.id,
    files: [modFile.filename],
    updatedAt: new Date().toISOString(),
    lastUpdateCheckAt: null,
    latestKnownVersionId: version.id,
    latestKnownVersionNumber: version.version_number || null
  });
}

async function searchModrinthMods(payload = {}) {
  const { url, gameVersion, effectiveLoader, suggestedLoader } = buildModrinthSearchUrl(payload);
  const result = await fetchModrinthJson(url);
  const gameDir = `${payload?.gameDir ?? ""}`.trim();
  const manifest = gameDir
    ? await readManagedModsManifest(gameDir)
    : {
        projects: {},
        loaders: {}
      };
  const hits = Array.isArray(result?.hits) ? result.hits.map(mapModrinthSearchHit) : [];
  const items = await Promise.all(
    hits.map(async (item) => {
      const installedEntry = getManagedModEntry(manifest, item.projectId, gameVersion, effectiveLoader);
      const matchesCurrentTarget = Boolean(installedEntry?.projectId);
      let latestCompatibleVersion = null;

      if (matchesCurrentTarget) {
        try {
          latestCompatibleVersion = await resolveModrinthProjectVersion(
            item.projectId,
            payload.selectedVersion,
            normalizeModLoader(payload.loader) || suggestedLoader
          );
        } catch (error) {
          latestCompatibleVersion = null;
        }
      }

      return {
        ...item,
        installed: matchesCurrentTarget,
        installedVersionId: matchesCurrentTarget ? installedEntry?.versionId || null : null,
        installedVersionNumber: matchesCurrentTarget ? installedEntry?.versionNumber || null : null,
        installedLoader: matchesCurrentTarget ? installedEntry?.loader || null : null,
        installedGameVersion: matchesCurrentTarget ? installedEntry?.gameVersion || null : null,
        hasUpdate: Boolean(
          matchesCurrentTarget &&
            installedEntry?.versionId &&
            latestCompatibleVersion?.id &&
            latestCompatibleVersion.id !== installedEntry.versionId
        )
      };
    })
  );

  return {
    ok: true,
    items,
    totalHits: Number(result?.total_hits || 0),
    gameVersion,
    effectiveLoader,
    suggestedLoader
  };
}

async function installModrinthMod(payload = {}) {
  const selectedVersion = payload?.selectedVersion;
  const gameDir = `${payload?.gameDir ?? ""}`.trim();
  const projectId = `${payload?.projectId ?? ""}`.trim();

  if (!gameDir) {
    throw new Error("Mod kurulumu icin oyun klasoru bulunamadi.");
  }

  if (!projectId) {
    throw new Error("Kurulacak mod secilemedi.");
  }

  const { loader, gameVersion, autoProvisionLoader, rootVersion: autoDetectedRootVersion } = await resolveModInstallTarget(
    selectedVersion,
    payload?.loader,
    projectId,
    payload?.loaderHint
  );
  const manifest = await readManagedModsManifest(gameDir);
  let preparedLoader = null;

  if (autoProvisionLoader) {
    preparedLoader = await ensureManagedLoaderReady(loader, gameVersion, gameDir);
    manifest.loaders[gameVersion] = {
      loader: preparedLoader.loader,
      gameVersion,
      version: preparedLoader.loaderVersion || preparedLoader.forgeVersion,
      artifact: preparedLoader.artifact || null,
      customId: preparedLoader.customId || null,
      profilePath: preparedLoader.profilePath || null,
      installerPath: preparedLoader.installerPath || null,
      updatedAt: new Date().toISOString()
    };
  }

  const rootVersion =
    autoDetectedRootVersion || (await resolveModrinthProjectVersion(projectId, selectedVersion, loader));
  const rootProjectMeta = {
    slug: `${payload?.projectMeta?.slug ?? ""}`.trim(),
    title: `${payload?.projectMeta?.title ?? rootVersion.name ?? projectId}`.trim() || projectId,
    description: `${payload?.projectMeta?.description ?? ""}`.trim(),
    iconUrl: `${payload?.projectMeta?.iconUrl ?? ""}`.trim() || null,
    author: `${payload?.projectMeta?.author ?? ""}`.trim() || null
  };
  const installState = {
    gameDir,
    loader,
    gameVersion,
    selectedVersion,
    manifest,
    rootProjectId: projectId,
    rootProjectMeta,
    projectPresentation: new Map(),
    versionIds: new Set(),
    installedFiles: [],
    skippedFiles: []
  };

  installState.projectPresentation.set(projectId, rootProjectMeta);
  await installModrinthVersionRecursive(rootVersion, installState);
  await writeManagedModsManifest(gameDir, installState.manifest);
  const installedEntry = getManagedModEntry(installState.manifest, projectId, gameVersion, loader);

  return {
    ok: true,
    loader,
    gameVersion,
    projectId,
    installId: installedEntry?.installId || buildManagedModInstallId(projectId, gameVersion, loader),
    versionId: rootVersion.id,
    versionNumber: rootVersion.version_number,
    title: installedEntry?.title || rootProjectMeta.title || rootVersion.name || projectId,
    installedFiles: installState.installedFiles,
    skippedFiles: installState.skippedFiles,
    preparedLoader
  };
}

async function removeInstalledModFiles(gameDir, entry, manifest) {
  const storageDir = getManagedModsLibraryDir(gameDir, entry?.gameVersion, entry?.loader);
  const otherEntries = getManagedModEntries(manifest).filter((item) => item.installId !== entry.installId);
  const otherTrackedFiles = new Set(
    otherEntries.flatMap((item) => (Array.isArray(item.files) ? item.files : [])).filter(Boolean)
  );

  for (const fileName of entry.files || []) {
    if (!fileName) {
      continue;
    }

    await fsp.unlink(path.join(storageDir, fileName)).catch(() => {});

    if (!otherTrackedFiles.has(fileName)) {
      await fsp.unlink(path.join(gameDir, "mods", fileName)).catch(() => {});
    }
  }

  const storageEntries = await fsp.readdir(storageDir).catch(() => []);
  if (!storageEntries.length) {
    await fsp.rmdir(storageDir).catch(() => {});
  }
}

async function listInstalledMods(payload = {}) {
  const gameDir = `${payload?.gameDir ?? ""}`.trim();
  if (!gameDir) {
    throw new Error("Kurulu mod listesi icin oyun klasoru bulunamadi.");
  }

  const gameVersion = `${payload?.gameVersion ?? inferMinecraftVersionId(payload?.selectedVersion) ?? ""}`.trim();
  const loader = normalizeModLoader(payload?.loader) || getSelectedVersionLoaderHint(payload?.selectedVersion);
  const manifest = await readManagedModsManifest(gameDir);
  const filteredEntries = getManagedModEntries(manifest)
    .filter(
      (entry) =>
        (!gameVersion || entry.gameVersion === gameVersion) &&
        (!loader || entry.loader === loader)
    )
    .sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || 0);
      const leftTime = Date.parse(left.updatedAt || 0);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return `${left.title}`.localeCompare(`${right.title}`, "tr");
    });

  let items = filteredEntries.map((entry) => ({
    ...entry,
    pageUrl: entry.slug ? `https://modrinth.com/mod/${entry.slug}` : null,
    hasUpdate: Boolean(
      entry.versionId &&
        entry.latestKnownVersionId &&
        entry.latestKnownVersionId !== entry.versionId
    ),
    updateChecked: Boolean(entry.lastUpdateCheckAt),
    updateError: null
  }));

  if (payload?.checkUpdates) {
    items = await Promise.all(
      filteredEntries.map(async (entry) => {
        const versionDescriptor = createModSelectionVersionDescriptor(entry.gameVersion, entry.loader);

        try {
          const latestCompatibleVersion = await resolveModrinthProjectVersion(
            entry.projectId,
            versionDescriptor,
            entry.loader
          );
          const nextEntry = setManagedModEntry(manifest, {
            ...entry,
            lastUpdateCheckAt: new Date().toISOString(),
            latestKnownVersionId: latestCompatibleVersion.id || null,
            latestKnownVersionNumber: latestCompatibleVersion.version_number || null
          });

          return {
            ...nextEntry,
            pageUrl: nextEntry.slug ? `https://modrinth.com/mod/${nextEntry.slug}` : null,
            hasUpdate: Boolean(
              nextEntry?.versionId &&
                latestCompatibleVersion?.id &&
                nextEntry.versionId !== latestCompatibleVersion.id
            ),
            updateChecked: true,
            updateError: null
          };
        } catch (error) {
          const nextEntry = setManagedModEntry(manifest, {
            ...entry,
            lastUpdateCheckAt: new Date().toISOString()
          });

          return {
            ...nextEntry,
            pageUrl: nextEntry.slug ? `https://modrinth.com/mod/${nextEntry.slug}` : null,
            hasUpdate: Boolean(
              nextEntry?.versionId &&
                nextEntry?.latestKnownVersionId &&
                nextEntry.latestKnownVersionId !== nextEntry.versionId
            ),
            updateChecked: true,
            updateError: error.message || "Guncelleme denetlenemedi."
          };
        }
      })
    );

    await writeManagedModsManifest(gameDir, manifest);
  }

  return {
    ok: true,
    items,
    gameVersion,
    loader,
    totalInstalled: items.length
  };
}

async function removeInstalledMod(payload = {}) {
  const gameDir = `${payload?.gameDir ?? ""}`.trim();
  const installId = `${payload?.installId ?? ""}`.trim();

  if (!gameDir) {
    throw new Error("Mod silmek icin oyun klasoru bulunamadi.");
  }

  if (!installId) {
    throw new Error("Silinecek mod secilemedi.");
  }

  const manifest = await readManagedModsManifest(gameDir);
  const entry = normalizeManagedModEntry(installId, manifest.projects?.[installId]);
  if (!entry) {
    throw new Error("Secilen mod artik bulunamiyor.");
  }

  await removeInstalledModFiles(gameDir, entry, manifest);
  delete manifest.projects[installId];
  await writeManagedModsManifest(gameDir, manifest);

  return {
    ok: true,
    installId,
    title: entry.title,
    gameVersion: entry.gameVersion,
    loader: entry.loader
  };
}

async function clearInstalledMods(payload = {}) {
  const gameDir = `${payload?.gameDir ?? ""}`.trim();
  if (!gameDir) {
    throw new Error("Mod temizlemek icin oyun klasoru bulunamadi.");
  }

  const gameVersion = `${payload?.gameVersion ?? inferMinecraftVersionId(payload?.selectedVersion) ?? ""}`.trim();
  const loader = normalizeModLoader(payload?.loader) || getSelectedVersionLoaderHint(payload?.selectedVersion);
  const manifest = await readManagedModsManifest(gameDir);
  const targets = getManagedModEntries(manifest).filter(
    (entry) =>
      (!gameVersion || entry.gameVersion === gameVersion) &&
      (!loader || entry.loader === loader)
  );

  for (const entry of targets) {
    await removeInstalledModFiles(gameDir, entry, manifest);
    delete manifest.projects[entry.installId];
  }

  await writeManagedModsManifest(gameDir, manifest);

  return {
    ok: true,
    removedCount: targets.length,
    gameVersion,
    loader
  };
}

async function syncManagedModsForLaunch(gameDir, gameVersion, loader) {
  const normalizedLoader = normalizeModLoader(loader);
  const manifest = await readManagedModsManifest(gameDir);
  const allEntries = getManagedModEntries(manifest);
  const activeEntries =
    gameVersion && normalizedLoader
      ? allEntries.filter((entry) => entry.gameVersion === gameVersion && entry.loader === normalizedLoader)
      : [];
  const trackedFiles = new Set(
    allEntries.flatMap((entry) => (Array.isArray(entry.files) ? entry.files : [])).filter(Boolean)
  );
  const modsDir = path.join(gameDir, "mods");

  await fsp.mkdir(modsDir, { recursive: true });
  await Promise.all(
    allEntries.map(async (entry) => {
      await Promise.all((entry.files || []).map((fileName) => ensureManagedModLibraryFile(gameDir, entry, fileName)));
    })
  );

  const activeFiles = await collectManagedModFilesForSync(gameDir, activeEntries);

  for (const fileName of trackedFiles) {
    if (!activeFiles.has(fileName)) {
      await fsp.unlink(path.join(modsDir, fileName)).catch(() => {});
    }
  }

  for (const [fileName, sourcePath] of activeFiles.entries()) {
    await fsp.copyFile(sourcePath, path.join(modsDir, fileName));
  }

  return {
    syncedEntries: activeEntries.length,
    syncedFiles: Array.from(activeFiles.keys())
  };
}

async function removeDirectorySafe(targetPath) {
  if (fs.existsSync(targetPath)) {
    await fsp.rm(targetPath, { recursive: true, force: true });
  }
}

async function findJavaExecutableInDirectory(baseDir) {
  const executableName = process.platform === "win32" ? "javaw.exe" : "java";

  async function walk(currentDir, depth = 0) {
    if (depth > 4) {
      return null;
    }

    const directCandidate = path.join(currentDir, executableName);
    if (fs.existsSync(directCandidate)) {
      return directCandidate;
    }

    const binCandidate = path.join(currentDir, "bin", executableName);
    if (fs.existsSync(binCandidate)) {
      return binCandidate;
    }

    const entries = await fsp.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const found = await walk(path.join(currentDir, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }

    return null;
  }

  return walk(baseDir, 0);
}

function configureElectronStorage() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const baseDir = path.join(localAppData, APP_NAME);
  const userDataDir = path.join(baseDir, "User Data");
  const sessionDataDir = path.join(baseDir, "Session Data");
  const logsDir = path.join(baseDir, "Logs");
  const cacheDir = path.join(sessionDataDir, "Cache");

  for (const dirPath of [baseDir, userDataDir, sessionDataDir, logsDir, cacheDir]) {
    ensureDirectorySync(dirPath);
  }

  app.setPath("userData", userDataDir);
  app.setPath("sessionData", sessionDataDir);
  app.setAppLogsPath(logsDir);

  // Windows'ta cache'i kullanici verisinden ayirip sabit bir klasore almak
  // "Unable to move the cache" hatalarini onler.
  app.commandLine.appendSwitch("disk-cache-dir", cacheDir);
}

configureElectronStorage();

function sendLauncherEvent(type, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("launcher:event", { type, payload });
}

function isBenignRendererConsoleMessage(message) {
  const text = `${message ?? ""}`.toLowerCase();
  return text.includes("electron security warning") || text.includes("third-party cookie will be blocked");
}

function getIconPath() {
  const runtimeIcoPath = path.join(process.resourcesPath, "icon.ico");
  if (fs.existsSync(runtimeIcoPath)) {
    return runtimeIcoPath;
  }

  const devIcoPath = path.join(__dirname, "../../build/icon.ico");
  if (fs.existsSync(devIcoPath)) {
    return devIcoPath;
  }

  const pngPath = path.join(__dirname, "../renderer/assets/skyland-logo.png");
  return fs.existsSync(pngPath) ? pngPath : undefined;
}

function createMinecraftOverlayWindow() {
  if (minecraftOverlayWindow && !minecraftOverlayWindow.isDestroyed()) {
    return minecraftOverlayWindow;
  }

  minecraftOverlayWindow = new BrowserWindow({
    width: 68,
    height: 68,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  minecraftOverlayWindow.setAlwaysOnTop(true, "pop-up-menu");
  minecraftOverlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });
  minecraftOverlayWindow.setIgnoreMouseEvents(true, {
    forward: true
  });
  minecraftOverlayWindow.setBackgroundColor("#00000000");
  minecraftOverlayWindow.loadFile(path.join(__dirname, "../overlay/index.html"));
  minecraftOverlayWindow.on("closed", () => {
    minecraftOverlayWindow = null;
  });

  return minecraftOverlayWindow;
}

function hideMinecraftOverlayWindow() {
  if (minecraftOverlayWindow && !minecraftOverlayWindow.isDestroyed()) {
    minecraftOverlayWindow.hide();
  }
}

function closeMinecraftOverlayWindow() {
  if (minecraftOverlayWindow && !minecraftOverlayWindow.isDestroyed()) {
    minecraftOverlayWindow.close();
  }
  minecraftOverlayWindow = null;
}

async function getWindowsProcessBounds(pid) {
  const script = [
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class WinApi {",
    "  [StructLayout(LayoutKind.Sequential)]",
    "  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
    "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);",
    "}",
    "'@",
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if (-not $p) { return }",
    "if ($p.MainWindowHandle -eq 0) { return }",
    "if (-not [WinApi]::IsWindowVisible($p.MainWindowHandle)) { return }",
    "if ([WinApi]::IsIconic($p.MainWindowHandle)) { return }",
    "$rect = New-Object WinApi+RECT",
    "[WinApi]::GetWindowRect($p.MainWindowHandle, [ref]$rect) | Out-Null",
    "if (($rect.Right - $rect.Left) -le 0 -or ($rect.Bottom - $rect.Top) -le 0) { return }",
    "[pscustomobject]@{",
    "  x = $rect.Left;",
    "  y = $rect.Top;",
    "  width = $rect.Right - $rect.Left;",
    "  height = $rect.Bottom - $rect.Top",
    "} | ConvertTo-Json -Compress"
  ].join("; ");

  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]);

  const payload = `${stdout ?? ""}`.trim();
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

function isWindowNearDisplayBounds(bounds) {
  if (!bounds) {
    return false;
  }

  const display = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, 1),
    height: Math.max(bounds.height, 1)
  });

  return (
    Math.abs(bounds.x - display.bounds.x) <= 32 &&
    Math.abs(bounds.y - display.bounds.y) <= 32 &&
    Math.abs(bounds.width - display.bounds.width) <= 32 &&
    Math.abs(bounds.height - display.bounds.height) <= 72
  );
}

async function sendMinecraftFullscreenHotkey(pid) {
  const script = [
    "$wshell = New-Object -ComObject WScript.Shell",
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if (-not $p) { exit 1 }",
    "$deadline = (Get-Date).AddSeconds(20)",
    "while ((Get-Date) -lt $deadline) {",
    "  $p.Refresh()",
    "  if ($p.MainWindowHandle -ne 0) { break }",
    "  Start-Sleep -Milliseconds 400",
    "}",
    "if ($p.MainWindowHandle -eq 0) { exit 2 }",
    "$null = $wshell.AppActivate($p.Id)",
    "Start-Sleep -Milliseconds 650",
    "$wshell.SendKeys('{F11}')"
  ].join("\n");

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]);
}

async function ensureMinecraftFullscreen(pid) {
  if (process.platform !== "win32" || !pid) {
    return;
  }

  let attempts = 0;
  const maxAttempts = 3;
  const deadline = Date.now() + 25000;

  while (Date.now() < deadline) {
    const bounds = await getWindowsProcessBounds(pid).catch(() => null);
    if (bounds) {
      if (isWindowNearDisplayBounds(bounds)) {
        return;
      }

      if (attempts < maxAttempts) {
        await sendMinecraftFullscreenHotkey(pid).catch(() => {});
        attempts += 1;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

function getFallbackMinecraftBounds() {
  const display = screen.getPrimaryDisplay();
  return {
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height
  };
}

async function syncMinecraftOverlayWindow(pid) {
  if (process.platform !== "win32") {
    return;
  }

  const overlayWindow = createMinecraftOverlayWindow();
  const bounds = (await getWindowsProcessBounds(pid).catch(() => null)) ?? getFallbackMinecraftBounds();
  if (!bounds) {
    hideMinecraftOverlayWindow();
    return;
  }

  const display = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, 1),
    height: Math.max(bounds.height, 1)
  });
  const overlaySize = Math.max(52, Math.min(72, Math.round(bounds.width * 0.034)));
  const x = Math.max(display.workArea.x + 8, bounds.x + MINECRAFT_OVERLAY_MARGIN);
  const y = Math.max(display.workArea.y + 8, bounds.y + MINECRAFT_OVERLAY_MARGIN);

  overlayWindow.setBounds({
    x,
    y,
    width: overlaySize,
    height: overlaySize
  });
  overlayWindow.show();
  overlayWindow.moveTop();
}

function stopMinecraftOverlayTracking() {
  if (minecraftOverlayTimeout) {
    clearTimeout(minecraftOverlayTimeout);
    minecraftOverlayTimeout = null;
  }
  if (minecraftOverlayInterval) {
    clearInterval(minecraftOverlayInterval);
    minecraftOverlayInterval = null;
  }
  closeMinecraftOverlayWindow();
}

function startMinecraftOverlayTracking(pid, fullscreenEnabled) {
  stopMinecraftOverlayTracking();
  if (!fullscreenEnabled || !pid || process.platform !== "win32") {
    return;
  }

  minecraftOverlayTimeout = setTimeout(() => {
    ensureMinecraftFullscreen(pid)
      .catch((error) => {
        sendLauncherEvent("warning", {
          message: `Tam ekran modu uygulanamadi: ${error.message}`
        });
      })
      .finally(() => {
        minecraftOverlayTimeout = null;
      });
  }, 1200);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    center: true,
    title: "SKYLAND 3",
    backgroundColor: "#090b12",
    icon: getIconPath(),
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer load failed:", { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on("did-start-loading", () => {});
  mainWindow.webContents.on("dom-ready", () => {});
  mainWindow.webContents.on("did-finish-load", () => {});

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2 && !isBenignRendererConsoleMessage(message)) {
      console.error("Renderer console:", { message, line, sourceId });
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1200);
}

async function ensureGameDirectory(gameDir) {
  await fsp.mkdir(gameDir, { recursive: true });
  await fsp.mkdir(path.join(gameDir, "versions"), { recursive: true });
}

function formatMemory(memoryMb) {
  if (memoryMb % 1024 === 0) {
    return `${memoryMb / 1024}G`;
  }
  return `${memoryMb}M`;
}

function sanitizeNickname(value) {
  const raw = `${value ?? ""}`.trim();
  const safe = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  return safe || "SkylandTiger";
}

function inferLocalVersionType(versionId, versionJson) {
  const fingerprint = `${versionId} ${versionJson?.inheritsFrom ?? ""} ${versionJson?.type ?? ""}`.toLowerCase();
  if (fingerprint.includes("optifine")) {
    return "optifine";
  }
  if (fingerprint.includes("fabric")) {
    return "fabric";
  }
  if (fingerprint.includes("forge")) {
    return "forge";
  }
  if (fingerprint.includes("quilt")) {
    return "quilt";
  }
  return versionJson?.type ?? "custom";
}

async function scanLocalVersions(baseDir) {
  const versionsDir = path.join(baseDir, "versions");
  if (!fs.existsSync(versionsDir)) {
    return [];
  }

  const entries = await fsp.readdir(versionsDir, { withFileTypes: true });
  const versions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const folderName = entry.name;
    const jsonPath = path.join(versionsDir, folderName, `${folderName}.json`);
    if (!fs.existsSync(jsonPath)) {
      continue;
    }

    try {
      const versionJson = JSON.parse(await fsp.readFile(jsonPath, "utf8"));
      const inferredType = inferLocalVersionType(folderName, versionJson);
      versions.push({
        id: versionJson.id || folderName,
        type: inferredType,
        customId: folderName,
        baseVersion: versionJson.inheritsFrom || versionJson.id || folderName,
        source: "local",
        installed: true,
        root: baseDir,
        label: `${folderName} (${inferredType})`,
        releaseTime: versionJson.releaseTime || null
      });
    } catch (error) {
      versions.push({
        id: folderName,
        type: "custom",
        customId: folderName,
        baseVersion: folderName,
        source: "local",
        installed: true,
        root: baseDir,
        label: `${folderName} (custom)`,
        releaseTime: null
      });
    }
  }

  return versions;
}

async function getAvailableVersions() {
  const state = await readState();
  const gameDir = state.settings.gameDir;
  const showSnapshots = Boolean(state.settings.showSnapshots);
  const defaultMinecraftDir = path.join(app.getPath("appData"), ".minecraft");
  const officialVersions = [];
  const manifest = await readManagedModsManifest(gameDir);

  try {
    const response = await fetch(MOJANG_MANIFEST_URL);
    if (response.ok) {
      const payload = await response.json();
      for (const version of payload.versions || []) {
        officialVersions.push({
          id: version.id,
          type: version.type,
          source: "official",
          installed: false,
          label: `${version.id} (${version.type})`,
          releaseTime: version.releaseTime
        });
      }
    }
  } catch (error) {
    sendLauncherEvent("warning", {
      message: "Mojang surum listesi alinamadi, yerel surumler kullaniliyor."
    });
  }

  const [localSelectedDir, localDefaultDir] = await Promise.all([
    scanLocalVersions(gameDir),
    scanLocalVersions(defaultMinecraftDir)
  ]);

  const officialMap = new Map(officialVersions.map((entry) => [entry.id, entry]));
  for (const localVersion of [...localSelectedDir, ...localDefaultDir]) {
    if (officialMap.has(localVersion.id)) {
      officialMap.set(localVersion.id, {
        ...officialMap.get(localVersion.id),
        installed: true,
        root: localVersion.root,
        customId: localVersion.customId
      });
    }
  }

  const mergedOfficial = Array.from(officialMap.values());
  const customOnly = [...localSelectedDir, ...localDefaultDir].filter(
    (entry) => !officialMap.has(entry.id) || entry.customId !== entry.id
  );
  const dedupedCustom = Array.from(
    new Map(customOnly.map((entry) => [`${entry.root}:${entry.customId}`, entry])).values()
  );

  const baseVersions = [...dedupedCustom, ...mergedOfficial];
  const managedVersions = Object.entries(manifest.loaders || {})
    .map(([gameVersion, entry]) => {
      const loader = normalizeModLoader(entry?.loader);
      if (!loader) {
        return null;
      }

      const hasNativeLoaderVersion = baseVersions.some(
        (version) => inferMinecraftVersionId(version) === gameVersion && inferModLoader(version) === loader
      );
      if (hasNativeLoaderVersion) {
        return null;
      }

      const baseVersion =
        baseVersions.find(
          (version) => inferMinecraftVersionId(version) === gameVersion && !inferModLoader(version)
        ) ||
        baseVersions.find((version) => inferMinecraftVersionId(version) === gameVersion) ||
        null;

      return {
        id: gameVersion,
        type: loader,
        baseVersion: gameVersion,
        customId: `managed-${loader}-${gameVersion}`,
        source: "managed",
        installed: true,
        root: gameDir,
        label: `${gameVersion} (${formatLoaderName(loader)})`,
        releaseTime: baseVersion?.releaseTime || null,
        managedLoader: loader,
        managedLoaderVersion: entry?.version || null
      };
    })
    .filter(Boolean);

  const filteredVersions = [...baseVersions, ...managedVersions].filter(
    (entry) => showSnapshots || !isSnapshotLikeVersion(entry)
  );

  return filteredVersions.sort((left, right) => {
    const leftTime = left.releaseTime ? Date.parse(left.releaseTime) : 0;
    const rightTime = right.releaseTime ? Date.parse(right.releaseTime) : 0;
    return rightTime - leftTime;
  });
}

async function getManifestVersions() {
  const cacheFreshForMs = 15 * 60 * 1000;
  if (Date.now() - versionManifestCache.fetchedAt < cacheFreshForMs && versionManifestCache.versions.length) {
    return versionManifestCache.versions;
  }

  const response = await fetch(MOJANG_MANIFEST_URL);
  if (!response.ok) {
    throw new Error("Mojang surum manifesti alinamadi.");
  }

  const payload = await response.json();
  versionManifestCache.fetchedAt = Date.now();
  versionManifestCache.versions = payload.versions || [];
  return versionManifestCache.versions;
}

function parseJavaMajorVersion(raw) {
  const text = `${raw ?? ""}`;
  const legacyMatch = text.match(/version "1\.(\d+)\./i);
  if (legacyMatch) {
    return Number(legacyMatch[1]);
  }

  const modernMatch = text.match(/version "(\d+)(?:\.\d+)?/i);
  if (modernMatch) {
    return Number(modernMatch[1]);
  }

  return null;
}

async function detectJavaMajorVersion(javaPath) {
  const { stdout, stderr } = await execFileAsync(javaPath, ["-version"]);
  const combined = `${stdout}\n${stderr}`;
  const majorVersion = parseJavaMajorVersion(combined);
  if (!majorVersion) {
    throw new Error("Java surumu algilanamadi.");
  }

  return majorVersion;
}

function coerceJavawPath(javaPath) {
  if (!javaPath || process.platform !== "win32") {
    return javaPath;
  }

  if (javaPath.toLowerCase().endsWith("java.exe")) {
    const javawPath = `${javaPath.slice(0, -8)}javaw.exe`;
    if (fs.existsSync(javawPath)) {
      return javawPath;
    }
  }

  return javaPath;
}

async function findDefaultJavaExecutable() {
  if (process.platform === "win32") {
    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const javawCandidate = path.join(javaHome, "bin", "javaw.exe");
      if (fs.existsSync(javawCandidate)) {
        return javawCandidate;
      }
    }

    try {
      const { stdout } = await execFileAsync("where.exe", ["javaw"]);
      const javawPath = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (javawPath) {
        return javawPath;
      }
    } catch (error) {
      // fallback below
    }

    return "javaw";
  }

  return "java";
}

async function ensureManagedJavaInstalled(requiredJava) {
  if (managedJavaInstalls.has(requiredJava)) {
    return managedJavaInstalls.get(requiredJava);
  }

  const installPromise = (async () => {
    const managedRoot = path.join(app.getPath("userData"), "managed-java", `temurin-${requiredJava}`);
    const existingJava = await findJavaExecutableInDirectory(managedRoot);
    if (existingJava) {
      return existingJava;
    }

    const tempRoot = path.join(app.getPath("temp"), APP_NAME, "java");
    const zipPath = path.join(tempRoot, `temurin-${requiredJava}.zip`);
    const adoptiumOs = process.platform === "win32" ? "windows" : process.platform;
    const adoptiumArch = process.arch === "x64" ? "x64" : process.arch;
    const binaryUrl = `${ADOPTIUM_BINARY_URL}/${requiredJava}/ga/${adoptiumOs}/${adoptiumArch}/jre/hotspot/normal/eclipse`;

    await fsp.mkdir(tempRoot, { recursive: true });

    sendLauncherEvent("java-install-status", {
      stage: "download-start",
      requiredJava,
      message: `Java ${requiredJava} indiriliyor...`
    });

    const sevenZip = getBundled7ZipPath();
    if (process.platform === "win32" && (!sevenZip || !fs.existsSync(sevenZip))) {
      throw new Error("7zip araci bulunamadi.");
    }

    let archiveHealthy = false;
    let lastArchiveError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (process.platform === "win32") {
        await downloadFileWindows(binaryUrl, zipPath);
      } else {
        await downloadFile(binaryUrl, zipPath, (received, total) => {
          sendLauncherEvent("java-download-status", {
            requiredJava,
            progress: received,
            total
          });
        }, "Java paketi indirilemedi.");
      }

      const zipStat = await fsp.stat(zipPath).catch(() => null);
      if (!zipStat || zipStat.size < 20 * 1024 * 1024) {
        lastArchiveError = new Error("Java paketi eksik indirildi.");
        await fsp.unlink(zipPath).catch(() => {});
        continue;
      }

      try {
        if (process.platform === "win32") {
          await execFileAsync(sevenZip, ["t", zipPath]);
        }
        archiveHealthy = true;
        break;
      } catch (error) {
        lastArchiveError = error;
        await fsp.unlink(zipPath).catch(() => {});
      }
    }

    if (!archiveHealthy) {
      throw new Error(
        `Java paketi bozuk indi. ${lastArchiveError?.message ? `${lastArchiveError.message}` : "Tekrar dene."}`
      );
    }

    sendLauncherEvent("java-install-status", {
      stage: "extract-start",
      requiredJava,
      message: `Java ${requiredJava} kuruluyor...`
    });

    await removeDirectorySafe(managedRoot);
    await fsp.mkdir(managedRoot, { recursive: true });
    await fsp.mkdir(path.dirname(managedRoot), { recursive: true });

    if (process.platform === "win32") {
      await execFileAsync(sevenZip, [
        "x",
        zipPath,
        `-o${managedRoot}`,
        "-y"
      ]);
    } else {
      throw new Error("Otomatik Java kurulumu bu sistemde desteklenmiyor.");
    }

    const managedJavaPath = await findJavaExecutableInDirectory(managedRoot);
    await fsp.unlink(zipPath).catch(() => {});

    if (!managedJavaPath) {
      throw new Error("Kurulan Java icinde javaw.exe bulunamadi.");
    }

    sendLauncherEvent("java-install-status", {
      stage: "ready",
      requiredJava,
      message: `Java ${requiredJava} hazir.`
    });

    return managedJavaPath;
  })();

  managedJavaInstalls.set(requiredJava, installPromise);
  try {
    return await installPromise;
  } finally {
    managedJavaInstalls.delete(requiredJava);
  }
}

function inferRequiredJavaFromVersionId(versionId) {
  const id = `${versionId ?? ""}`.toLowerCase();
  const releaseMatch = id.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (releaseMatch) {
    const major = Number(releaseMatch[1]);
    const minor = Number(releaseMatch[2]);
    const patch = Number(releaseMatch[3] || 0);
    if (major > 1 || (major === 1 && minor >= 21)) {
      return 21;
    }
    if (major === 1 && minor === 20 && patch >= 5) {
      return 21;
    }
    if (major > 1 || (major === 1 && minor >= 18)) {
      return 17;
    }
    return 8;
  }

  const snapshotMatch = id.match(/^(\d{2})w(\d{2})[a-z]?/);
  if (snapshotMatch) {
    const year = Number(snapshotMatch[1]);
    if (year >= 24) {
      return 21;
    }
    if (year >= 21) {
      return 17;
    }
  }

  return 8;
}

async function getRequiredJavaVersion(selectedVersion, gameDir) {
  if (selectedVersion?.source === "local" && selectedVersion?.customId && selectedVersion?.root) {
    try {
      const localJsonPath = path.join(selectedVersion.root, "versions", selectedVersion.customId, `${selectedVersion.customId}.json`);
      if (fs.existsSync(localJsonPath)) {
        const localJson = JSON.parse(await fsp.readFile(localJsonPath, "utf8"));
        if (localJson?.javaVersion?.majorVersion) {
          return Number(localJson.javaVersion.majorVersion);
        }
        if (localJson?.inheritsFrom) {
          return inferRequiredJavaFromVersionId(localJson.inheritsFrom);
        }
      }
    } catch (error) {
      // fallback below
    }
  }

  try {
    const manifestVersions = await getManifestVersions();
    const entry = manifestVersions.find((item) => item.id === selectedVersion?.id);
    if (entry?.url) {
      if (!versionMetaCache.has(entry.url)) {
        const response = await fetch(entry.url);
        if (response.ok) {
          versionMetaCache.set(entry.url, await response.json());
        }
      }

      const versionMeta = versionMetaCache.get(entry.url);
      if (versionMeta?.javaVersion?.majorVersion) {
        return Number(versionMeta.javaVersion.majorVersion);
      }
    }
  } catch (error) {
    // fallback below
  }

  return inferRequiredJavaFromVersionId(selectedVersion?.baseVersion || selectedVersion?.id);
}

async function resolveLaunchJava(settings, selectedVersion) {
  const requestedJavaPath = `${settings.javaPath ?? ""}`.trim();
  const requiredJava = await getRequiredJavaVersion(selectedVersion, settings.gameDir);
  const javaPath = coerceJavawPath(requestedJavaPath) || (await findDefaultJavaExecutable());
  const needsStrictLegacyJava = requiredJava === 8;

  let installedJava;
  try {
    installedJava = await detectJavaMajorVersion(javaPath);
  } catch (error) {
    installedJava = null;
  }

  if (installedJava && installedJava >= requiredJava && (!needsStrictLegacyJava || installedJava === requiredJava)) {
    return {
      javaPath,
      requiredJava,
      installedJava,
      autoInstalled: false
    };
  }

  const managedJavaPath = await ensureManagedJavaInstalled(requiredJava);
  const managedJavaVersion = await detectJavaMajorVersion(managedJavaPath);

  settings.javaPath = managedJavaPath;
  await patchState({
    settings: {
      javaPath: managedJavaPath
    }
  });

  return {
    javaPath: managedJavaPath,
    requiredJava,
    installedJava: managedJavaVersion,
    autoInstalled: true
  };
}

async function updateMinecraftOptions(settings) {
  const optionsPath = path.join(settings.gameDir, "options.txt");
  const entries = new Map();

  if (fs.existsSync(optionsPath)) {
    const raw = await fsp.readFile(optionsPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1);
      entries.set(key, value);
    }
  }

  entries.set("lang", settings.language);
  entries.set("fullscreen", String(Boolean(settings.fullscreen)));
  entries.set("overrideWidth", String(settings.resolutionWidth));
  entries.set("overrideHeight", String(settings.resolutionHeight));

  const serialized = Array.from(entries.entries())
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");

  await fsp.writeFile(optionsPath, serialized, "utf8");
}

async function resolveManagedLoaderForLaunch(gameDir, selectedVersion) {
  const gameVersion = inferMinecraftVersionId(selectedVersion);
  if (!gameVersion) {
    return null;
  }

  const manifest = await readManagedModsManifest(gameDir);
  const entry = manifest.loaders?.[gameVersion];
  if (!entry?.loader) {
    return null;
  }

  if (entry.loader === "fabric") {
    const preparedLoader = await ensureManagedFabricProfile(gameDir, gameVersion);
    if (
      preparedLoader.loaderVersion !== entry.version ||
      preparedLoader.customId !== entry.customId ||
      preparedLoader.profilePath !== entry.profilePath
    ) {
      manifest.loaders[gameVersion] = {
        loader: preparedLoader.loader,
        gameVersion,
        version: preparedLoader.loaderVersion,
        artifact: null,
        customId: preparedLoader.customId,
        profilePath: preparedLoader.profilePath,
        installerPath: null,
        updatedAt: new Date().toISOString()
      };
      await writeManagedModsManifest(gameDir, manifest);
    }

    return {
      loader: "fabric",
      gameVersion,
      loaderVersion: preparedLoader.loaderVersion,
      customId: preparedLoader.customId,
      profilePath: preparedLoader.profilePath
    };
  }

  if (entry.loader === "forge") {
    const preparedLoader = await ensureManagedForgeInstaller(gameVersion);
    if (
      preparedLoader.forgeVersion !== entry.version ||
      preparedLoader.installerPath !== entry.installerPath ||
      preparedLoader.artifact !== entry.artifact
    ) {
      manifest.loaders[gameVersion] = {
        loader: preparedLoader.loader,
        gameVersion,
        version: preparedLoader.forgeVersion,
        artifact: preparedLoader.artifact,
        customId: null,
        profilePath: null,
        installerPath: preparedLoader.installerPath,
        updatedAt: new Date().toISOString()
      };
      await writeManagedModsManifest(gameDir, manifest);
    }

    return {
      loader: "forge",
      gameVersion,
      forgeVersion: preparedLoader.forgeVersion,
      installerPath: preparedLoader.installerPath,
      artifact: preparedLoader.artifact
    };
  }

  return null;
}

async function launchMinecraft(payload) {
  const state = await readState();
  const settings = {
    ...state.settings,
    ...(payload?.settings ?? {})
  };
  const profile = {
    ...state.profile,
    ...(payload?.profile ?? {})
  };
  const selectedVersion = payload?.version;

  if (!selectedVersion?.id) {
    throw new Error("Lutfen bir Minecraft surumu secin.");
  }

  await ensureGameDirectory(settings.gameDir);
  await updateMinecraftOptions(settings);

  const launcher = new Client();
  const nickname = sanitizeNickname(profile.mcNickname || profile.displayName || profile.launcherUsername);
  const managedLoader = normalizeModLoader(selectedVersion?.managedLoader)
    ? await resolveManagedLoaderForLaunch(settings.gameDir, selectedVersion)
    : null;
  const resolvedJava = await resolveLaunchJava(settings, selectedVersion);
  const activeGameVersion = managedLoader?.gameVersion || inferMinecraftVersionId(selectedVersion);
  const activeLoader = managedLoader?.loader || inferModLoader(selectedVersion);

  await syncManagedModsForLaunch(settings.gameDir, activeGameVersion, activeLoader);

  launcher.on("progress", (status) => sendLauncherEvent("progress", status));
  launcher.on("download-status", (status) => sendLauncherEvent("download-status", status));
  launcher.on("download", (fileName) => sendLauncherEvent("download", { fileName }));
  launcher.on("data", (message) => sendLauncherEvent("minecraft-log", { message: `${message}` }));
  launcher.on("debug", (message) => sendLauncherEvent("debug", { message: `${message}` }));
  launcher.on("close", (exitCode) => {
    activeMinecraftProcess = null;
    stopMinecraftOverlayTracking();
    sendLauncherEvent("game-close", { exitCode });
  });

  sendLauncherEvent("launch-start", {
    versionId: selectedVersion.id,
    nickname,
    javaPath: resolvedJava.javaPath,
    requiredJava: resolvedJava.requiredJava,
    installedJava: resolvedJava.installedJava,
    autoInstalled: resolvedJava.autoInstalled,
    managedLoader: managedLoader?.loader || null,
    managedLoaderVersion: managedLoader?.loaderVersion || managedLoader?.forgeVersion || null
  });

  const versionConfig = managedLoader
    ? managedLoader.customId
      ? {
          number: managedLoader.gameVersion,
          type: /^\d{2}w\d{2}[a-z]?$/i.test(managedLoader.gameVersion) ? "snapshot" : "release",
          custom: managedLoader.customId
        }
      : {
          number: managedLoader.gameVersion,
          type: /^\d{2}w\d{2}[a-z]?$/i.test(managedLoader.gameVersion) ? "snapshot" : "release"
        }
    : selectedVersion.source === "local" && selectedVersion.customId
      ? {
          number: selectedVersion.baseVersion || selectedVersion.id,
          type: selectedVersion.type === "custom" ? "release" : selectedVersion.type,
          custom: selectedVersion.customId
        }
      : {
          number: selectedVersion.id,
          type: selectedVersion.type || "release"
        };

  const authorization = await Authenticator.getAuth(nickname);

  // `--fullscreen` bazi sistemlerde pencere olusmadan JVM'in kapanmasina yol acabiliyor.
  // Guvenli yol olarak oyunun kendi options ayarini koruyup launch'ta hep pencere boyutu veriyoruz.
  const launchWindow = {
    width: String(settings.resolutionWidth),
    height: String(settings.resolutionHeight)
  };
  const launchFeatures = ["has_custom_resolution"];

  const child = await launcher.launch({
    authorization,
    root: settings.gameDir,
    version: versionConfig,
    memory: {
      max: formatMemory(Number(settings.ramMb)),
      min: formatMemory(Math.min(Number(settings.minRamMb), Number(settings.ramMb)))
    },
    javaPath: resolvedJava.javaPath,
    forge: managedLoader?.loader === "forge" ? managedLoader.installerPath : undefined,
    window: launchWindow,
    features: launchFeatures
  });

  activeMinecraftProcess = child;
  startMinecraftOverlayTracking(child?.pid ?? null, Boolean(settings.fullscreen));
  sendLauncherEvent("launch-ready", { pid: child?.pid ?? null });

  return {
    ok: true,
    pid: child?.pid ?? null
  };
}

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId("com.skyland3.launcher");
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("app:bootstrap", async () => {
    const state = await readState();
    const remainingMs = Math.max(0, (state.session?.expiryAt ?? 0) - Date.now());
    return {
      state,
      sessionActive: remainingMs > 0 && remainingMs <= THIRTY_DAYS_MS,
      appVersion: app.getVersion()
    };
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    const nextState = await patchState({ settings });
    return nextState.settings;
  });

  ipcMain.handle("profile:save", async (_event, profile) => {
    const nextState = await patchState({ profile });
    return nextState.profile;
  });

  ipcMain.handle("session:save", async (_event, session) => {
    const nextState = await patchState({ session });
    return nextState.session;
  });

  ipcMain.handle("session:clear", async () => {
    const nextState = await patchState({
      session: {
        expiryAt: 0,
        user: null
      }
    });
    return nextState.session;
  });

  ipcMain.handle("announcements:mark-seen", async (_event, announcementId) => {
    const normalizedId = `${announcementId ?? ""}`.trim();
    const current = await readState();
    const seenIds = Array.from(
      new Set([...(current.announcements?.seenIds ?? []), normalizedId].filter(Boolean))
    );
    const nextState = await patchState({
      announcements: {
        seenIds
      }
    });
    return nextState.announcements;
  });

  ipcMain.handle("launcher:get-versions", async () => getAvailableVersions());

  ipcMain.handle("mods:search", async (_event, payload) => {
    try {
      return await searchModrinthMods(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Mod listesi alinamadi."
      };
    }
  });

  ipcMain.handle("mods:install", async (_event, payload) => {
    try {
      return await installModrinthMod(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Mod kurulumu basarisiz."
      };
    }
  });

  ipcMain.handle("mods:list-installed", async (_event, payload) => {
    try {
      return await listInstalledMods(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Kurulu modlar alinamadi."
      };
    }
  });

  ipcMain.handle("mods:remove-installed", async (_event, payload) => {
    try {
      return await removeInstalledMod(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Mod silinemedi."
      };
    }
  });

  ipcMain.handle("mods:clear-installed", async (_event, payload) => {
    try {
      return await clearInstalledMods(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Kurulu modlar temizlenemedi."
      };
    }
  });

  ipcMain.handle("launcher:launch", async (_event, payload) => {
    try {
      return await launchMinecraft(payload);
    } catch (error) {
      stopMinecraftOverlayTracking();
      sendLauncherEvent("launch-error", {
        message: error.message || "Minecraft baslatilamadi."
      });
      return {
        ok: false,
        error: error.message || "Minecraft baslatilamadi."
      };
    }
  });

  ipcMain.handle("dialog:pick-java", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Java executable sec",
      properties: ["openFile"],
      filters: [
        {
          name: "Java",
          extensions: ["exe"]
        }
      ]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return coerceJavawPath(result.filePaths[0]);
  });

  ipcMain.handle("dialog:pick-game-dir", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Minecraft klasoru sec",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("system:open-external", async (_event, url) => {
    if (typeof url === "string" && url.startsWith("http")) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  createWindow();
});

app.on("window-all-closed", () => {
  stopMinecraftOverlayTracking();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

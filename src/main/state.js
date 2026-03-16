const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { app } = require("electron");

function getStatePath() {
  return path.join(app.getPath("userData"), "skyland-state.json");
}

function getDefaults() {
  return {
    settings: {
      ramMb: 4096,
      minRamMb: 2048,
      language: "tr_tr",
      fullscreen: false,
      resolutionWidth: 1600,
      resolutionHeight: 900,
      showSnapshots: false,
      javaPath: "",
      gameDir: path.join(app.getPath("appData"), ".skyland3")
    },
    session: {
      expiryAt: 0,
      user: null
    },
    profile: {
      launcherUsername: "",
      displayName: "",
      mcNickname: "SkylandTiger"
    },
    announcements: {
      seenIds: []
    }
  };
}

function mergeState(saved) {
  const defaults = getDefaults();
  return {
    settings: {
      ...defaults.settings,
      ...(saved?.settings ?? {})
    },
    session: {
      ...defaults.session,
      ...(saved?.session ?? {})
    },
    profile: {
      ...defaults.profile,
      ...(saved?.profile ?? {})
    },
    announcements: {
      ...defaults.announcements,
      ...(saved?.announcements ?? {}),
      seenIds: Array.from(new Set([...(saved?.announcements?.seenIds ?? [])].filter(Boolean)))
    }
  };
}

async function ensureStateFile() {
  const statePath = getStatePath();
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    await fsp.writeFile(statePath, JSON.stringify(getDefaults(), null, 2), "utf8");
  }
}

async function readState() {
  await ensureStateFile();
  try {
    const raw = await fsp.readFile(getStatePath(), "utf8");
    return mergeState(JSON.parse(raw));
  } catch (error) {
    return getDefaults();
  }
}

async function writeState(nextState) {
  await ensureStateFile();
  const merged = mergeState(nextState);
  await fsp.writeFile(getStatePath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

async function patchState(partialState) {
  const current = await readState();
  const next = {
    settings: {
      ...current.settings,
      ...(partialState?.settings ?? {})
    },
    session: {
      ...current.session,
      ...(partialState?.session ?? {})
    },
    profile: {
      ...current.profile,
      ...(partialState?.profile ?? {})
    },
    announcements: {
      ...current.announcements,
      ...(partialState?.announcements ?? {}),
      seenIds: Array.from(
        new Set([...(partialState?.announcements?.seenIds ?? current.announcements?.seenIds ?? [])].filter(Boolean))
      )
    }
  };
  return writeState(next);
}

module.exports = {
  readState,
  patchState
};

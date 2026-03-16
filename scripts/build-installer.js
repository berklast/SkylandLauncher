const { spawn } = require("child_process");
const path = require("path");
function runBuild() {
  const env = { ...process.env };
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

  const cliPath = path.resolve(__dirname, "..", "node_modules", "electron-builder", "cli.js");
  const args = [cliPath, "--win", "nsis"];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code !== 0) {
        reject(new Error(`Build basarisiz oldu. Cikis kodu: ${code}`));
        return;
      }

      resolve();
    });
  });
}

async function main() {
  try {
    await runBuild();
  } catch (error) {
    console.error("Setup build baslatilamadi:", error);
    process.exit(1);
  }
}

main();

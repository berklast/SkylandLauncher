const { spawn } = require("child_process");
const path = require("path");

const electronBinary = require("electron");
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.resolve(__dirname, "..")], {
  stdio: "inherit",
  env
});

child.on("error", (error) => {
  console.error("Electron baslatilamadi:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

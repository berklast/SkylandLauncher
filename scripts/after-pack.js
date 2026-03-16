const path = require("path");

module.exports = async function afterPack(context) {
  if (process.platform !== "win32" || context.electronPlatformName !== "win32") {
    return;
  }

  const { default: rcedit } = await import("rcedit");
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);
  const iconPath = path.resolve(context.packager.projectDir, "build", "icon.ico");
  const version = context.packager.appInfo.version;

  await rcedit(executablePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      CompanyName: "Berklast",
      FileDescription: "SKYLAND 3",
      ProductName: "SKYLAND 3",
      InternalName: "SKYLAND 3",
      OriginalFilename: executableName,
      LegalCopyright: "Copyright (c) 2026 Berklast",
      LegalTrademarks: "Berklast"
    }
  });
};

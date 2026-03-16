!macro customInstallMode
  ${if} ${isUpdated}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

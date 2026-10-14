; Spread AI NSIS lifecycle hook.
;
; electron-builder 默认 CHECK_APP_RUNNING 会把 $INSTDIR 下任意存活进程都视为应用未关闭。
; Spread AI 正式版会把后端 sidecar 放在 resources\backend 下，如果托盘退出或旧安装器
; 留下了 spread-ai-runtime.exe，重装时会误提示“Spread AI 无法关闭”。
; 这里按产品实际进程模型，只处理当前安装目录下的 Spread AI.exe 与后端 sidecar。

!include "getProcessInfo.nsh"
Var pid
Var SpreadAiStopForceFlag

!macro spreadAiFindInstalledProcesses _RESULT _APP_RESULT
  nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = 'SilentlyContinue'; $$installDir = [System.IO.Path]::GetFullPath('$INSTDIR').TrimEnd('\'); $$appPath = [System.IO.Path]::Combine($$installDir, '${APP_EXECUTABLE_FILENAME}'); $$backendDir = [System.IO.Path]::Combine($$installDir, 'resources\backend') + [System.IO.Path]::DirectorySeparatorChar; $$processes = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Path -and ($$_.Path.Equals($$appPath, [System.StringComparison]::OrdinalIgnoreCase) -or $$_.Path.StartsWith($$backendDir, [System.StringComparison]::OrdinalIgnoreCase)) }); $$appProcesses = @($$processes | Where-Object { $$_.Path.Equals($$appPath, [System.StringComparison]::OrdinalIgnoreCase) }); if ($$appProcesses.Count -gt 0) { exit 10 } elseif ($$processes.Count -gt 0) { exit 0 } else { exit 1 }"`
  Pop ${_RESULT}
  StrCpy ${_APP_RESULT} 0
  ${if} ${_RESULT} == 10
    StrCpy ${_RESULT} 0
    StrCpy ${_APP_RESULT} 1
  ${endIf}
!macroend

!macro spreadAiStopInstalledProcesses _FORCE
  ${if} ${_FORCE} == 1
    StrCpy $SpreadAiStopForceFlag "True"
  ${else}
    StrCpy $SpreadAiStopForceFlag "False"
  ${endIf}
  nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = 'SilentlyContinue'; $$force = [System.Boolean]::Parse('$SpreadAiStopForceFlag'); $$installDir = [System.IO.Path]::GetFullPath('$INSTDIR').TrimEnd('\'); $$appPath = [System.IO.Path]::Combine($$installDir, '${APP_EXECUTABLE_FILENAME}'); $$backendDir = [System.IO.Path]::Combine($$installDir, 'resources\backend') + [System.IO.Path]::DirectorySeparatorChar; $$targets = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.Path -and ($$_.Path.Equals($$appPath, [System.StringComparison]::OrdinalIgnoreCase) -or $$_.Path.StartsWith($$backendDir, [System.StringComparison]::OrdinalIgnoreCase)) } | Sort-Object ProcessId); foreach ($$p in $$targets) { try { Stop-Process -Id $$p.ProcessId -Force:$$force -ErrorAction Stop } catch { } }"`
  Pop $R3
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${if} $IsPowerShellAvailable != 0
    # PowerShell 不可用时退回 electron-builder 默认检查，保持安装器基本行为。
    !insertmacro _CHECK_APP_RUNNING
  ${else}
    StrCpy $R1 0
    !insertmacro spreadAiFindInstalledProcesses $R0 $R2
    ${if} $R0 == 0
      ${if} $R2 == 1
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK spreadAiStopProcesses
        Quit
      ${endIf}

      spreadAiStopProcesses:
      DetailPrint "$(appClosing)"

      spreadAiStopLoop:
        IntOp $R1 $R1 + 1
        ${if} $R1 <= 1
          !insertmacro spreadAiStopInstalledProcesses 0
        ${else}
          !insertmacro spreadAiStopInstalledProcesses 1
        ${endIf}
        Sleep 1000

        !insertmacro spreadAiFindInstalledProcesses $R0 $R2
        ${if} $R0 != 0
          Goto spreadAiNotRunning
        ${endIf}

        ${if} $R1 < 5
          Goto spreadAiStopLoop
        ${endIf}

        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY spreadAiStopLoop
        Quit

      spreadAiNotRunning:
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  ; runtime-config\agent_runtime.yaml 是 release 随包启动配置副本，不是用户业务数据。
  ; 安装/重装时必须用当前安装包模板覆盖 AppData 副本，确保 release 配置更新生效。
  CreateDirectory "$APPDATA\spread-ai-web\runtime-config"
  SetOverwrite on
  CopyFiles /SILENT "$INSTDIR\resources\runtime-config\agent_runtime.yaml" "$APPDATA\spread-ai-web\runtime-config"
!macroend

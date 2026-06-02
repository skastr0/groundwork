@echo off
setlocal

set "plugin_root=%PLUGIN_ROOT%"
if "%plugin_root%"=="" set "plugin_root=%CLAUDE_PLUGIN_ROOT%"
if "%plugin_root%"=="" set "plugin_root=%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo {"systemMessage":"[groundwork] Groundwork Codex plugin requires Node.js 24 or newer. Install Node.js and rebuild or reinstall the plugin."}
  exit /b 0
)

for /f "usebackq delims=" %%v in (`node -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2^>nul`) do set "node_major=%%v"
if "%node_major%"=="" set "node_major=0"
if %node_major% LSS 24 (
  echo {"systemMessage":"[groundwork] Groundwork Codex plugin requires Node.js 24 or newer. Current Node.js major version is %node_major%."}
  exit /b 0
)

set "hook_file=%plugin_root%\dist\groundwork-codex-hook.mjs"
if not exist "%hook_file%" (
  echo {"systemMessage":"[groundwork] Groundwork Codex plugin is missing dist/groundwork-codex-hook.mjs. Rebuild or reinstall the plugin package."}
  exit /b 0
)

set "loader_file=%plugin_root%\hooks\groundwork-codex-hook-loader.mjs"
if not exist "%loader_file%" (
  echo {"systemMessage":"[groundwork] Groundwork Codex plugin is missing hooks/groundwork-codex-hook-loader.mjs. Rebuild or reinstall the plugin package."}
  exit /b 0
)

node "%loader_file%" "%hook_file%"

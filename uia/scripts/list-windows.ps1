#Requires -Version 5.1
<#
  Lists top-level windows as a single compressed JSON line.
  Output: { ok, windows: [{ hwnd, title, app }] }
  Touches no focus: used to bind a task to an already-open window that
  sits behind the user's foreground window instead of reopening the app.
#>
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$out = @()
try {
  foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
    $title = ''
    try { $title = [string]$p.MainWindowTitle } catch {}
    $out += @{
      hwnd  = [long]$p.MainWindowHandle
      title = $title
      app   = [string]$p.ProcessName
    }
  }
} catch {}

(@{ ok = $true; windows = @($out) } | ConvertTo-Json -Depth 4 -Compress)

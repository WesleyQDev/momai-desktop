#Requires -Version 5.1
<#
  Reports the rectangle of the screen where the foreground window is. Used as
  the default when the user asks for "a print da tela" on a multi-monitor
  setup: the screen in use, not necessarily the first one.
  The center point identifies the display in the Node side.
  Output: single compressed JSON line { ok, left, top, right, bottom, centerX, centerY, error? }
#>
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MomaiForegroundDisplay {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@

# Physical pixels, like the capture scripts, so the rect matches the display list.
try { [void][MomaiForegroundDisplay]::SetProcessDPIAware() } catch {}

$result = @{ ok = $false }
try {
  $handle = [MomaiForegroundDisplay]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { throw 'no foreground window' }
  $rect = New-Object MomaiForegroundDisplay+RECT
  if (-not [MomaiForegroundDisplay]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
  if ($rect.Right -le $rect.Left -or $rect.Bottom -le $rect.Top) { throw 'foreground window has no size' }
  $result = @{
    ok = $true
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    centerX = [int](($rect.Left + $rect.Right) / 2)
    centerY = [int](($rect.Top + $rect.Bottom) / 2)
  }
} catch {
  $result = @{ ok = $false; error = [string]$_.Exception.Message }
}

($result | ConvertTo-Json -Compress)

#Requires -Version 5.1
<#
  Captures ONE top-level window to a JPEG file, without touching focus.
  PrintWindow(PW_RENDERFULLCONTENT) renders the window even when it sits
  behind the foreground; GPU-composited windows that come back blank fall
  back to a screen-region copy while the window is visible.
  Output: single compressed JSON line
    { ok, path?, width?, height?, method?, error? }
#>
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$Quality = 90
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MomaiWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@

# Physical pixels from GetWindowRect/BitBlt: without this the bitmap comes
# out scaled on displays above 100%.
try { [void][MomaiWindowCapture]::SetProcessDPIAware() } catch {}

function Save-Jpeg($bitmap, $path, $quality) {
  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
  $params = New-Object System.Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $bitmap.Save($path, $encoder, $params)
  $params.Dispose()
}

function Test-BitmapBlank($bitmap) {
  # Coarse grid sample: an all-black result means PrintWindow rendered
  # nothing for this window (GPU-composited apps), so the caller retries
  # with a screen-region copy while the window is visible.
  $stepX = [Math]::Max(1, [int]($bitmap.Width / 24))
  $stepY = [Math]::Max(1, [int]($bitmap.Height / 24))
  for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.R -ne 0 -or $pixel.G -ne 0 -or $pixel.B -ne 0) { return $false }
    }
  }
  return $true
}

$result = @{ ok = $false }
try {
  $handle = [IntPtr]::new($Hwnd)
  if ([MomaiWindowCapture]::IsIconic($handle)) { throw 'window is minimized' }
  $rect = New-Object MomaiWindowCapture+RECT
  if (-not [MomaiWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { throw 'window has no size' }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $method = 'printwindow'
  try {
    $printed = $false
    $hdc = $graphics.GetHdc()
    try { $printed = [MomaiWindowCapture]::PrintWindow($handle, $hdc, 2) }
    finally { $graphics.ReleaseHdc($hdc) }
    if (-not $printed -or (Test-BitmapBlank $bitmap)) {
      if ([MomaiWindowCapture]::IsWindowVisible($handle)) {
        $graphics.CopyFromScreen(
          $rect.Left, $rect.Top, 0, 0,
          (New-Object System.Drawing.Size $width, $height))
        $method = 'screen'
      } elseif (-not $printed) {
        throw 'PrintWindow failed and the window is not visible'
      }
    }
  } finally {
    $graphics.Dispose()
  }

  Save-Jpeg $bitmap $OutPath $Quality
  $bitmap.Dispose()
  $result = @{ ok = $true; path = [string]$OutPath; width = $width; height = $height; method = $method }
} catch {
  $result = @{ ok = $false; error = [string]$_.Exception.Message }
}

($result | ConvertTo-Json -Depth 4 -Compress)

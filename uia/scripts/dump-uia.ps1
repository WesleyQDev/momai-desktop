#Requires -Version 5.1
<#
  Dumps the Windows UI Automation tree as a single compressed JSON line.
  Output: { ok, windowTitle, appName, truncated, nodes: [...] }
  Each node: { control, name, automationId, rect, enabled, offscreen,
               depth, path, patterns }
#>
param(
  [string]$Scope = 'active',
  [int]$MaxDepth = 7,
  [int]$MaxNodes = 400
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-Root {
  if ($Scope -eq 'desktop') {
    return [System.Windows.Automation.AutomationElement]::RootElement
  }
  $hwnd = [Win32]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) {
    return [System.Windows.Automation.AutomationElement]::RootElement
  }
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  } catch {
    return [System.Windows.Automation.AutomationElement]::RootElement
  }
}

$script:count = 0
$script:truncated = $false
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

# NOTE: pattern support is probed only on the single acted element inside
# invoke-uia.ps1 — probing 5 patterns per dumped node was the slowest part
# of every snapshot (COM exceptions are expensive).

function Get-Rect($el) {
  try {
    $r = $el.Current.BoundingRectangle
    if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) { return $null }
    if ($r.Width -le 0 -or $r.Height -le 0) { return $null }
    return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  } catch { return $null }
}

function Get-ControlKey($el) {
  # Locale-independent type (Button, Edit, ...) from the programmatic name.
  try {
    $full = [string]$el.Current.ControlType.ProgrammaticName
    if ($full -match 'ControlType\.(\w+)') { return $Matches[1] }
  } catch {}
  return ''
}

function Convert-Node($el, $depth, $path) {
  if ($script:count -ge $MaxNodes) { $script:truncated = $true; return $null }
  if ($depth -gt $MaxDepth) { return $null }
  $script:count++
  $current = $null
  try { $current = $el.Current } catch { return $null }
  $node = @{
    control      = Get-ControlKey $el
    controlLocal = [string]$current.LocalizedControlType
    name         = [string]$current.Name
    automationId = [string]$current.AutomationId
    rect         = Get-Rect $el
    enabled      = [bool]$current.IsEnabled
    offscreen    = [bool]$current.IsOffscreen
    depth        = $depth
    path         = $path
    patterns     = @{}
  }
  $children = @()
  try {
    $child = $walker.GetFirstChild($el)
    $indexByKey = @{}
    while ($null -ne $child) {
      $childName = ''
      $childControl = ''
      $childAutoId = ''
      try {
        $childName = [string]$child.Current.Name
        $childControl = Get-ControlKey $child
        $childAutoId = [string]$child.Current.AutomationId
      } catch {}
      $key = "$childControl|$childName|$childAutoId"
      if (-not $indexByKey.ContainsKey($key)) { $indexByKey[$key] = 0 } else { $indexByKey[$key]++ }
      $seg = @{
        control      = $childControl
        name         = $childName
        automationId = $childAutoId
        index        = $indexByKey[$key]
      }
      $converted = Convert-Node $child ($depth + 1) ($path + @($seg))
      if ($null -ne $converted) { $children += $converted }
      if ($script:truncated) { break }
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  } catch {}
  # Flatten: node list is pre-order, children inline after parent.
  return @($node) + $children
}

try {
  $root = Get-Root
  $windowTitle = ''
  $appName = ''
  try {
    # The root itself may already be the window: check self, then ancestors.
    $window = $null
    try {
      if ([string]$root.Current.ControlType.ProgrammaticName -match 'ControlType\.Window') {
        $window = $root
      }
    } catch {}
    if ($null -eq $window) {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window)
      try {
        $window = $root.FindFirst(
          [System.Windows.Automation.TreeScope]::Ancestors, $cond)
      } catch {}
    }
    if ($null -eq $window -and $Scope -eq 'desktop') { $window = $root }
    if ($null -ne $window) {
      try { $windowTitle = [string]$window.Current.Name } catch {}
      try {
        $proc = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $proc) { $appName = [string]$proc.ProcessName }
      } catch {}
    }
  } catch {}
  $flat = @()
  # Root itself is context, not a node: walk its children at depth 0.
  try {
    $child = $walker.GetFirstChild($root)
    $indexByKey = @{}
    while ($null -ne $child -and -not $script:truncated) {
      $childName = ''
      $childControl = ''
      $childAutoId = ''
      try {
        $childName = [string]$child.Current.Name
        $childControl = Get-ControlKey $child
        $childAutoId = [string]$child.Current.AutomationId
      } catch {}
      $key = "$childControl|$childName|$childAutoId"
      if (-not $indexByKey.ContainsKey($key)) { $indexByKey[$key] = 0 } else { $indexByKey[$key]++ }
      $seg = @{
        control      = $childControl
        name         = $childName
        automationId = $childAutoId
        index        = $indexByKey[$key]
      }
      $converted = Convert-Node $child 0 @($seg)
      if ($null -ne $converted) { $flat += $converted }
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  } catch {}
  $result = @{
    ok          = $true
    windowTitle = $windowTitle
    appName     = $appName
    truncated   = [bool]$script:truncated
    nodes       = $flat
  }
  $result | ConvertTo-Json -Depth 12 -Compress
} catch {
  (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}

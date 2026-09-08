#Requires -Version 5.1
<#
  Locates a UIA element and performs one action, in a single session.
  Modes (via -PayloadJson):
    path mode: { path, action, text, key, rect?, name?, app? }
    find mode: { findName, findRole?, action, text?, submit?, key? }
      walks once, acts on the live match immediately (no stale refs),
      and returns the fresh tree — one process instead of dump+invoke+dump.
    action: invoke | click | setvalue | sendkeys | press | winsearch
  Flags: returnTree (path mode also returns the fresh tree).
  Output: single compressed JSON line
    { ok, action, method?, name?, error?, nodes?, windowTitle?, appName? }
#>
param(
  [string]$PayloadJson = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32Input {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Get-ControlKey($el) {
  try {
    $full = [string]$el.Current.ControlType.ProgrammaticName
    if ($full -match 'ControlType\.(\w+)') { return $Matches[1] }
  } catch {}
  return ''
}

function Find-Child($parent, $seg) {
  $matches = @()
  try {
    $child = $walker.GetFirstChild($parent)
    while ($null -ne $child) {
      $cName = ''
      $cControl = ''
      $cAutoId = ''
      try {
        $cName = [string]$child.Current.Name
        $cControl = Get-ControlKey $child
        $cAutoId = [string]$child.Current.AutomationId
      } catch {}
      $match = $true
      if ($seg.automationId -and $seg.automationId -ne '') {
        if ($cAutoId -ne $seg.automationId) { $match = $false }
      } elseif ($seg.name -and $seg.name -ne '') {
        if ($cName -ne $seg.name) { $match = $false }
      }
      if ($match -and $seg.control -and $seg.control -ne '') {
        if ($cControl -ne $seg.control) { $match = $false }
      }
      if ($match) { $matches += $child }
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  } catch {}
  if ($matches.Count -eq 0) { return $null }
  $idx = 0
  try { $idx = [int]$seg.index } catch { $idx = 0 }
  if ($idx -lt 0 -or $idx -ge $matches.Count) { $idx = 0 }
  return $matches[$idx]
}

function Remove-Diacritics($s) {
  $norm = [string]$s
  if (-not $norm) { return '' }
  try {
    $form = $norm.Normalize([System.Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $form.ToCharArray()) {
      $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
      if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
        [void]$sb.Append($ch)
      }
    }
    return $sb.ToString().ToLowerInvariant()
  } catch {
    return $norm.ToLower()
  }
}

function Convert-Compact($el, $depth, $path, $maxDepth, $collector) {
  # Same node shape as dump-uia.ps1 but WITHOUT pattern probing (that cost
  # stays on the single acted element). Collects @{ node=...; el=... }.
  if ($script:count -ge $script:maxNodes) { $script:truncated = $true; return }
  if ($depth -gt $maxDepth) { return }
  $script:count++
  $current = $null
  try { $current = $el.Current } catch { return }
  $rect = $null
  try {
    $r = $current.BoundingRectangle
    if (-not ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) -and
        $r.Width -gt 0 -and $r.Height -gt 0) {
      $rect = @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
    }
  } catch {}
  $node = @{
    control      = Get-ControlKey $el
    controlLocal = [string]$current.LocalizedControlType
    name         = [string]$current.Name
    automationId = [string]$current.AutomationId
    rect         = $rect
    enabled      = [bool]$current.IsEnabled
    offscreen    = [bool]$current.IsOffscreen
    depth        = $depth
    path         = $path
    patterns     = @{}
  }
  $collector.Add(@{ node = $node; el = $el }) | Out-Null
  try {
    $child = $walker.GetFirstChild($el)
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
      Convert-Compact $child ($depth + 1) ($path + @($seg)) $maxDepth $collector
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  } catch {}
}

function Get-ForegroundRoot {
  try {
    $hwnd = [Win32Input]::GetForegroundWindow()
    if ($hwnd -ne [IntPtr]::Zero) {
      return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    }
  } catch {}
  return [System.Windows.Automation.AutomationElement]::RootElement
}

function Get-WindowInfo($root) {
  $windowTitle = ''
  $appName = ''
  try {
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
    if ($null -ne $window) {
      try { $windowTitle = [string]$window.Current.Name } catch {}
      try {
        $proc = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $proc) { $appName = [string]$proc.ProcessName }
      } catch {}
    }
  } catch {}
  return @{ windowTitle = $windowTitle; appName = $appName }
}

function Find-BestMatch($pairs, $nameNorm, $roleNorm) {
  $best = $null
  $bestScore = 0
  $bestDepth = 999
  foreach ($pair in $pairs) {
    $node = $pair.node
    if ($roleNorm -ne '') {
      $ck = Remove-Diacritics ([string]$node.control) -replace '\s+', ''
      if ($ck -ne $roleNorm) { continue }
    }
    $nn = Remove-Diacritics ([string]$node.name)
    if ($nn -eq '') { continue }
    $score = 0
    if ($nn -eq $nameNorm) { $score = 1 }
    elseif ($nn.Contains($nameNorm)) { $score = 0.8 }
    else {
      $hits = 0
      $words = @($nameNorm -split '\s+' | Where-Object { $_.Length -gt 1 })
      if ($words.Count -eq 0) { continue }
      foreach ($w in $words) { if ($nn.Contains($w)) { $hits++ } }
      if ($hits -eq 0) { continue }
      $score = 0.3 + ($hits / $words.Count) * 0.4
    }
    $depth = [int]$node.depth
    if ($score -gt $bestScore -or ($score -eq $bestScore -and $depth -lt $bestDepth)) {
      $best = $pair
      $bestScore = $score
      $bestDepth = $depth
    }
  }
  return $best
}

function Get-CompactTree($root, $maxDepth, $maxNodes) {
  # One full walk returning @{ pairs; nodes; windowTitle; appName; truncated }.
  $script:count = 0
  $script:truncated = $false
  $script:maxNodes = $maxNodes
  $collector = New-Object System.Collections.ArrayList
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
      Convert-Compact $child 0 @($seg) $maxDepth $collector
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  } catch {}
  $pairs = @($collector | ForEach-Object { $_ })
  $nodes = @($pairs | ForEach-Object { $_.node })
  $info = Get-WindowInfo $root
  return @{
    pairs       = $pairs
    nodes       = $nodes
    windowTitle = $info.windowTitle
    appName     = $info.appName
    truncated   = [bool]$script:truncated
  }
}

function Assert-ForegroundApp($expectedApp) {
  # Rect fallback clicks blind pixels: only proceed when the foreground app
  # is still the one from the snapshot. Pattern actions above do not need
  # this (they resolve the real element), but blind coordinates do.
  $expected = [string]$expectedApp
  if (-not $expected -or $expected -eq '') { return }
  $fgProc = ''
  try {
    $hwnd = [Win32Input]::GetForegroundWindow()
    $fgPid = 0
    [void][Win32Input]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
    $proc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
    if ($null -ne $proc) { $fgProc = [string]$proc.ProcessName }
  } catch {}
  if ($fgProc -eq '') {
    throw 'Could not verify the foreground window: refusing a blind click.'
  }
  if ($fgProc.ToLower() -ne $expected.ToLower()) {
    throw "A janela ativa mudou para '$fgProc' (esperava '$expected'). Tire outro desktop_snapshot."
  }
}

function Focus-Window($el) {
  # Brings the element's top-level window to the foreground so mouse and
  # keystrokes land on the right window. Best effort: patterns below also
  # work without focus.
  $cur = $el
  $window = $null
  for ($i = 0; $i -lt 20 -and $null -ne $cur; $i++) {
    $ct = ''
    try { $ct = [string]$cur.Current.ControlType.ProgrammaticName } catch {}
    if ($ct -match 'ControlType\.Window') { $window = $cur; break }
    try { $cur = $walker.GetParent($cur) } catch { $cur = $null }
  }
  if ($null -eq $window) { return }
  try {
    $hwnd = [IntPtr]$window.GetCurrentPropertyValue(
      [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty)
    if ($hwnd -eq [IntPtr]::Zero) { return }
    if ([Win32Input]::IsIconic($hwnd)) {
      [Win32Input]::ShowWindow($hwnd, 9) | Out-Null
      Start-Sleep -Milliseconds 200
    }
    [Win32Input]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 250
  } catch {}
}

function Invoke-Click($el) {
  try {
    $pat = $null
    if ($el.TryGetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
      $pat.Invoke()
      return @{ method = 'invoke' }
    }
  } catch {}
  try {
    $pat = $null
    if ($el.TryGetCurrentPattern(
        [System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pat)) {
      $pat.Select()
      return @{ method = 'select' }
    }
  } catch {}
  try {
    $pat = $null
    if ($el.TryGetCurrentPattern(
        [System.Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) {
      $pat.Toggle()
      return @{ method = 'toggle' }
    }
  } catch {}
  # Mouse fallback needs the real cursor on the right window: only now
  # disturb focus, never for the pattern paths above.
  Focus-Window $el
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 100
  $r = $el.Current.BoundingRectangle
  $cx = [int]($r.X + $r.Width / 2)
  $cy = [int]($r.Y + $r.Height / 2)
  [Win32Input]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 60
  [Win32Input]::mouse_event(
    [Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [Win32Input]::mouse_event(
    [Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  return @{ method = 'mouse' }
}

function Invoke-Type($el, $text, $submit) {
  try {
    $pat = $null
    if ($el.TryGetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
      try {
        $pat.SetValue([string]$text)
      } catch {
        # Some providers need focus before accepting a value.
        Focus-Window $el
        try { $el.SetFocus() } catch {}
        Start-Sleep -Milliseconds 100
        $pat.SetValue([string]$text)
      }
      if ($submit) {
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      }
      return @{ method = 'value' }
    }
  } catch {}
  # Keystroke fallback needs focus on the right window.
  Focus-Window $el
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait([string]$text)
  if ($submit) {
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  return @{ method = 'sendkeys' }
}

try {
  if (-not $PayloadJson -or $PayloadJson -eq '') {
    throw 'Empty payload'
  }
  $payload = $PayloadJson | ConvertFrom-Json
  $path = @($payload.path)
  $action = [string]$payload.action
  if (-not $action) { $action = 'invoke' }

  # Direct-coordinate actions need an explicit tree element or a fresh
  # rect: raw x/y without provenance is refused (no blind pixels).
  if ($action -eq 'mouse' -or $action -eq 'mousetype') {
    throw 'Direct-coordinate actions were removed: use path/rect/focus flows.'
  }

  if ($path.Count -eq 0 -and [string]$payload.findName -eq '' -and [string]$payload.findRole -eq '') {
    throw 'Empty element path'
  }

  $maxDepth = 7
  $maxNodes = 400
  try { if ([int]$payload.maxDepth -gt 0) { $maxDepth = [int]$payload.maxDepth } } catch {}
  try { if ([int]$payload.maxNodes -gt 0) { $maxNodes = [int]$payload.maxNodes } } catch {}
  $returnTree = [bool]$payload.returnTree
  $findMode = ([string]$payload.findName -ne '' -or [string]$payload.findRole -ne '')

  $postTree = $null
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $el = $null
  $rectFallback = $null
  if ($findMode) {
    # FIND MODE: locate by name/role in one walk, act immediately on the
    # live element (no stale refs possible), fresh tree comes back below.
    $pre = Get-CompactTree (Get-ForegroundRoot) $maxDepth $maxNodes
    $best = Find-BestMatch $pre.pairs `
      (Remove-Diacritics ([string]$payload.findName)) `
      ((Remove-Diacritics ([string]$payload.findRole)) -replace '\s+', '')
    if ($null -eq $best) {
      (@{
        ok          = $false
        error       = "Elemento nao encontrado: '$([string]$payload.findName)'"
        nodes       = @($pre.nodes)
        windowTitle = $pre.windowTitle
        appName     = $pre.appName
        truncated   = [bool]$pre.truncated
      } | ConvertTo-Json -Depth 12 -Compress)
      return
    }
    $el = $best.el
  } else {
  try {
    $parent = $root
    foreach ($seg in $path) {
      $el = Find-Child $parent $seg
      if ($null -eq $el) { throw 'Elemento nao encontrado (a janela pode ter mudado)' }
      $parent = $el
    }
  } catch {
    # Fresh-rect fallback: dynamic menus rebuild their tree constantly, so a
    # path walk can fail even seconds after the dump. A seconds-old rectangle
    # from a fresh snapshot still points at the right pixels.
    $r = $payload.rect
    if ($r -and $r.w -gt 0 -and $r.h -gt 0) {
      $rectFallback = @{ x = [int]$r.x; y = [int]$r.y; w = [int]$r.w; h = [int]$r.h }
      $el = $null
    } else {
      throw
    }
  }
  }

  $name = ''
  if ($null -ne $el) {
    try { $name = [string]$el.Current.Name } catch {}
  } elseif ($null -ne $rectFallback) {
    $name = [string]$payload.name
  }

  $info = $null
  if ($action -eq 'winsearch') {
    # Focus-free launcher: opens Start through the OS itself, types the
    # program name and confirms. Uses Windows' own index, so Store (UWP)
    # apps like Calculator work with no snapshot and no focus needed.
    [System.Windows.Forms.SendKeys]::SendWait('^{ESC}')
    Start-Sleep -Milliseconds 700
    [System.Windows.Forms.SendKeys]::SendWait([string]$payload.text)
    Start-Sleep -Milliseconds 1200
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 1000
    $info = @{ method = 'winsearch' }
  } elseif ($null -ne $rectFallback -and ($action -eq 'invoke' -or $action -eq 'click')) {
    Assert-ForegroundApp ([string]$payload.app)
    $cx = $rectFallback.x + [int]($rectFallback.w / 2)
    $cy = $rectFallback.y + [int]($rectFallback.h / 2)
    [Win32Input]::SetCursorPos($cx, $cy) | Out-Null
    Start-Sleep -Milliseconds 60
    [Win32Input]::mouse_event(
      [Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [Win32Input]::mouse_event(
      [Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    $info = @{ method = 'mouse-rect' }
  } elseif ($null -ne $rectFallback) {
    Assert-ForegroundApp ([string]$payload.app)
    # Focus the field with a click, then type into the foreground window.
    $cx = $rectFallback.x + [int]($rectFallback.w / 2)
    $cy = $rectFallback.y + [int]($rectFallback.h / 2)
    [Win32Input]::SetCursorPos($cx, $cy) | Out-Null
    Start-Sleep -Milliseconds 60
    [Win32Input]::mouse_event(
      [Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [Win32Input]::mouse_event(
      [Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    if ($action -eq 'press') {
      [System.Windows.Forms.SendKeys]::SendWait([string]$payload.key)
    } else {
      [System.Windows.Forms.SendKeys]::SendWait([string]$payload.text)
      if ([bool]$payload.submit) {
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      }
    }
    $info = @{ method = 'sendkeys-rect' }
  } else {
  switch ($action) {
    'invoke'   { $info = Invoke-Click $el }
    'click'    { $info = Invoke-Click $el }
    'setvalue' { $info = Invoke-Type $el ([string]$payload.text) ([bool]$payload.submit) }
    'sendkeys' { $info = Invoke-Type $el ([string]$payload.text) ([bool]$payload.submit) }
    'press' {
      Focus-Window $el
      try { $el.SetFocus() } catch {}
      Start-Sleep -Milliseconds 100
      [System.Windows.Forms.SendKeys]::SendWait([string]$payload.key)
      $info = @{ method = 'sendkeys' }
    }
    default { throw "Acao desconhecida: $action" }
  }
  }

  if ($returnTree -or $findMode) {
    # Fresh tree in the SAME session: no second process, no stale refs.
    $post = Get-CompactTree (Get-ForegroundRoot) $maxDepth $maxNodes
    $postTree = @{
      nodes       = @($post.nodes)
      windowTitle = $post.windowTitle
      appName     = $post.appName
      truncated   = [bool]$post.truncated
    }
  }

  $output = @{
    ok     = $true
    action = $action
    method = [string]$info.method
    name   = $name
  }
  if ($null -ne $postTree) {
    $output.nodes = $postTree.nodes
    $output.windowTitle = $postTree.windowTitle
    $output.appName = $postTree.appName
    $output.truncated = $postTree.truncated
    ($output | ConvertTo-Json -Depth 12 -Compress)
  } else {
    ($output | ConvertTo-Json -Compress)
  }
} catch {
  (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}

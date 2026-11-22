# Keyboard / mouse input for the Dota 2 window (only when that window is in the foreground).
#   powershell -File keys.ps1 key 0xDC            press a virtual key (0xDC = backslash, 0x0D = Enter, 0x1B = Esc)
#   powershell -File keys.ps1 type "some text"    type text
#   powershell -File keys.ps1 click 960 540       left click at screen coordinates (clickf 0.5 0.5 = fractions of the screen)
#   several steps:  keys.ps1 key 0xDC sleep 400 type "echo hi" key 0x0D
$src = @"
using System; using System.Runtime.InteropServices; using System.Text;
public class SLInput {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  public static string Foreground() { var sb = new StringBuilder(256); GetWindowText(GetForegroundWindow(), sb, 256); return sb.ToString(); }
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  public static void Key(ushort vk) {
    var d = new INPUT(); d.type = 1; d.u.ki.wVk = vk; d.u.ki.wScan = (ushort)MapVirtualKey(vk, 0); Send(d);
    System.Threading.Thread.Sleep(40);
    var u = d; u.u.ki.dwFlags = 2; Send(u);
  }
  public static void Type(string s) {
    foreach (char c in s) {
      var d = new INPUT(); d.type = 1; d.u.ki.wScan = c; d.u.ki.dwFlags = 4; Send(d);
      var u = d; u.u.ki.dwFlags = 4 | 2; Send(u);
      System.Threading.Thread.Sleep(8);
    }
  }
  public static void Click(int x, int y) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(60);
    var d = new INPUT(); d.type = 0; d.u.mi.dwFlags = 2; Send(d);
    System.Threading.Thread.Sleep(40);
    var u = new INPUT(); u.type = 0; u.u.mi.dwFlags = 4; Send(u);
  }
}
"@
Add-Type -TypeDefinition $src
$fg = [SLInput]::Foreground()
if ($fg -ne "Dota 2") { "refused: foreground window is '$fg', not Dota 2"; exit 2 }
$i = 0
while ($i -lt $args.Count) {
  $op = [string]$args[$i]
  switch ($op) {
    "key"   { [SLInput]::Key([Convert]::ToUInt16([string]$args[$i + 1], 16)); $i += 2 }
    "type"  { [SLInput]::Type([string]$args[$i + 1]); $i += 2 }
    "click" { [SLInput]::Click([int]$args[$i + 1], [int]$args[$i + 2]); $i += 3 }
    "clickf" {
      # click at a fraction of the primary screen (0..1), so that the same call works at any resolution
      Add-Type -AssemblyName System.Windows.Forms
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      [SLInput]::Click([int]($b.Width * [double]$args[$i + 1]), [int]($b.Height * [double]$args[$i + 2])); $i += 3
    }
    "sleep" { Start-Sleep -Milliseconds ([int]$args[$i + 1]); $i += 2 }
    default { "unknown step $op"; exit 3 }
  }
  Start-Sleep -Milliseconds 60
}
"ok"

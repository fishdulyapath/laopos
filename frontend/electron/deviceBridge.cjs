const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAW_PRINT_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);
  public static void SendBytes(string printerName, byte[] bytes, string docName) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = docName;
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(hPrinter)) throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
        try {
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written) || written != bytes.Length) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
$bytes = [Convert]::FromBase64String($env:BIZSUIT_RAW_PRINT_BASE64)
[RawPrinterHelper]::SendBytes($env:BIZSUIT_PRINTER_NAME, $bytes, $env:BIZSUIT_PRINT_DOC_NAME)
`;

const SERIAL_WRITE_PS = `
$bytes = [Convert]::FromBase64String($env:BIZSUIT_SERIAL_BYTES_BASE64)
$port = New-Object System.IO.Ports.SerialPort($env:BIZSUIT_SERIAL_PORT, [int]$env:BIZSUIT_SERIAL_BAUD_RATE)
$port.Open()
try { $port.Write($bytes, 0, $bytes.Length) } finally { $port.Close() }
`;

const USBCR_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class UsbCrBridge {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool SetDllDirectory(string lpPathName);
  [DllImport("usbcr.dll", EntryPoint="OpenUSB")]
  static extern int OpenUSB();
  [DllImport("usbcr.dll", EntryPoint="CloseUSB")]
  static extern int CloseUSB();
  [DllImport("usbcr.dll", EntryPoint="DrawerOpen")]
  static extern int DrawerOpen(int n);
  [DllImport("usbcr.dll", EntryPoint="OpenUSBcr")]
  static extern int OpenUSBcr();
  [DllImport("usbcr.dll", EntryPoint="CloseUSBcr")]
  static extern int CloseUSBcr();
  public static int OpenDrawer(string dllDir, int drawerId) {
    if (!String.IsNullOrWhiteSpace(dllDir)) SetDllDirectory(dllDir);
    try {
      if (OpenUSB() == 0) {
        try { return DrawerOpen(drawerId); }
        finally { CloseUSB(); }
      }
    } catch {}
    try {
      if (OpenUSBcr() == 0) {
        try { return DrawerOpen(drawerId); }
        finally { CloseUSBcr(); }
      }
    } catch {}
    return -1;
  }
}
"@
$result = [UsbCrBridge]::OpenDrawer($env:BIZSUIT_DLL_DIR, [int]$env:BIZSUIT_DRAWER_ID)
if ($result -ne 0) { throw "usbcr drawer failed: $result" }
`;

const USBCR_SCAN_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class UsbCrScanBridge {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool SetDllDirectory(string lpPathName);
  [DllImport("usbcr.dll", EntryPoint="OpenUSB")]
  static extern int OpenUSB();
  [DllImport("usbcr.dll", EntryPoint="CloseUSB")]
  static extern int CloseUSB();
  [DllImport("usbcr.dll", EntryPoint="OpenUSBcr")]
  static extern int OpenUSBcr();
  [DllImport("usbcr.dll", EntryPoint="CloseUSBcr")]
  static extern int CloseUSBcr();
  [DllImport("usbcr.dll", EntryPoint="DrawerState")]
  static extern int DrawerState(int n);

  public static string Scan(string dllDir, int maxDrawerId) {
    if (!String.IsNullOrWhiteSpace(dllDir)) SetDllDirectory(dllDir);
    bool opened = false;
    string api = "OpenUSB";
    try {
      opened = OpenUSB() == 0;
    } catch {}
    if (!opened) {
      api = "OpenUSBcr";
      try {
        opened = OpenUSBcr() == 0;
      } catch {}
    }
    if (!opened) throw new Exception("usbcr device is not available");

    StringBuilder json = new StringBuilder();
    json.Append("{\\"api\\":\\"").Append(api).Append("\\",\\"drawers\\":[");
    try {
      for (int id = 1; id <= maxDrawerId; id++) {
        int status = -9999;
        bool responded = false;
        try {
          status = DrawerState(id);
          responded = true;
        } catch {}
        if (id > 1) json.Append(",");
        json.Append("{\\"drawerId\\":").Append(id)
          .Append(",\\"status\\":").Append(status)
          .Append(",\\"responded\\":").Append(responded ? "true" : "false")
          .Append("}");
      }
    } finally {
      if (api == "OpenUSB") CloseUSB();
      else CloseUSBcr();
    }
    json.Append("]}");
    return json.ToString();
  }
}
"@
[UsbCrScanBridge]::Scan($env:BIZSUIT_DLL_DIR, [int]$env:BIZSUIT_MAX_DRAWER_ID)
`;

const FRIUSB_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FriUsbBridge {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool SetDllDirectory(string lpPathName);
  [DllImport("FIRIDLLU.dll", EntryPoint="InitFRIUSBLibrary")]
  static extern void InitFRIUSBLibrary();
  [DllImport("FIRIDLLU.dll", EntryPoint="CloseFRIUSBLibrary")]
  static extern void CloseFRIUSBLibrary();
  [DllImport("FIRIDLLU.dll", EntryPoint="OpenFRIDoor")]
  static extern int OpenFRIDoor();
  public static int OpenDrawer(string dllDir) {
    if (!String.IsNullOrWhiteSpace(dllDir)) SetDllDirectory(dllDir);
    InitFRIUSBLibrary();
    try { return OpenFRIDoor(); }
    finally { CloseFRIUSBLibrary(); }
  }
}
"@
$result = [FriUsbBridge]::OpenDrawer($env:BIZSUIT_DLL_DIR)
if ($result -ne 0) { throw "friusb drawer failed: $result" }
`;

function hexToBuffer(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  if (!clean || clean.length % 2 !== 0) throw new Error('invalid hex bytes');
  return Buffer.from(clean, 'hex');
}

function runPowerShell(script, env) {
  if (process.platform !== 'win32') throw new Error('Windows device bridge is available only on Windows');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bizsuit-device-'));
  const filePath = path.join(dir, 'run.ps1');
  const wrappedScript = `
$ErrorActionPreference = 'Stop'
try {
${script}
} catch {
  $message = $_.Exception.Message
  if ($_.Exception.InnerException) {
    $message = $message + ': ' + $_.Exception.InnerException.Message
  }
  [Console]::Error.WriteLine($message)
  exit 1
}
`;
  fs.writeFileSync(filePath, wrappedScript, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filePath], {
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ ok: true, stdout });
      else reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
    });
  });
}

function parsePowerShellJson(stdout, context) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error(`${context} returned no JSON output`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} returned invalid JSON: ${error.message}`);
  }
}

function sendRawToPrinter({ printerName, bytes, docName = 'NextStep POS raw print' }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  if (!printerName) throw new Error('printerName is required');
  if (!buffer.length) throw new Error('raw print bytes are empty');
  return runPowerShell(RAW_PRINT_PS, {
    BIZSUIT_PRINTER_NAME: printerName,
    BIZSUIT_RAW_PRINT_BASE64: buffer.toString('base64'),
    BIZSUIT_PRINT_DOC_NAME: docName,
  });
}

function ptToMicrons(value) {
  const pt = Number(value || 0);
  if (!Number.isFinite(pt) || pt <= 0) return 0;
  return Math.round(pt * 25.4 * 1000 / 72);
}

function normalizedPrintPageOptions(meta = {}) {
  const width = ptToMicrons(meta.widthPt);
  const height = ptToMicrons(meta.heightPt);
  const options = {
    landscape: Boolean(meta.landscape || (width > 0 && height > 0 && width > height)),
    margins: { marginType: 'none' },
    printBackground: true,
  };
  if (width >= 353 && height >= 353) options.pageSize = { width, height };
  return options;
}

async function readPrintPageMeta(webContents) {
  try {
    return await webContents.executeJavaScript(`(() => {
      const body = document.body || {};
      const page = document.querySelector('.sml-page');
      const pageStyle = page ? window.getComputedStyle(page) : null;
      const toPt = (value) => {
        const text = String(value || '').trim();
        if (!text) return 0;
        if (text.endsWith('pt')) return Number.parseFloat(text);
        if (text.endsWith('px')) return Number.parseFloat(text) * 72 / 96;
        return Number.parseFloat(text) || 0;
      };
      const widthPt = Number.parseFloat(body.dataset.printWidthPt || '') || toPt(pageStyle && pageStyle.width);
      const heightPt = Number.parseFloat(body.dataset.printHeightPt || '') || toPt(pageStyle && pageStyle.height);
      return {
        widthPt,
        heightPt,
        landscape: body.dataset.printLandscape === '1' || widthPt > heightPt,
      };
    })()`);
  } catch {
    return {};
  }
}

function isPosSlipPrintUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.pathname.endsWith('/sale-print/pos-slip');
  } catch {
    return String(url || '').includes('/sale-print/pos-slip');
  }
}

function printUrl(url, options = {}, getConfig) {
  const config = getConfig();
  const devices = config.devices || {};
  const printerName = options.printerName || devices.printerName || '';
  const silent = options.silent ?? devices.printSilently ?? true;
  if (!url) throw new Error('url is required');

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const cleanup = () => {
      if (!win.isDestroyed()) win.close();
    };
    win.webContents.once('did-fail-load', (_event, code, description) => {
      cleanup();
      reject(new Error(description || `print load failed ${code}`));
    });
    win.webContents.once('did-finish-load', async () => {
      if (isPosSlipPrintUrl(url)) {
        win.webContents.print(
          { silent, deviceName: printerName, margins: { marginType: 'none' }, printBackground: true },
          (success, failureReason) => {
            cleanup();
            if (success) resolve({ ok: true });
            else reject(new Error(failureReason || 'print failed'));
          }
        );
        return;
      }
      const pageMeta = await readPrintPageMeta(win.webContents);
      const pageOptions = normalizedPrintPageOptions(pageMeta);
      win.webContents.print({ ...pageOptions, silent, deviceName: printerName }, (success, failureReason) => {
        cleanup();
        if (success) resolve({ ok: true });
        else reject(new Error(failureReason || 'print failed'));
      });
    });
    win.loadURL(url);
  });
}

async function openCashDrawer(options = {}, getConfig) {
  const config = getConfig();
  const drawer = { ...(config.devices?.cashDrawer || {}), ...options };
  const mode = String(drawer.mode || 'printer').toLowerCase();
  const bytes = hexToBuffer(drawer.openBytesHex || '1B700019FA');

  if (mode === 'printer') {
    return sendRawToPrinter({
      printerName: drawer.printerName || config.devices?.rawPrinterName || config.devices?.printerName,
      bytes,
      docName: 'NextStep POS cash drawer',
    });
  }

  if (mode === 'serial') {
    if (!drawer.port) throw new Error('cashDrawer.port is required');
    return runPowerShell(SERIAL_WRITE_PS, {
      BIZSUIT_SERIAL_PORT: drawer.port,
      BIZSUIT_SERIAL_BAUD_RATE: String(drawer.baudRate || 9600),
      BIZSUIT_SERIAL_BYTES_BASE64: bytes.toString('base64'),
    });
  }

  if (mode === 'usbcr') {
    return runPowerShell(USBCR_PS, {
      BIZSUIT_DLL_DIR: drawer.dllDir || config.devices?.dllDir || path.dirname(process.execPath),
      BIZSUIT_DRAWER_ID: String(drawer.drawerId ?? drawer.openCode ?? 1),
    });
  }

  if (mode === 'friusb') {
    return runPowerShell(FRIUSB_PS, {
      BIZSUIT_DLL_DIR: drawer.dllDir || config.devices?.dllDir || path.dirname(process.execPath),
    });
  }

  if (mode === 'command') {
    if (!drawer.command) throw new Error('cashDrawer.command is required');
    return new Promise((resolve, reject) => {
      const child = spawn(drawer.command, drawer.args || [], { windowsHide: true });
      child.on('exit', (code) => (code === 0 ? resolve({ ok: true }) : reject(new Error(`cash drawer command exited with code ${code}`))));
    });
  }

  throw new Error(`unsupported cash drawer mode: ${mode}`);
}

async function scanUsbCrDrawers(options = {}, getConfig) {
  const config = getConfig();
  const requestedMaxDrawerId = Number(options.maxDrawerId || 8);
  const maxDrawerId = Number.isFinite(requestedMaxDrawerId) ? Math.min(8, Math.max(1, Math.trunc(requestedMaxDrawerId))) : 8;
  const result = await runPowerShell(USBCR_SCAN_PS, {
    BIZSUIT_DLL_DIR: options.dllDir || config.devices?.cashDrawer?.dllDir || config.devices?.dllDir || path.dirname(process.execPath),
    BIZSUIT_MAX_DRAWER_ID: String(maxDrawerId),
  });
  const payload = parsePowerShellJson(result.stdout, 'usbcr drawer scan');
  const drawers = (payload.drawers || []).map((row) => {
    const status = Number(row.status);
    return {
      drawerId: Number(row.drawerId),
      status,
      responded: row.responded === true,
      available: row.responded === true && (status === 0 || status === 1),
      state: status === 0 ? 'open' : status === 1 ? 'closed' : 'unknown',
    };
  });
  return { ok: true, api: payload.api, drawers };
}

function registerDeviceBridge(getConfig) {
  ipcMain.handle('bizsuit:devices:config', () => getConfig().devices || {});
  ipcMain.handle('bizsuit:devices:list-printers', async (event) => event.sender.getPrintersAsync());
  ipcMain.handle('bizsuit:devices:print-url', async (_event, payload = {}) => printUrl(payload.url, payload, getConfig));
  ipcMain.handle('bizsuit:devices:print-raw-hex', async (_event, payload = {}) =>
    sendRawToPrinter({
      printerName: payload.printerName || getConfig().devices?.rawPrinterName || getConfig().devices?.printerName,
      bytes: hexToBuffer(payload.hex),
      docName: payload.docName || 'NextStep POS ESC/P2',
    }),
  );
  ipcMain.handle('bizsuit:devices:open-cash-drawer', async (_event, payload = {}) => openCashDrawer(payload, getConfig));
  ipcMain.handle('bizsuit:devices:scan-usbcr-drawers', async (_event, payload = {}) => scanUsbCrDrawers(payload, getConfig));
}

module.exports = { registerDeviceBridge };

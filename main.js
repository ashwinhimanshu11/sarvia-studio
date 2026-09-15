const { app, BrowserWindow, ipcMain, clipboard, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("child_process");
const { performWindowsSetup } = require("./setup-main.js");

// ==========================================
// GLOBALS & CANCELLATION TRACKERS
// ==========================================
let mainWindow;
let cancelCurrentTask = false;
let activeChildProcesses = new Set();
let childWindows = new Set();

ipcMain.on("cancel-task", () => {
  cancelCurrentTask = true;
  activeChildProcesses.forEach((child) => {
    try {
      // SIGKILL guarantees instant destruction of FFmpeg
      child.kill("SIGKILL");
    } catch (e) {}
  });
});

ipcMain.handle("window-control", (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { isMaximized: false };

  if (action === "minimize") {
    win.minimize();
  } else if (action === "maximize") {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  } else if (action === "close") {
    win.close();
  }

  return { isMaximized: !win.isDestroyed() && win.isMaximized() };
});

// ==========================================
// HELPERS
// ==========================================
function getBundledBinaryPath(binaryName) {
  const isWin = process.platform === "win32";
  const executableName = isWin ? `${binaryName}.exe` : binaryName;
  const platformFolder = isWin ? "win" : (process.platform === "darwin" ? "mac" : "linux");
  const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
  const bundledPath = path.join(baseDir, "bin", platformFolder, executableName);
  
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  // Fallback to userData/bin if needed
  return path.join(app.getPath("userData"), "bin", executableName);
}

function getExiftoolPath() {
  return getBundledBinaryPath("exiftool");
}

function normalizeExtension(filePath) {
  return path.extname(filePath).replace(".", "").toLowerCase();
}

function validateSameExtensionTargets(targetPaths, expectedExtension) {
  const normalizedExpected = String(expectedExtension || "")
    .replace(".", "")
    .toLowerCase();
  const invalidPath = targetPaths.find(
    (filePath) => normalizeExtension(filePath) !== normalizedExpected,
  );
  if (invalidPath)
    return {
      error: `All target files must be .${normalizedExpected} files. Mismatch: ${path.basename(invalidPath)}`,
    };
  return null;
}

// Updated runExiftool to track processes for cancellation
function runExiftool(args) {
  return new Promise((resolve) => {
    const child = execFile(getExiftoolPath(), args, (error, stdout, stderr) => {
      activeChildProcesses.delete(child);
      if (error && error.killed) {
        resolve({ error: "Cancelled" });
        return;
      }
      if (error) {
        resolve({ error: stderr || error.message });
        return;
      }
      resolve({ success: true, output: stdout });
    });
    activeChildProcesses.add(child);
  });
}

function toExifDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getUniqueOutputPath(inputPath, targetExtension) {
    const directory = path.dirname(inputPath);
    const parsed = path.parse(inputPath);
    
    // If the file already has "_converted", strip it so we don't get "name_converted_converted.heic"
    const cleanName = parsed.name.replace(/_converted(_\d+)?$/, '');
    
    let outputPath = path.join(directory, `${cleanName}_converted.${targetExtension}`);
    let counter = 2;
    
    // Only increment if the file actually exists and isn't the same file we are creating
    while (fs.existsSync(outputPath) && outputPath !== inputPath) {
        outputPath = path.join(directory, `${cleanName}_converted_${counter}.${targetExtension}`);
        counter += 1;
    }
    return outputPath;
}

function getConversionArgs(inputPath, outputPath, targetExtension) {
  const imageTargets = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "tiff",
    "tif",
    "avif",
    "heic",
    "bmp",
    "gif",
  ]);
  const videoTargets = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
  const ext = targetExtension.toLowerCase();
  const args = ["-y", "-hide_banner", "-i", inputPath];

  if (imageTargets.has(ext)) {
    if (ext === "jpg" || ext === "jpeg")
      return [...args, "-frames:v", "1", "-q:v", "2", outputPath];
    if (ext === "webp")
      return [...args, "-frames:v", "1", "-quality", "90", outputPath];
    if (ext === "avif")
      return [...args, "-frames:v", "1", "-crf", "28", outputPath];
    if (ext === "heic")
      return [
        ...args,
        "-frames:v",
        "1",
        "-c:v",
        "libx265",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "mp4",
        "-brand",
        "heic",
        "-tag:v",
        "hvc1",
        outputPath,
      ];
    return [...args, "-frames:v", "1", outputPath];
  }

  if (videoTargets.has(ext)) {
    if (ext === "webm")
      return [
        ...args,
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        "32",
        "-c:a",
        "libopus",
        outputPath,
      ];
    if (ext === "avi")
      return [
        ...args,
        "-c:v",
        "mpeg4",
        "-q:v",
        "4",
        "-c:a",
        "libmp3lame",
        outputPath,
      ];
    return [
      ...args,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath,
    ];
  }

  return [...args, outputPath];
}

// NEW: Helper to Clean up or Restore EXIF Backups
async function cleanupExifBackups(processedPaths, revert = false) {
  await new Promise((r) => setTimeout(r, 200)); // Small delay to let OS release file locks
  for (const targetPath of processedPaths) {
    const backupPath = `${targetPath}_original`;
    if (fs.existsSync(backupPath)) {
      try {
        if (revert) {
          // Restoring: Delete the modified version, put the original back
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          fs.renameSync(backupPath, targetPath);
        } else {
          // Success: Wipe the backup cleanly
          fs.unlinkSync(backupPath);
        }
      } catch (err) {
        console.error("Cleanup error for", targetPath, err);
      }
    }
  }
}

function setBinaryPermissions() {
  if (process.platform === "win32") return;
  const osFolder = process.platform === "darwin" ? "mac" : "linux";
  const binaries = ["exiftool", "ffmpeg", "ffprobe"];

  const baseDir = app.isPackaged ? process.resourcesPath : __dirname;

  binaries.forEach((binary) => {
    const binaryPath = path.join(baseDir, "bin", osFolder, binary);
    if (fs.existsSync(binaryPath)) {
      try {
        fs.chmodSync(binaryPath, 0o755);
      } catch (err) {}
    }
  });
}

function attachWindowStateEvents(win) {
  const sendState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("window-maximized-state", win.isMaximized());
    }
  };

  win.on("maximize", sendState);
  win.on("unmaximize", sendState);
  win.webContents.once("did-finish-load", sendState);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  attachWindowStateEvents(mainWindow);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");
  mainWindow.webContents.once("did-finish-load", () => {
    if (process.platform === "win32") {
      const ffmpegExists = fs.existsSync(getBundledBinaryPath("ffmpeg"));
      const pythonExists = fs.existsSync(path.join(app.getPath("userData"), "yolo", "python", "python.exe"));
      if (!ffmpegExists || !pythonExists) {
        mainWindow.webContents.send("show-setup-screen");
      }
    }
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

// ==========================================
// APP LIFECYCLE
// ==========================================
app.whenReady().then(() => {
  setBinaryPermissions();
  createWindow();
});
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", function () {
  if (mainWindow === null) createWindow();
});

// ==========================================
// IPC HANDLERS
// ==========================================
ipcMain.handle("start-windows-setup", async (event) => {
  return await performWindowsSetup(event);
});

ipcMain.handle("read-dir", async (event, dirPath) => {
  try {
    const stat = fs.statSync(dirPath);
    let targetDir = stat.isDirectory() ? dirPath : path.dirname(dirPath);
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });

    return entries
      .map((entry) => {
        const fullPath = path.join(targetDir, entry.name);
        let size = 0,
          modified = new Date();
        try {
          const fileStats = fs.statSync(fullPath);
          size = fileStats.size;
          modified = fileStats.mtime;
        } catch (err) {}
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: fullPath,
          size,
          modified,
          extension: entry.name.split(".").pop().toLowerCase(),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle("read-dir-recursive", async (event, dirPath) => {
  try {
    // NEW: Check if the path is a file. If it is, target its parent folder instead.
    const stat = fs.statSync(dirPath);
    const targetDir = stat.isDirectory() ? dirPath : path.dirname(dirPath);

    const results = [];
    function walk(currentPath) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          try {
            const fileStats = fs.statSync(fullPath);
            results.push({
              name: entry.name,
              isDirectory: false,
              path: fullPath,
              size: fileStats.size,
              modified: fileStats.mtime,
              extension: entry.name.split(".").pop().toLowerCase(),
            });
          } catch (err) {}
        }
      }
    }

    // Start the recursive walk from the safe directory
    walk(targetDir);
    return results;
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle("get-file-details", async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    const ext = filePath.split(".").pop().toLowerCase();
    let thumbnail = null;
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp"];
    if (imageExtensions.includes(ext) && stats.size < 10 * 1024 * 1024) {
      try {
        const buffer = fs.readFileSync(filePath);
        thumbnail = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buffer.toString("base64")}`;
      } catch (err) {}
    }
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: ext,
      thumbnail,
    };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle("get-exif-data", async (event, filePath) => {
  return new Promise((resolve) => {
    execFile(getExiftoolPath(), ["-j", filePath], (error, stdout) => {
      if (error) resolve({ error: error.message });
      else {
        try {
          resolve(JSON.parse(stdout)[0]);
        } catch (e) {
          resolve({ error: "Failed to parse EXIF." });
        }
      }
    });
  });
});

ipcMain.handle("copy-text", async (event, text) => {
  clipboard.writeText(String(text ?? ""));
  return { success: true };
});
ipcMain.handle("read-text", async () => {
  return clipboard.readText();
});

// ==========================================
// EXIF EDITING & RESTORE LOGIC
// ==========================================
ipcMain.handle("paste-exif-metadata", async (event, sourcePath, targetPath) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  try {
    if (!fs.existsSync(sourcePath))
      return { error: "The source file could not be found." };
    if (!fs.existsSync(targetPath))
      return { error: "The target file could not be found." };
    if (
      path.extname(sourcePath).toLowerCase() !==
      path.extname(targetPath).toLowerCase()
    )
      return { error: "Extensions must match." };
    if (sourcePath === targetPath) return { success: true, skipped: true };

    // Notice we REMOVED '-overwrite_original' here to create backups
    const args = ["-all=", "-TagsFromFile", sourcePath, "-all:all", targetPath];
    const result = await runExiftool(args);

    await cleanupExifBackups([targetPath], cancelCurrentTask || result.error);
    if (cancelCurrentTask || result.error)
      return {
        error: cancelCurrentTask
          ? "Task cancelled. Restored original file."
          : result.error,
      };

    if (mainWindow)
      mainWindow.webContents.send("metadata-updated", [targetPath]);
    return { success: true, output: result.output };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle("apply-exif-edits", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  const targetPaths = Array.isArray(payload?.targetPaths)
    ? payload.targetPaths
    : [];
  const edits = Array.isArray(payload?.edits) ? payload.edits : [];
  const removals = Array.isArray(payload?.removals) ? payload.removals : [];

  if (targetPaths.length === 0) return { error: "No files selected." };
  const validationError = validateSameExtensionTargets(
    targetPaths,
    payload?.extension,
  );
  if (validationError) return validationError;

  const tagArgs = [
    ...removals.map((tag) => `-${tag}=`),
    ...edits.map((edit) => `-${edit.tag}=${edit.value}`),
  ];
  if (tagArgs.length === 0) return { error: "No changes found." };

  const results = [];
  const processedPaths = [];

  for (let i = 0; i < targetPaths.length; i++) {
    if (cancelCurrentTask) break;
    const targetPath = targetPaths[i];
    processedPaths.push(targetPath);

    event.sender.send("task-progress", {
      title: "Applying Metadata",
      current: i,
      total: targetPaths.length,
      detail: `Updating: ${path.basename(targetPath)}`,
    });

    // Removed '-overwrite_original'
    const result = await runExiftool([...tagArgs, targetPath]);
    results.push({ path: targetPath, ...result });
  }

  await cleanupExifBackups(processedPaths, cancelCurrentTask);
  if (cancelCurrentTask)
    return {
      error:
        "Task cancelled by user. All modified files were reverted to their original state.",
    };

  const failed = results.filter((result) => result.error);
  if (failed.length > 0)
    return { error: `${failed.length} file(s) failed.`, results };

  if (mainWindow) mainWindow.webContents.send("metadata-updated", targetPaths);
  return { success: true, results };
});

ipcMain.handle("randomize-exif-date", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  const targetPaths = Array.isArray(payload?.targetPaths)
    ? payload.targetPaths
    : [];
  const start = new Date(payload?.startDate),
    end = new Date(payload?.endDate);
  const dateTags = [
    "CreateDate",
    "DateTimeOriginal",
    "ModifyDate",
    "MediaCreateDate",
    "TrackCreateDate",
    "FileCreateDate",
  ];

  if (targetPaths.length === 0) return { error: "No files selected." };
  const validationError = validateSameExtensionTargets(
    targetPaths,
    payload?.extension,
  );
  if (validationError) return validationError;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return { error: "Invalid dates." };
  if (start.getTime() > end.getTime())
    return { error: "Start must be before end." };

  const results = [];
  const processedPaths = [];

  for (let i = 0; i < targetPaths.length; i++) {
    if (cancelCurrentTask) break;
    const targetPath = targetPaths[i];
    processedPaths.push(targetPath);

    event.sender.send("task-progress", {
      title: "Randomizing Dates",
      current: i,
      total: targetPaths.length,
      detail: `Updating: ${path.basename(targetPath)}`,
    });

    const randomTime =
      start.getTime() + Math.random() * (end.getTime() - start.getTime());
    const exifDate = toExifDate(new Date(randomTime));
    const tagArgs = dateTags.map((tag) => `-${tag}=${exifDate}`);

    // Removed '-overwrite_original'
    const result = await runExiftool([...tagArgs, targetPath]);
    results.push({ path: targetPath, date: exifDate, ...result });
  }

  await cleanupExifBackups(processedPaths, cancelCurrentTask);
  if (cancelCurrentTask)
    return {
      error:
        "Task cancelled by user. All modified files were reverted to their original state.",
    };

  const failed = results.filter((result) => result.error);
  if (failed.length > 0)
    return { error: `${failed.length} file(s) failed.`, results };

  if (mainWindow) mainWindow.webContents.send("metadata-updated", targetPaths);
  return { success: true, results };
});

// ==========================================
// MEDIA CONVERSION & WIPEOUT LOGIC
// ==========================================
ipcMain.handle("convert-media-files", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();

  const files = Array.isArray(payload?.files) ? payload.files : [];
  const targetExtension = String(payload?.targetExtension || "")
    .replace(".", "")
    .toLowerCase();

  if (files.length === 0)
    return { error: "No files were selected for conversion." };
  if (!targetExtension)
    return { error: "Choose a target format before converting." };

  const ffmpegPath = getBundledBinaryPath("ffmpeg");
  if (!fs.existsSync(ffmpegPath))
    return { error: "Bundled FFmpeg binary was not found." };

  const isMac = process.platform === "darwin";
  const results = [];
  const generatedFiles = []; // Track everything generated in this run for complete wipeout

  for (let i = 0; i < files.length; i++) {
    if (cancelCurrentTask) break;

    const filePath = files[i];
    if (!fs.existsSync(filePath)) {
      results.push({ inputPath: filePath, error: "File not found." });
      continue;
    }

    const outputPath = getUniqueOutputPath(filePath, targetExtension);
    generatedFiles.push(outputPath); // Track it

    const fileName = path.basename(filePath);
    event.sender.send("task-progress", {
      title: "Converting Media",
      current: i,
      total: files.length,
      detail: `Initializing: ${fileName}`,
    });

    if (isMac && targetExtension === "heic") {
      const result = await new Promise((resolve) => {
        const child = execFile(
          "sips",
          ["-s", "format", "heic", filePath, "--out", outputPath],
          (error, stdout, stderr) => {
            activeChildProcesses.delete(child);
            if (error && error.killed)
              resolve({ inputPath: filePath, outputPath, error: "Cancelled" });
            else if (error)
              resolve({
                inputPath: filePath,
                outputPath,
                error: stderr || error.message,
              });
            else resolve({ inputPath: filePath, outputPath, success: true });
          },
        );
        activeChildProcesses.add(child);
      });
      results.push(result);
      continue;
    }

    const args = getConversionArgs(filePath, outputPath, targetExtension);
    const result = await new Promise((resolve) => {
      let totalDurationSec = 0;
      const child = execFile(ffmpegPath, args, (error, stdout, stderr) => {
        activeChildProcesses.delete(child);
        if (error && error.killed)
          resolve({ inputPath: filePath, outputPath, error: "Cancelled" });
        else if (error)
          resolve({
            inputPath: filePath,
            outputPath,
            error: stderr || error.message,
          });
        else resolve({ inputPath: filePath, outputPath, success: true });
      });
      activeChildProcesses.add(child);

      child.stderr.on("data", (data) => {
        const str = data.toString();
        if (!totalDurationSec) {
          const durMatch = str.match(
            /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
          );
          if (durMatch)
            totalDurationSec =
              parseInt(durMatch[1]) * 3600 +
              parseInt(durMatch[2]) * 60 +
              parseFloat(durMatch[3]);
        }
        const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch && totalDurationSec > 0) {
          const currentSec =
            parseInt(timeMatch[1]) * 3600 +
            parseInt(timeMatch[2]) * 60 +
            parseFloat(timeMatch[3]);
          const fileProgress = Math.min(1, currentSec / totalDurationSec);

          event.sender.send("task-progress", {
            title: "Converting Media",
            current: i + fileProgress,
            total: files.length,
            detail: `Converting: ${fileName} (${Math.round(fileProgress * 100)}%)`,
          });
        }
      });
    });
    results.push(result);
  }

  // Completely wipe out generated files if user hit cancel
  if (cancelCurrentTask) {
    await new Promise((r) => setTimeout(r, 600)); // Crucial delay to ensure FFmpeg releases file locks
    for (const file of generatedFiles) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) {
        console.log(e);
      }
    }
    return {
      error:
        "Task cancelled by user. All generated and partial files have been removed.",
    };
  }

  const failed = results.filter((result) => result.error);
  if (failed.length > 0)
    return {
      error: `${failed.length} of ${files.length} file(s) could not be converted.`,
      results,
    };

  return { success: true, results };
});

// ==========================================
// EXIF POPUP ROUTER
// ==========================================
ipcMain.on("open-exif-window", (event, payload) => {
  const exifWin = new BrowserWindow({
    width: 600,
    height: 700,
    minWidth: 500,
    minHeight: 600,
    title: "EXIF Metadata - " + payload.filename,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  attachWindowStateEvents(exifWin);
  exifWin.setMenuBarVisibility(false);
  exifWin.loadFile("exif-window.html");
  exifWin.webContents.once("did-finish-load", () =>
    exifWin.webContents.send("render-exif", payload),
  );
});

// ==========================================
// IMAGE EDITOR POPUP ROUTER
// ==========================================
ipcMain.on("open-image-editor-window", (event, payload) => {
  const editorWin = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#171717',
    title: "Image Editor - " + path.basename(payload.filePath),
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  attachWindowStateEvents(editorWin);

  editorWin.setMenuBarVisibility(false);
  childWindows.add(editorWin);
  editorWin.on('closed', () => {
    childWindows.delete(editorWin);
  });
  
  editorWin.loadFile("image-editor-window.html");
  editorWin.once("ready-to-show", () => editorWin.show());
  editorWin.webContents.once("did-finish-load", () =>
    editorWin.webContents.send("init-editor", payload),
  );
});

ipcMain.handle("save-image", async (event, { dataUrl, originalPath, replace }) => {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    
    if (replace) {
      fs.writeFileSync(originalPath, buffer);
      return { success: true, path: originalPath };
    } else {
      const ext = path.extname(originalPath);
      const basename = path.basename(originalPath, ext);
      const dir = path.dirname(originalPath);
      const newPath = path.join(dir, `${basename}_edited${ext}`);
      fs.writeFileSync(newPath, buffer);
      return { success: true, path: newPath };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

const os = require("os");
const { exec } = require("child_process");

ipcMain.handle("run-yolo-redact", async (event, dataUrl, mode = "blur", target = "faces") => {
  return new Promise((resolve) => {
    const tempIn = path.join(os.tmpdir(), `redact_in_${Date.now()}.png`);
    const tempOut = path.join(os.tmpdir(), `redact_out_${Date.now()}.png`);
    
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(tempIn, base64Data, "base64");
    
    const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
    const pythonPath = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "python", "python.exe")
      : path.join(baseDir, "yolo_venv", "bin", "python");
    
    const insightScript = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "insightface_redact.py")
      : path.join(baseDir, "insightface_redact.py");
    const yoloScript = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "yolo_redact.py")
      : path.join(baseDir, "yolo_redact.py");
    
    const scriptPath = fs.existsSync(insightScript) ? insightScript : yoloScript;

    exec(`"${pythonPath}" "${scriptPath}" "${tempIn}" "${tempOut}" "${mode}" "${target}"`, (error, stdout, stderr) => {
      try {
        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
      } catch (e) {}
      
      if (error) {
        fs.writeFileSync(path.join(os.tmpdir(), "redact_debug.log"), "Error: " + (stderr || error.message));
        resolve({ error: stderr || error.message });
      } else {
        try {
          fs.writeFileSync(path.join(os.tmpdir(), "redact_debug.log"), "Stdout: " + stdout);
          const jsonMatch = stdout.match(/\{.*"success".*\}/);
          const resultStr = jsonMatch ? jsonMatch[0] : stdout;
          const result = JSON.parse(resultStr);
          
          if (result.success) {
            let outDataUrl = null;
            if (fs.existsSync(tempOut)) {
              const outBuffer = fs.readFileSync(tempOut);
              outDataUrl = `data:image/png;base64,${outBuffer.toString("base64")}`;
              try { fs.unlinkSync(tempOut); } catch (e) {}
            }
            resolve({
              success: true,
              count: result.count !== undefined ? result.count : (result.boxes ? result.boxes.length : 0),
              boxes: result.boxes || [],
              dataUrl: outDataUrl
            });
          } else {
            resolve({ error: result.error || "Unknown error" });
          }
        } catch (e) {
          resolve({ error: "Failed to parse Python output: " + stdout });
        }
      }
    });
  });
});

ipcMain.handle("run-yolo-video-redact", async (event, inputFilePath, mode = "blur", target = "faces") => {
  return new Promise((resolve) => {
    const ext = path.extname(inputFilePath) || ".mp4";
    const tempNoAudio = path.join(os.tmpdir(), `yolo_vid_raw_${Date.now()}${ext}`);
    const tempFinal = path.join(os.tmpdir(), `yolo_vid_out_${Date.now()}${ext}`);
    
    const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
    const pythonPath = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "python", "python.exe")
      : path.join(baseDir, "yolo_venv", "bin", "python");
    const scriptPath = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "yolo_redact.py")
      : path.join(baseDir, "yolo_redact.py");
    const modelPath = process.platform === "win32"
      ? path.join(app.getPath("userData"), "yolo", "yolov8n.pt")
      : path.join(baseDir, "yolov8n.pt");

    const { spawn } = require("child_process");
    const child = spawn(pythonPath, [scriptPath, inputFilePath, tempNoAudio, mode, target, modelPath], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });
    
    let stdoutData = "";
    let stderrData = "";
    
    child.stdout.on("data", (data) => {
      const str = data.toString();
      stdoutData += str;
      const lines = str.split("\n");
      for (const line of lines) {
        if (line.startsWith("PROGRESS:")) {
          const pct = parseInt(line.replace("PROGRESS:", "").trim()) || 0;
          mainWindow.webContents.send("task-progress", {
            title: "Auto Redacting Faces",
            current: pct,
            total: 100,
            detail: `Processing video frames (${pct}%)...`
          });
        }
      }
    });
    
    child.stderr.on("data", (data) => {
      stderrData += data.toString();
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: stderrData || `Python exited with code ${code}` });
        return;
      }
      
      try {
        const jsonMatch = stdoutData.match(/\{.*"success".*\}/);
        const resultStr = jsonMatch ? jsonMatch[0] : stdoutData;
        const result = JSON.parse(resultStr);
        
        if (!result.success) {
          resolve({ error: result.error || "Video redaction failed" });
          return;
        }
        
        const ffmpegPath = getBundledBinaryPath("ffmpeg");
        const ffmpegArgs = [
          "-i", tempNoAudio,
          "-i", inputFilePath,
          "-c:v", "copy",
          "-c:a", "aac",
          "-map", "0:v:0",
          "-map", "1:a:0?",
          "-y", tempFinal
        ];
        
        execFile(ffmpegPath, ffmpegArgs, (err) => {
          try {
            if (fs.existsSync(tempNoAudio)) fs.unlinkSync(tempNoAudio);
          } catch(e) {}
          
          if (err) {
            resolve({ success: true, outputPath: tempNoAudio });
          } else {
            resolve({ success: true, outputPath: tempFinal });
          }
        });
      } catch (e) {
        resolve({ error: "Failed to parse Python output: " + stdoutData });
      }
    });
  });
});

ipcMain.handle("save-video", async (event, payload) => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const { filePath, replace, trimStart, trimEnd, cropW, cropH, cropX, cropY, mute, blurData } = payload;
  
  const ext = path.extname(filePath);
  const tempPath = path.join(os.tmpdir(), "sarvia_studio_video_out_" + Date.now() + ext);
  
  let args = [];
  
  if (trimStart !== null && trimStart !== undefined) {
    args.push("-ss", String(trimStart));
  }
  
  args.push("-i", filePath);
  
  if (trimEnd !== null && trimEnd !== undefined) {
    const dur = trimEnd - (trimStart || 0);
    args.push("-t", String(dur));
  }
  
  let filterComplex = "";
  let vOut = "";
  
  if (blurData) {
    let enable = "";
    if (blurData.start !== null && blurData.end !== null) {
      enable = `:enable='between(t,${blurData.start},${blurData.end})'`;
    }
    
    // Ensure blur radius is not larger than allowed by box size
    const maxLuma = Math.max(0, Math.floor(Math.min(blurData.w, blurData.h) / 2) - 1);
    const maxChroma = Math.max(0, Math.floor(Math.min(blurData.w, blurData.h) / 4) - 1);
    const lumaR = Math.min(20, maxLuma);
    const chromaR = Math.min(20, maxChroma);
    
    filterComplex += `[0:v]crop=${blurData.w}:${blurData.h}:${blurData.x}:${blurData.y},boxblur=lr=${lumaR}:lp=10:cr=${chromaR}:cp=10[b];[0:v][b]overlay=${blurData.x}:${blurData.y}${enable}[v1];`;
    vOut = "[v1]";
  }
  
  if (cropW !== null && cropH !== null) {
    let inNode = vOut ? vOut : "[0:v]";
    // libx264 requires even dimensions for yuv420p
    const safeCropW = cropW % 2 === 0 ? cropW : cropW - 1;
    const safeCropH = cropH % 2 === 0 ? cropH : cropH - 1;
    filterComplex += `${inNode}crop=${safeCropW}:${safeCropH}:${cropX}:${cropY}[vout];`;
    vOut = "[vout]";
  }
  
  if (filterComplex) {
    filterComplex = filterComplex.slice(0, -1);
    args.push("-filter_complex", filterComplex, "-map", vOut);
    if (!mute) {
      args.push("-map", "0:a?");
    }
  }
  
  if (mute) {
    args.push("-c:v", "libx264", "-crf", "23", "-preset", "fast", "-an", "-y", tempPath);
  } else {
    args.push("-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "aac", "-y", tempPath);
  }
  
  return new Promise((resolve) => {
    const ffmpegPath = getBundledBinaryPath("ffmpeg");
    const child = execFile(ffmpegPath, args, (err, stdout, stderr) => {
      activeChildProcesses.delete(child);
      if (cancelCurrentTask) {
        resolve({ error: "Cancelled" });
      } else if (err) {
        resolve({ error: "Save failed: " + err.message + "\nFFmpeg Log: " + stderr });
      } else {
        if (replace) {
          fs.copyFileSync(tempPath, filePath);
          fs.unlinkSync(tempPath);
          mainWindow.webContents.send("metadata-updated", [filePath]);
          resolve({ success: true, newPath: filePath });
        } else {
          const newPath = getUniqueOutputPath(filePath, ext.replace(".", ""));
          fs.copyFileSync(tempPath, newPath);
          fs.unlinkSync(tempPath);
          mainWindow.webContents.send("metadata-updated", [newPath]);
          resolve({ success: true, newPath: newPath });
        }
      }
    });
    activeChildProcesses.add(child);
  });
});

// ==========================================
// VIDEO PROXY SYSTEM
// ==========================================
ipcMain.handle("prepare-video-proxy", async (event, payload) => {
  const os = require('os');
  const path = require('path');
  
  const filePath = typeof payload === "string" ? payload : payload.filePath;
  const cropData = typeof payload === "string" ? null : payload.cropData;
  const ext = path.extname(filePath).toLowerCase();
  
  // Natively supported by Chromium (mostly)
  if (['.mp4', '.webm', '.ogg'].includes(ext) && !cropData) {
    return { proxyPath: filePath }; // Try to load directly
  }
  
  return new Promise((resolve) => {
    const proxyPath = path.join(os.tmpdir(), "sarvia_studio_proxy_" + Date.now() + ".mp4");
    const ffmpegPath = getBundledBinaryPath("ffmpeg");
    
    let args = ["-i", filePath];
    if (cropData) {
      args.push("-vf", `crop=${cropData.w}:${cropData.h}:${cropData.x}:${cropData.y}`);
    }
    
    args.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28", // lower quality, higher speed
      "-c:a", "aac",
      "-b:a", "128k",
      "-y",
      proxyPath
    );
    
    let totalDurationSec = 0;
    const child = execFile(ffmpegPath, args, (error) => {
      activeChildProcesses.delete(child);
      if (cancelCurrentTask) {
        resolve({ error: "Cancelled" });
      } else if (error) {
        resolve({ error: "Preview generation failed." });
      } else {
        resolve({ proxyPath: proxyPath });
      }
    });
    
    activeChildProcesses.add(child);
    
    child.stderr.on("data", (data) => {
      const str = data.toString();
      if (!totalDurationSec) {
        const durMatch = str.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (durMatch) {
          totalDurationSec =
            parseInt(durMatch[1]) * 3600 +
            parseInt(durMatch[2]) * 60 +
            parseFloat(durMatch[3]);
        }
      }
      const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch && totalDurationSec > 0) {
        const currentSec =
          parseInt(timeMatch[1]) * 3600 +
          parseInt(timeMatch[2]) * 60 +
          parseFloat(timeMatch[3]);
        const percent = Math.min(100, Math.round((currentSec / totalDurationSec) * 100));
        event.sender.send("proxy-progress", percent);
      }
    });
  });
});

// ==========================================
// VIDEO EDITOR POPUP ROUTER
// ==========================================
ipcMain.on("open-video-editor-window", (event, payload) => {
  const videoWin = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: "Video Editor - " + path.basename(payload.filePath),
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false // allow local video files for playback if needed, though often isolated context handles file:// fine if loaded locally
    },
  });
  attachWindowStateEvents(videoWin);
  videoWin.setMenuBarVisibility(false);
  videoWin.loadFile("video-editor-window.html");
  videoWin.webContents.once("did-finish-load", () =>
    videoWin.webContents.send("init-video-editor", payload),
  );
});

ipcMain.handle("select-files-dialog", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpeg', 'mpg', '3gp'] }]
  });
  return result;
});

ipcMain.handle("select-folder-dialog", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result;
});

ipcMain.handle("bulk-mute-videos", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const saveMode = payload?.saveMode || "new";
  const targetOutputDir = payload?.outputDir;

  if (files.length === 0) return { error: "No files to mute." };

  const ffmpegPath = getBundledBinaryPath("ffmpeg");
  if (!fs.existsSync(ffmpegPath)) return { error: "Bundled FFmpeg binary not found." };

  const results = [];
  const generatedFiles = [];
  const tempFilesToReplace = [];

  for (let i = 0; i < files.length; i++) {
    if (cancelCurrentTask) break;

    const filePath = files[i];
    if (!fs.existsSync(filePath)) {
      results.push({ inputPath: filePath, error: "File not found." });
      continue;
    }

    const parsed = path.parse(filePath);
    let outputPath;

    if (saveMode === "replace") {
      outputPath = path.join(parsed.dir, `.${parsed.name}_mute_temp_${Date.now()}_${i}${parsed.ext}`);
      tempFilesToReplace.push({ tempPath: outputPath, originalPath: filePath });
    } else if (targetOutputDir && fs.existsSync(targetOutputDir)) {
      outputPath = path.join(targetOutputDir, `${parsed.name}_muted${parsed.ext}`);
      let counter = 2;
      while (fs.existsSync(outputPath) || generatedFiles.includes(outputPath)) {
        outputPath = path.join(targetOutputDir, `${parsed.name}_muted_${counter}${parsed.ext}`);
        counter++;
      }
    } else {
      outputPath = path.join(parsed.dir, `${parsed.name}_muted${parsed.ext}`);
      let counter = 2;
      while (fs.existsSync(outputPath) && outputPath !== filePath) {
        outputPath = path.join(parsed.dir, `${parsed.name}_muted_${counter}${parsed.ext}`);
        counter++;
      }
    }
    generatedFiles.push(outputPath);

    event.sender.send("task-progress", {
      title: "Muting Videos",
      current: i,
      total: files.length,
      detail: `Muting: ${parsed.base}`
    });

    // Copy video stream, remove audio stream
    const args = ["-y", "-hide_banner", "-i", filePath, "-c:v", "copy", "-an", outputPath];
    
    const result = await new Promise((resolve) => {
      const child = execFile(ffmpegPath, args, (error, stdout, stderr) => {
        activeChildProcesses.delete(child);
        if (error && error.killed) resolve({ inputPath: filePath, outputPath, error: "Cancelled" });
        else if (error) resolve({ inputPath: filePath, outputPath, error: stderr || error.message });
        else resolve({ inputPath: filePath, outputPath, success: true });
      });
      activeChildProcesses.add(child);
    });
    results.push(result);
  }

  if (cancelCurrentTask) {
    await new Promise(r => setTimeout(r, 600));
    for (const file of generatedFiles) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch(e) {}
    }
    return { error: "Task cancelled by user. Generated files were removed." };
  }

  if (saveMode === "replace") {
    for (const item of tempFilesToReplace) {
      if (fs.existsSync(item.tempPath)) {
        try {
          fs.copyFileSync(item.tempPath, item.originalPath);
          fs.unlinkSync(item.tempPath);
        } catch (err) {
          console.error("Failed to replace original video:", item.originalPath, err);
        }
      }
    }
  }

  const failed = results.filter(r => r.error);
  if (failed.length > 0) return { error: `${failed.length} file(s) failed to mute.`, results };
  
  return { success: true, results };
});

ipcMain.handle("bulk-extract-frame", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length === 0) return { error: "No files to extract frame from." };

  const frameNumber = Math.max(1, parseInt(payload?.frameNumber, 10) || 1);
  const frameIdx = frameNumber - 1;

  const ffmpegPath = getBundledBinaryPath("ffmpeg");
  if (!fs.existsSync(ffmpegPath)) return { error: "Bundled FFmpeg binary not found." };

  // Use provided outputDir if given, else fallback to source folder / first file folder
  let outputDir = payload?.outputDir;
  if (!outputDir || typeof outputDir !== "string" || !outputDir.trim()) {
    if (payload?.sourceFolder && typeof payload.sourceFolder === "string" && payload.sourceFolder.trim()) {
      const trimmedSource = payload.sourceFolder.trim().replace(/[/\\]+$/, "");
      const parsedSource = path.parse(trimmedSource);
      outputDir = path.join(parsedSource.dir, `${parsedSource.base}_Extracted_Frames`);
    } else {
      const firstDir = path.dirname(files[0]);
      outputDir = path.join(firstDir, "Extracted_Frames");
    }
  }

  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (err) {
    return { error: `Failed to create output folder: ${err.message}` };
  }

  const results = [];
  const generatedFiles = [];

  for (let i = 0; i < files.length; i++) {
    if (cancelCurrentTask) break;

    const filePath = files[i];
    if (!fs.existsSync(filePath)) {
      results.push({ inputPath: filePath, error: "File not found." });
      continue;
    }

    const parsed = path.parse(filePath);
    let fileName = `${parsed.name}_frame_${frameNumber}.png`;
    let outputPath = path.join(outputDir, fileName);

    let counter = 2;
    while (fs.existsSync(outputPath) || generatedFiles.includes(outputPath)) {
      fileName = `${parsed.name}_frame_${frameNumber}_${counter}.png`;
      outputPath = path.join(outputDir, fileName);
      counter++;
    }
    generatedFiles.push(outputPath);

    event.sender.send("task-progress", {
      title: "Extracting Frames",
      current: i,
      total: files.length,
      detail: `Extracting frame ${frameNumber}: ${parsed.base}`
    });

    const args = [
      "-y",
      "-hide_banner",
      "-i", filePath,
      "-vf", `select=gte(n\\,${frameIdx})`,
      "-vframes", "1",
      "-update", "1",
      outputPath
    ];

    const result = await new Promise((resolve) => {
      const child = execFile(ffmpegPath, args, (error, stdout, stderr) => {
        activeChildProcesses.delete(child);
        if (error && error.killed) resolve({ inputPath: filePath, outputPath, error: "Cancelled" });
        else if (error) resolve({ inputPath: filePath, outputPath, error: stderr || error.message });
        else resolve({ inputPath: filePath, outputPath, success: true });
      });
      activeChildProcesses.add(child);
    });
    results.push(result);
  }

  if (cancelCurrentTask) {
    await new Promise(r => setTimeout(r, 600));
    for (const file of generatedFiles) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch(e) {}
    }
    return { error: "Task cancelled by user. Generated files were removed." };
  }

  const failed = results.filter(r => r.error);
  if (failed.length > 0) return { error: `${failed.length} file(s) failed to extract frame.`, results, outputDir };

  return { success: true, results, outputDir };
});

ipcMain.handle("bulk-redact-images", async (event, payload) => {
  cancelCurrentTask = false;
  activeChildProcesses.clear();
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const mode = payload?.mode || "blur";
  const target = payload?.target || "faces";
  const saveMode = payload?.saveMode || "new";
  const targetOutputDir = payload?.outputDir;

  if (files.length === 0) return { error: "No files to redact." };

  const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
  const pythonPath = process.platform === "win32"
    ? path.join(app.getPath("userData"), "yolo", "python", "python.exe")
    : path.join(baseDir, "yolo_venv", "bin", "python");

  const insightScript = process.platform === "win32"
    ? path.join(app.getPath("userData"), "yolo", "insightface_redact.py")
    : path.join(baseDir, "insightface_redact.py");
  const yoloScript = process.platform === "win32"
    ? path.join(app.getPath("userData"), "yolo", "yolo_redact.py")
    : path.join(baseDir, "yolo_redact.py");

  const scriptPath = fs.existsSync(insightScript) ? insightScript : yoloScript;

  const results = [];
  const generatedFiles = [];
  const tempFilesToReplace = [];

  for (let i = 0; i < files.length; i++) {
    if (cancelCurrentTask) break;

    const filePath = files[i];
    if (!fs.existsSync(filePath)) {
      results.push({ inputPath: filePath, error: "File not found." });
      continue;
    }

    const parsed = path.parse(filePath);
    let outputPath;

    if (saveMode === "replace") {
      outputPath = path.join(parsed.dir, `.${parsed.name}_redact_temp_${Date.now()}_${i}${parsed.ext}`);
      tempFilesToReplace.push({ tempPath: outputPath, originalPath: filePath });
    } else if (targetOutputDir && fs.existsSync(targetOutputDir)) {
      outputPath = path.join(targetOutputDir, `${parsed.name}_redacted${parsed.ext}`);
      let counter = 2;
      while (fs.existsSync(outputPath) || generatedFiles.includes(outputPath)) {
        outputPath = path.join(targetOutputDir, `${parsed.name}_redacted_${counter}${parsed.ext}`);
        counter++;
      }
    } else {
      outputPath = path.join(parsed.dir, `${parsed.name}_redacted${parsed.ext}`);
      let counter = 2;
      while (fs.existsSync(outputPath) && outputPath !== filePath) {
        outputPath = path.join(parsed.dir, `${parsed.name}_redacted_${counter}${parsed.ext}`);
        counter++;
      }
    }
    generatedFiles.push(outputPath);

    event.sender.send("task-progress", {
      title: "Auto-Redacting Images",
      current: i,
      total: files.length,
      detail: `Scanning & Redacting: ${parsed.base}`
    });

    const result = await new Promise((resolve) => {
      const child = exec(`"${pythonPath}" "${scriptPath}" "${filePath}" "${outputPath}" "${mode}" "${target}"`, (error, stdout, stderr) => {
        activeChildProcesses.delete(child);
        if (error && error.killed) {
          resolve({ inputPath: filePath, outputPath, error: "Cancelled" });
        } else if (error) {
          resolve({ inputPath: filePath, outputPath, error: stderr || error.message });
        } else {
          try {
            const jsonMatch = stdout.match(/\{.*"success".*\}/);
            const resultStr = jsonMatch ? jsonMatch[0] : stdout;
            const resObj = JSON.parse(resultStr);
            if (resObj.success) {
              resolve({ inputPath: filePath, outputPath, success: true, count: resObj.count });
            } else {
              resolve({ inputPath: filePath, outputPath, error: resObj.error || "Redaction failed" });
            }
          } catch(e) {
            if (fs.existsSync(outputPath)) {
              resolve({ inputPath: filePath, outputPath, success: true });
            } else {
              resolve({ inputPath: filePath, outputPath, error: "Failed to parse Python response: " + stdout });
            }
          }
        }
      });
      activeChildProcesses.add(child);
    });

    results.push(result);
  }

  if (cancelCurrentTask) {
    await new Promise(r => setTimeout(r, 600));
    for (const file of generatedFiles) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch(e) {}
    }
    return { error: "Task cancelled by user. Generated files were removed." };
  }

  if (saveMode === "replace") {
    for (const item of tempFilesToReplace) {
      if (fs.existsSync(item.tempPath)) {
        try {
          fs.copyFileSync(item.tempPath, item.originalPath);
          fs.unlinkSync(item.tempPath);
        } catch (err) {
          console.error("Failed to replace original image:", item.originalPath, err);
        }
      }
    }
  }

  const failed = results.filter(r => r.error);
  if (failed.length > 0) return { error: `${failed.length} file(s) failed to redact.`, results };

  return { success: true, results };
});

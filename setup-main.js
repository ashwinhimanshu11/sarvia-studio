const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { app } = require('electron');

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return request(response.headers.location);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed for '${currentUrl}' (Status: ${response.statusCode}). Please check your internet connection or try again later.`));
        }
        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = fs.createWriteStream(dest);
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress && total) {
            onProgress(downloaded / total);
          }
        });
        
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    };
    request(url);
  });
}

function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command failed: ${command}\n${stderr}`);
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

function getLatestExifToolUrl() {
  return new Promise((resolve, reject) => {
    https.get('https://exiftool.org/', (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        const match64 = data.match(/href="([^"]*exiftool-[0-9.]+_64\.zip)"/);
        if (match64) {
          return resolve(`https://exiftool.org/${match64[1]}`);
        }
        const match32 = data.match(/href="([^"]*exiftool-[0-9.]+\.zip)"/);
        if (match32) {
          return resolve(`https://exiftool.org/${match32[1]}`);
        }
        reject(new Error("Could not automatically find the latest ExifTool Windows zip link on exiftool.org."));
      });
    }).on('error', (err) => reject(new Error(`Failed to reach exiftool.org: ${err.message}`)));
  });
}

async function performWindowsSetup(event) {
  const userData = app.getPath('userData');
  const binDir = path.join(userData, 'bin');
  const yoloDir = path.join(userData, 'yolo');
  const pythonDir = path.join(yoloDir, 'python');
  
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  if (!fs.existsSync(yoloDir)) fs.mkdirSync(yoloDir, { recursive: true });
  if (!fs.existsSync(pythonDir)) fs.mkdirSync(pythonDir, { recursive: true });

  const reportProgress = (task, percent) => {
    if (event) event.sender.send('setup-progress', { task, percent });
  };

  try {
    // 1. Setup Bundled Media Engines (FFmpeg, FFprobe, ExifTool)
    reportProgress('Setting up media engines (FFmpeg, ExifTool)...', 0.2);
    const bundledWinBin = app.isPackaged 
      ? path.join(process.resourcesPath, 'bin', 'win') 
      : path.join(__dirname, 'bin', 'win');

    const bundledFfmpeg = path.join(bundledWinBin, 'ffmpeg.exe');
    const bundledFfprobe = path.join(bundledWinBin, 'ffprobe.exe');
    const bundledExifTool = path.join(bundledWinBin, 'exiftool.exe');
    const bundledExifToolFiles = path.join(bundledWinBin, 'exiftool_files');

    if (fs.existsSync(bundledFfmpeg)) {
      fs.copyFileSync(bundledFfmpeg, path.join(binDir, 'ffmpeg.exe'));
    }
    if (fs.existsSync(bundledFfprobe)) {
      fs.copyFileSync(bundledFfprobe, path.join(binDir, 'ffprobe.exe'));
    }
    if (fs.existsSync(bundledExifTool)) {
      fs.copyFileSync(bundledExifTool, path.join(binDir, 'exiftool.exe'));
    }
    if (fs.existsSync(bundledExifToolFiles)) {
      fs.cpSync(bundledExifToolFiles, path.join(binDir, 'exiftool_files'), { recursive: true });
    }

    // 3. Setup YOLO Model
    reportProgress('Setting up AI Models...', 0.3);
    const bundledModel = app.isPackaged ? path.join(process.resourcesPath, 'yolov8n.pt') : path.join(__dirname, 'yolov8n.pt');
    if (fs.existsSync(bundledModel)) {
      fs.copyFileSync(bundledModel, path.join(yoloDir, 'yolov8n.pt'));
    } else {
      await downloadFile('https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt', path.join(yoloDir, 'yolov8n.pt'), (p) => reportProgress('Downloading YOLOv8 Model...', p));
    }

    // 4. Download Python Embeddable
    reportProgress('Downloading Python Engine...', 0);
    const pythonZip = path.join(userData, 'python.zip');
    await downloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip', pythonZip, (p) => reportProgress('Downloading Python Engine...', p));
    reportProgress('Extracting Python...', 1);
    await runCommand(`powershell -command "Expand-Archive -Force '${pythonZip}' '${pythonDir}'"`, userData);
    fs.unlinkSync(pythonZip);

    // Modify python311._pth to uncomment import site
    const pthFile = path.join(pythonDir, 'python311._pth');
    let pthContent = fs.readFileSync(pthFile, 'utf8');
    pthContent = pthContent.replace('#import site', 'import site');
    fs.writeFileSync(pthFile, pthContent);

    // Download get-pip.py
    reportProgress('Setting up Python Environment...', 0.2);
    await downloadFile('https://bootstrap.pypa.io/get-pip.py', path.join(pythonDir, 'get-pip.py'));
    
    // Install pip
    reportProgress('Installing PIP...', 0.4);
    await runCommand(`.\\python.exe get-pip.py`, pythonDir);

    // Install InsightFace, ONNXRuntime, OpenCV, and dependencies
    reportProgress('Installing AI Redaction Engine (InsightFace)...', 0.5);
    await runCommand(`.\\python.exe -m pip install "numpy<2" insightface onnxruntime opencv-python pillow ultralytics`, pythonDir);

    // Install python script for inference
    reportProgress('Finalizing...', 0.9);
    const scriptSource = app.isPackaged ? path.join(process.resourcesPath, 'insightface_redact.py') : path.join(__dirname, 'insightface_redact.py');
    const yoloScriptSource = app.isPackaged ? path.join(process.resourcesPath, 'yolo_redact.py') : path.join(__dirname, 'yolo_redact.py');
    const faceXmlSource = app.isPackaged ? path.join(process.resourcesPath, 'haarcascade_frontalface_default.xml') : path.join(__dirname, 'haarcascade_frontalface_default.xml');
    const plateXmlSource = app.isPackaged ? path.join(process.resourcesPath, 'haarcascade_russian_plate_number.xml') : path.join(__dirname, 'haarcascade_russian_plate_number.xml');

    if (fs.existsSync(scriptSource)) {
        fs.copyFileSync(scriptSource, path.join(yoloDir, 'insightface_redact.py'));
    }
    if (fs.existsSync(yoloScriptSource)) {
        fs.copyFileSync(yoloScriptSource, path.join(yoloDir, 'yolo_redact.py'));
    }
    if (fs.existsSync(faceXmlSource)) {
        fs.copyFileSync(faceXmlSource, path.join(yoloDir, 'haarcascade_frontalface_default.xml'));
    }
    if (fs.existsSync(plateXmlSource)) {
        fs.copyFileSync(plateXmlSource, path.join(yoloDir, 'haarcascade_russian_plate_number.xml'));
    }

    reportProgress('Setup Complete!', 1);
    return { success: true };
  } catch (err) {
    console.error(err);
    return { error: err.message };
  }
}

module.exports = { performWindowsSetup };

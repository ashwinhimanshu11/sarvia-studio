# Sarvia
application to perform multiple file operations

## Running locally on Linux

Install JavaScript dependencies with `npm install`, then launch with `npm start`.

For AI redaction, create the environment at the path expected by the app:

```bash
uv venv --python 3.11 yolo_venv
uv pip install --python yolo_venv/bin/python -r requirements-linux.txt --torch-backend cpu
```

`requirements-linux.txt` resolves Python 3.11 compatible dependencies; the original
`requirements.txt` snapshot contains conflicting NumPy requirements.

Place Linux `ffmpeg` and `ffprobe` executables in `bin/linux`. FFmpeg must include
the `libx264` encoder (some distribution builds omit it). This workspace uses the
BtbN Linux GPL build. ExifTool's bundled Perl implementation can be reused:

```bash
mkdir -p bin/linux
ln -s ../mac/exiftool bin/linux/exiftool
ln -s ../mac/lib bin/linux/lib
```

InsightFace uses models in `~/.insightface/models` and downloads them on first use
if missing. YOLO uses the project's `yolov8n.pt`. The local environment and binaries
are excluded by `.gitignore`.

01-04-26: functionality given to left sidebar

01-04-26: made changes to middle section and right sidebar

01-04-26: made ux and ui improvements for better file handling

02-04-26: changed the functionality for exiftool meta, added grid layout, added a preview window for exiftool meta

23-06-26: added file conversion window, added file conversion features, added progress bars, fixed bugs

26-05-26: made the application modular

05-08-26: added video editor, fix image editor UI, add cropper rotation and straighten features

07-08-26: perfected redaction features, changed GUI elements

11-08-26: implemented video edit features

12-08-26: implemented video blur

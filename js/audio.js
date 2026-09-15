import { escapeHtml, formatSize, promptBulkSaveOptions } from "./utils.js";
import { handleVerticalNavigation, makeKeyboardAction } from "./keyboard.js";

export const audioExtensions = [
  "aac", "aif", "aiff", "alac", "amr", "flac", "m4a",
  "mp3", "oga", "ogg", "opus", "wav", "wma",
];

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
let waveformPeaks = [];
let waveformRequestId = 0;
let progressAnimationFrame = null;
let previousVolume = 1;
let currentAudioPath = null;
let currentAudioName = "";
let currentAudioExtension = "";
let trimPreviewActive = false;
let trimModeEnabled = false;
let transcriptionModeEnabled = false;
let waveformDragMode = null;
let waveformPointerId = null;

export function initAudioOperations() {
  document.getElementById("audio-folder-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.value.trim()) {
      loadAudioFolder(event.target.value.trim());
    }
  });
  document.getElementById("audio-back-btn").addEventListener("click", resetAudioPreview);
  setupAudioPlayer();
}

function setupAudioPlayer() {
  const player = document.getElementById("audio-preview-player");
  const waveform = document.getElementById("audio-waveform");

  document.getElementById("audio-play-btn").addEventListener("click", () => {
    trimPreviewActive = false;
    togglePlayback(player);
  });
  document.getElementById("audio-rewind-btn").addEventListener("click", () => {
    trimPreviewActive = false;
    seekAudio(player, player.currentTime - 10);
  });
  document.getElementById("audio-forward-btn").addEventListener("click", () => {
    trimPreviewActive = false;
    seekAudio(player, player.currentTime + 10);
  });
  document.getElementById("audio-volume-btn").addEventListener("click", () => {
    if (player.muted || player.volume === 0) {
      player.muted = false;
      player.volume = previousVolume || 1;
    } else {
      previousVolume = player.volume;
      player.muted = true;
    }
  });
  document.getElementById("audio-speed-btn").addEventListener("click", () => {
    const currentIndex = playbackRates.indexOf(player.playbackRate);
    player.playbackRate = playbackRates[(currentIndex + 1) % playbackRates.length];
  });

  waveform.addEventListener("pointerdown", (event) => {
    if (!Number.isFinite(player.duration) || !player.duration) return;
    event.preventDefault();
    const bounds = waveform.getBoundingClientRect();
    if (!bounds.width) return;
    const pointerX = event.clientX - bounds.left;
    const selection = trimModeEnabled ? getTrimSelection(player) : null;
    const startX = selection ? (selection.start / player.duration) * bounds.width : -100;
    const endX = selection ? (selection.end / player.duration) * bounds.width : -100;
    const handleTolerance = 14;
    const startDistance = Math.abs(pointerX - startX);
    const endDistance = Math.abs(pointerX - endX);

    if (startDistance <= handleTolerance && startDistance <= endDistance) {
      waveformDragMode = "trim-start";
    } else if (endDistance <= handleTolerance) {
      waveformDragMode = "trim-end";
    } else {
      waveformDragMode = "seek";
    }

    waveformPointerId = event.pointerId;
    waveform.setPointerCapture(event.pointerId);
    updateWaveformDrag(event, player);
  });
  waveform.addEventListener("pointermove", (event) => {
    if (waveformDragMode && event.pointerId === waveformPointerId) {
      event.preventDefault();
      updateWaveformDrag(event, player);
      return;
    }
    updateWaveformCursor(event, player);
  });
  const finishWaveformDrag = (event) => {
    if (event.pointerId !== waveformPointerId) return;
    const completedMode = waveformDragMode;
    if (waveform.hasPointerCapture(event.pointerId)) {
      waveform.releasePointerCapture(event.pointerId);
    }
    waveformDragMode = null;
    waveformPointerId = null;
    waveform.style.cursor = "pointer";
    if (completedMode === "trim-start" || completedMode === "trim-end") {
      commitTrimSelection(player);
      const selection = getTrimSelection(player);
      if (selection) {
        const boundary = completedMode === "trim-start" ? selection.start : selection.end;
        setPlayerStatus(`${completedMode === "trim-start" ? "Start" : "End"} marker set to ${formatDetailedTime(boundary)}.`);
      }
    }
  };
  waveform.addEventListener("pointerup", finishWaveformDrag);
  waveform.addEventListener("pointercancel", finishWaveformDrag);
  waveform.addEventListener("pointerleave", () => {
    if (!waveformDragMode) waveform.style.cursor = "pointer";
  });
  waveform.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      seekAudio(player, player.currentTime - 5);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      seekAudio(player, player.currentTime + 5);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekAudio(player, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekAudio(player, player.duration);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      togglePlayback(player);
    }
  });

  player.addEventListener("loadedmetadata", () => updatePlayerProgress(player));
  player.addEventListener("durationchange", () => updatePlayerProgress(player));
  player.addEventListener("loadedmetadata", () => resetTrimSelection(player));
  player.addEventListener("timeupdate", () => {
    if (trimPreviewActive) {
      const selection = getTrimSelection(player);
      if (selection && player.currentTime >= selection.end - 0.025) {
        trimPreviewActive = false;
        player.pause();
        player.currentTime = selection.end;
        setPlayerStatus("Trim selection preview complete.");
      }
    }
    updatePlayerProgress(player);
  });
  player.addEventListener("play", () => {
    syncPlayButton(player);
    startProgressAnimation(player);
  });
  player.addEventListener("pause", () => {
    syncPlayButton(player);
    stopProgressAnimation();
    updatePlayerProgress(player);
  });
  player.addEventListener("ended", () => {
    syncPlayButton(player);
    stopProgressAnimation();
    updatePlayerProgress(player);
  });
  player.addEventListener("ratechange", () => {
    document.getElementById("audio-speed-label").textContent =
      `${player.playbackRate.toFixed(2).replace(/\.00$/, "").replace(/0$/, "")}×`;
  });
  player.addEventListener("volumechange", () => syncVolumeButton(player));
  player.addEventListener("error", () => {
    setPlayerStatus("This audio format could not be played by the built-in player.", true);
    syncPlayButton(player);
  });

  new ResizeObserver(() => drawWaveform(player)).observe(waveform);
  setupTrimControls(player);
  setupTranscriptionControls(player);
  syncPlayButton(player);
  syncVolumeButton(player);
}

function getPointerTime(event, player) {
  const waveform = document.getElementById("audio-waveform");
  const bounds = waveform.getBoundingClientRect();
  if (!bounds.width || !Number.isFinite(player.duration)) return 0;
  const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  return fraction * player.duration;
}

function updateWaveformDrag(event, player) {
  const pointerTime = getPointerTime(event, player);
  trimPreviewActive = false;
  if (waveformDragMode === "seek") {
    seekAudio(player, pointerTime);
    return;
  }

  const selection = getTrimSelection(player);
  if (!selection) return;
  if (waveformDragMode === "trim-start") {
    const nextStart = Math.max(0, Math.min(selection.end - 0.01, pointerTime));
    document.getElementById("audio-trim-start").value = nextStart.toFixed(2);
  } else if (waveformDragMode === "trim-end") {
    const nextEnd = Math.min(player.duration, Math.max(selection.start + 0.01, pointerTime));
    document.getElementById("audio-trim-end").value = nextEnd.toFixed(2);
  }
  syncTrimSelection(player);
}

function updateWaveformCursor(event, player) {
  const waveform = document.getElementById("audio-waveform");
  const bounds = waveform.getBoundingClientRect();
  const selection = trimModeEnabled ? getTrimSelection(player) : null;
  if (!bounds.width || !selection || !Number.isFinite(player.duration)) {
    waveform.style.cursor = "pointer";
    return;
  }
  const pointerX = event.clientX - bounds.left;
  const startX = (selection.start / player.duration) * bounds.width;
  const endX = (selection.end / player.duration) * bounds.width;
  waveform.style.cursor =
    Math.abs(pointerX - startX) <= 14 || Math.abs(pointerX - endX) <= 14
      ? "ew-resize"
      : "pointer";
}

export async function loadAudioFolder(path) {
  document.getElementById("audio-folder-input").value = path;
  resetAudioPreview();
  await renderAudioDirectory(path, document.getElementById("audio-file-tree"));
}

function resetAudioPreview() {
  const player = document.getElementById("audio-preview-player");
  waveformRequestId += 1;
  waveformPeaks = [];
  currentAudioPath = null;
  currentAudioName = "";
  currentAudioExtension = "";
  trimPreviewActive = false;
  setTrimMode(false, player);
  setTranscriptionMode(false, player);
  clearTranscript();
  stopProgressAnimation();
  player.pause();
  player.removeAttribute("src");
  player.load();
  document.getElementById("audio-preview-container").style.display = "none";
  document.getElementById("audio-empty-state").style.display = "flex";
  updatePlayerProgress(player);
}

function setupTrimControls(player) {
  const startInput = document.getElementById("audio-trim-start");
  const endInput = document.getElementById("audio-trim-end");
  const sync = () => syncTrimSelection(player);
  const commit = () => commitTrimSelection(player);

  document.getElementById("audio-trim-toggle-btn").addEventListener("click", () => {
    setTrimMode(!trimModeEnabled, player);
  });

  startInput.addEventListener("input", sync);
  endInput.addEventListener("input", sync);
  startInput.addEventListener("change", commit);
  endInput.addEventListener("change", commit);
  document.getElementById("audio-set-start-btn").addEventListener("click", () => {
    startInput.value = player.currentTime.toFixed(2);
    commitTrimSelection(player);
  });
  document.getElementById("audio-set-end-btn").addEventListener("click", () => {
    endInput.value = player.currentTime.toFixed(2);
    commitTrimSelection(player);
  });
  document.getElementById("audio-trim-reset-btn").addEventListener("click", () => {
    resetTrimSelection(player);
    setPlayerStatus("Trim selection reset to the full audio file.");
  });
  document.getElementById("audio-preview-trim-btn").addEventListener("click", async () => {
    const selection = getTrimSelection(player);
    if (!selection) return;
    player.currentTime = selection.start;
    trimPreviewActive = true;
    setPlayerStatus("Previewing the selected trim range...");
    try {
      await player.play();
    } catch (error) {
      trimPreviewActive = false;
      setPlayerStatus("Unable to preview this trim selection.", true);
    }
  });
  document.getElementById("audio-save-trim-btn").addEventListener("click", () => saveTrimSelection(player));
  syncTrimSelection(player);
}

function setTrimMode(enabled, player) {
  if (enabled) setTranscriptionMode(false, player);
  const wasPreviewingSelection = trimPreviewActive;
  trimModeEnabled = Boolean(enabled && currentAudioPath);
  trimPreviewActive = false;
  const panel = document.querySelector(".audio-trim-panel");
  const button = document.getElementById("audio-trim-toggle-btn");
  panel.classList.toggle("active", trimModeEnabled);
  button.classList.toggle("active", trimModeEnabled);
  button.setAttribute("aria-pressed", String(trimModeEnabled));
  document.getElementById("audio-trim-toggle-label").textContent =
    trimModeEnabled ? "Close trimming" : "Trim audio";
  if (!trimModeEnabled && wasPreviewingSelection) player.pause();
  if (currentAudioPath && waveformPeaks.length) {
    setPlayerStatus(
      trimModeEnabled
        ? "Drag the start and end handles to choose the trim range"
        : "Drag across the waveform to scrub playback",
    );
  }
  drawWaveform(player);
}

function setupTranscriptionControls(player) {
  document.getElementById("audio-transcribe-toggle-btn").addEventListener("click", () => {
    setTranscriptionMode(!transcriptionModeEnabled, player);
  });
  document.getElementById("audio-clear-keys-btn").addEventListener("click", () => {
    document.getElementById("audio-udyat-key").value = "";
    document.getElementById("audio-inference-key").value = "";
    setTranscriptionStatus("Keys cleared from this session.");
  });
  document.getElementById("audio-transcribe-btn").addEventListener("click", transcribeCurrentAudio);
  document.getElementById("audio-copy-transcript-btn").addEventListener("click", async () => {
    const transcript = document.getElementById("audio-transcript-text").value;
    if (!transcript) return;
    await window.electronAPI.copyText(transcript);
    setTranscriptionStatus("Transcript copied to clipboard.");
  });
  document.getElementById("audio-save-transcript-btn").addEventListener("click", saveCurrentTranscript);
}

function setTranscriptionMode(enabled, player) {
  if (enabled) setTrimMode(false, player);
  transcriptionModeEnabled = Boolean(enabled && currentAudioPath);
  const panel = document.querySelector(".audio-transcription-panel");
  const button = document.getElementById("audio-transcribe-toggle-btn");
  panel.classList.toggle("active", transcriptionModeEnabled);
  button.classList.toggle("active", transcriptionModeEnabled);
  button.setAttribute("aria-pressed", String(transcriptionModeEnabled));
  document.getElementById("audio-transcribe-toggle-label").textContent =
    transcriptionModeEnabled ? "Close transcription" : "Transcribe";
}

function clearTranscript() {
  document.getElementById("audio-transcript-text").value = "";
  document.getElementById("audio-transcript-result").classList.remove("active");
  setTranscriptionStatus("");
}

function setTranscriptionStatus(message, isError = false) {
  const status = document.getElementById("audio-transcription-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function transcribeCurrentAudio() {
  if (!currentAudioPath) return;
  const udyatKey = document.getElementById("audio-udyat-key").value.trim();
  const inferenceKey = document.getElementById("audio-inference-key").value.trim();
  const languageCode = document.getElementById("audio-transcription-language").value;
  if (!udyatKey || !inferenceKey) {
    setTranscriptionStatus("Enter both your Udyat key and inference key.", true);
    return;
  }

  const requestedPath = currentAudioPath;
  const button = document.getElementById("audio-transcribe-btn");
  button.disabled = true;
  document.getElementById("audio-transcript-result").classList.remove("active");
  setTranscriptionStatus("Preparing audio and sending it to BHASHINI…");
  
  let result;
  try {
    result = await window.electronAPI.transcribeAudio({
      filePath: requestedPath,
      languageCode,
      udyatKey,
      inferenceKey,
      includeTimestamps: document.getElementById("audio-include-timestamps").checked,
    });
  } finally {
    window.hideProgress?.();
    button.disabled = false;
  }

  if (requestedPath !== currentAudioPath) return;
  if (result.error) {
    setTranscriptionStatus(result.error, true);
    return;
  }

  document.getElementById("audio-transcript-text").value = result.transcript;
  document.getElementById("audio-transcript-result").classList.add("active");
  setTranscriptionStatus("Transcription complete.");
}

async function saveCurrentTranscript() {
  const transcript = document.getElementById("audio-transcript-text").value;
  if (!transcript || !currentAudioPath) return;
  const result = await window.electronAPI.saveTranscript({
    sourcePath: currentAudioPath,
    transcript,
  });
  if (result.error) {
    setTranscriptionStatus(result.error, true);
  } else if (!result.cancelled) {
    setTranscriptionStatus(`Transcript saved as ${result.outputPath.split(/[/\\]/).pop()}.`);
  }
}

function resetTrimSelection(player) {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  document.getElementById("audio-trim-start").value = "0.00";
  document.getElementById("audio-trim-end").value = duration.toFixed(2);
  trimPreviewActive = false;
  syncTrimSelection(player);
}

function commitTrimSelection(player) {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  if (!duration) return syncTrimSelection(player);
  let start = Number.parseFloat(document.getElementById("audio-trim-start").value);
  let end = Number.parseFloat(document.getElementById("audio-trim-end").value);
  start = Math.max(0, Math.min(duration, Number.isFinite(start) ? start : 0));
  end = Math.max(0, Math.min(duration, Number.isFinite(end) ? end : duration));
  if (end <= start) {
    if (start >= duration) start = Math.max(0, duration - 0.01);
    end = Math.min(duration, start + 0.01);
  }
  document.getElementById("audio-trim-start").value = start.toFixed(2);
  document.getElementById("audio-trim-end").value = end.toFixed(2);
  syncTrimSelection(player);
}

function getTrimSelection(player) {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const start = Number.parseFloat(document.getElementById("audio-trim-start").value);
  const end = Number.parseFloat(document.getElementById("audio-trim-end").value);
  if (!duration || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end > duration + 0.05 || end - start < 0.01) return null;
  return { start, end, duration: end - start };
}

function syncTrimSelection(player) {
  const selection = getTrimSelection(player);
  const durationLabel = document.getElementById("audio-trim-duration");
  const previewButton = document.getElementById("audio-preview-trim-btn");
  const saveButton = document.getElementById("audio-save-trim-btn");
  durationLabel.textContent = selection ? formatTime(selection.duration) : "Invalid";
  durationLabel.classList.toggle("error", !selection);
  previewButton.disabled = !selection || !currentAudioPath;
  saveButton.disabled = !selection || !currentAudioPath;
  drawWaveform(player);
}

async function saveTrimSelection(player) {
  const selection = getTrimSelection(player);
  if (!selection || !currentAudioPath) return;
  const saveOption = await promptBulkSaveOptions({
    title: "Save Trimmed Audio",
    description: "Choose how you want to save the selected audio range:",
    allowReplace: true,
    newLabel: "Save as New Audio...",
    newDesc: "Choose a destination folder for the trimmed audio file",
  });
  if (saveOption.choice === "cancel") return;

  trimPreviewActive = false;
  player.pause();
  const replacingOriginal = saveOption.choice === "replace";
  const sourceEntry = {
    path: currentAudioPath,
    name: currentAudioName,
    extension: currentAudioExtension,
  };
  if (replacingOriginal) {
    player.removeAttribute("src");
    player.load();
  }
  const saveButton = document.getElementById("audio-save-trim-btn");
  saveButton.disabled = true;
  setPlayerStatus("Trimming audio...");
  window.showProgress?.("Trimming Audio");
  const result = await window.electronAPI.trimAudio({
    filePath: currentAudioPath,
    trimStart: selection.start,
    trimEnd: selection.end,
    saveMode: saveOption.choice,
    outputDir: saveOption.outputDir,
  });
  window.hideProgress?.();

  if (result.error) {
    if (replacingOriginal) await loadAudioPreview(sourceEntry);
    setPlayerStatus(`Trim failed: ${result.error}`, true);
    syncTrimSelection(player);
    return;
  }

  const savedName = result.outputPath.split(/[/\\]/).pop();
  if (replacingOriginal) {
    await loadAudioPreview({
      path: result.outputPath,
      name: sourceEntry.name,
      extension: sourceEntry.extension,
    });
  } else {
    syncTrimSelection(player);
  }
  setPlayerStatus(`Trimmed audio saved as ${savedName}.`);
}

async function loadWaveform(filePath, requestId) {
  setPlayerStatus("Building waveform...");
  const result = await window.electronAPI.readAudioBuffer(filePath);
  if (requestId !== waveformRequestId) return;
  if (result.error) {
    waveformPeaks = [];
    setPlayerStatus(result.error, true);
    drawWaveform(document.getElementById("audio-preview-player"));
    return;
  }

  let arrayBuffer;
  if (result.data instanceof ArrayBuffer) {
    arrayBuffer = result.data;
  } else if (ArrayBuffer.isView(result.data)) {
    arrayBuffer = result.data.buffer.slice(
      result.data.byteOffset,
      result.data.byteOffset + result.data.byteLength,
    );
  } else if (result.data?.data) {
    arrayBuffer = new Uint8Array(result.data.data).buffer;
  }
  if (!arrayBuffer) {
    setPlayerStatus("Waveform data could not be read.", true);
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    setPlayerStatus("Waveform rendering is not supported on this system.", true);
    return;
  }

  const audioContext = new AudioContextClass();
  try {
    const decodedAudio = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    if (requestId !== waveformRequestId) return;
    waveformPeaks = createWaveformPeaks(decodedAudio, 1200);
    setPlayerStatus(
      trimModeEnabled
        ? "Drag the start and end handles to choose the trim range"
        : "Drag across the waveform to scrub playback",
    );
    drawWaveform(document.getElementById("audio-preview-player"));
  } catch (error) {
    if (requestId === waveformRequestId) {
      waveformPeaks = [];
      setPlayerStatus("Playback is available, but a waveform could not be generated.", true);
      drawWaveform(document.getElementById("audio-preview-player"));
    }
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function createWaveformPeaks(audioBuffer, targetLength) {
  const peakCount = Math.min(targetLength, audioBuffer.length);
  if (!peakCount) return [];
  const segmentLength = audioBuffer.length / peakCount;
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );
  const peaks = new Array(peakCount).fill(0);

  for (let index = 0; index < peakCount; index += 1) {
    const start = Math.floor(index * segmentLength);
    const end = Math.min(audioBuffer.length, Math.floor((index + 1) * segmentLength));
    const stride = Math.max(1, Math.floor((end - start) / 80));
    let peak = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample += stride) {
        peak = Math.max(peak, Math.abs(channel[sample]));
      }
    }
    peaks[index] = peak;
  }

  const maximum = Math.max(...peaks, 0.01);
  return peaks.map((peak) => peak / maximum);
}

function drawWaveform(player) {
  const canvas = document.getElementById("audio-waveform");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  context.scale(pixelRatio, pixelRatio);
  context.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const mutedColor = styles.getPropertyValue("--text-muted").trim() || "#64748b";
  const accentColor = styles.getPropertyValue("--gts-teal").trim() || "#1d6487";
  const playheadColor = styles.getPropertyValue("--gts-purple").trim() || "#8b447a";
  if (!waveformPeaks.length) {
    context.globalAlpha = 0.35;
    context.fillStyle = mutedColor;
    context.fillRect(16, height / 2 - 1, Math.max(0, width - 32), 2);
    context.globalAlpha = 1;
    return;
  }

  const gap = 2;
  const barWidth = 2;
  const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
  const progress = Number.isFinite(player.duration) && player.duration > 0
    ? player.currentTime / player.duration
    : 0;
  const playedGradient = context.createLinearGradient(0, 0, width, 0);
  playedGradient.addColorStop(0, playheadColor);
  playedGradient.addColorStop(1, accentColor);

  for (let index = 0; index < barCount; index += 1) {
    const peakIndex = Math.min(
      waveformPeaks.length - 1,
      Math.floor((index / barCount) * waveformPeaks.length),
    );
    const amplitude = Math.max(0.035, waveformPeaks[peakIndex]);
    const barHeight = Math.max(4, amplitude * (height - 24));
    const x = index * (barWidth + gap);
    context.globalAlpha = index / barCount <= progress ? 1 : 0.55;
    context.fillStyle = index / barCount <= progress ? playedGradient : mutedColor;
    context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
  }

  const trimSelection = trimModeEnabled ? getTrimSelection(player) : null;
  if (trimSelection) {
    const selectionStart = (trimSelection.start / player.duration) * width;
    const selectionEnd = (trimSelection.end / player.duration) * width;
    context.globalAlpha = 1;
    context.fillStyle = document.body.dataset.theme === "dark"
      ? "rgba(0, 0, 0, 0.46)"
      : "rgba(100, 116, 139, 0.2)";
    context.fillRect(0, 0, selectionStart, height);
    context.fillRect(selectionEnd, 0, width - selectionEnd, height);
    drawTrimHandle(context, selectionStart, height, accentColor);
    drawTrimHandle(context, selectionEnd, height, accentColor);
  }

  if (progress > 0) {
    context.globalAlpha = 0.9;
    context.fillStyle = playheadColor;
    context.fillRect(Math.min(width - 2, progress * width), 8, 2, height - 16);
  }
  context.globalAlpha = 1;
}

function drawTrimHandle(context, requestedX, height, color) {
  const x = Math.max(3, Math.min(context.canvas.clientWidth - 3, requestedX));
  context.globalAlpha = 1;
  context.fillStyle = color;
  context.fillRect(x - 1.5, 4, 3, height - 8);
  context.beginPath();
  context.arc(x, 11, 6, 0, Math.PI * 2);
  context.arc(x, height - 11, 6, 0, Math.PI * 2);
  context.fill();
}

function togglePlayback(player) {
  if (!player.src) return;
  if (player.paused) {
    player.play().catch(() => setPlayerStatus("Unable to start playback for this file.", true));
  } else {
    player.pause();
  }
}

function seekAudio(player, requestedTime) {
  if (!Number.isFinite(player.duration)) return;
  player.currentTime = Math.max(0, Math.min(player.duration, requestedTime));
  updatePlayerProgress(player);
}

function updatePlayerProgress(player) {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  document.getElementById("audio-current-time").textContent = formatTime(currentTime);
  document.getElementById("audio-duration").textContent = formatTime(duration);
  const waveform = document.getElementById("audio-waveform");
  waveform.setAttribute("aria-valuemax", String(Math.round(duration)));
  waveform.setAttribute("aria-valuenow", String(Math.round(currentTime)));
  waveform.setAttribute("aria-valuetext", `${formatTime(currentTime)} of ${formatTime(duration)}`);
  drawWaveform(player);
}

function syncPlayButton(player) {
  const isPlaying = !player.paused && !player.ended;
  const button = document.getElementById("audio-play-btn");
  document.getElementById("audio-play-icon").textContent = isPlaying ? "pause" : "play_arrow";
  button.title = isPlaying ? "Pause" : "Play";
  button.setAttribute("aria-label", button.title);
}

function syncVolumeButton(player) {
  const muted = player.muted || player.volume === 0;
  const button = document.getElementById("audio-volume-btn");
  document.getElementById("audio-volume-icon").textContent = muted ? "volume_off" : "volume_up";
  button.title = muted ? "Unmute" : "Mute";
  button.setAttribute("aria-label", button.title);
}

function startProgressAnimation(player) {
  stopProgressAnimation();
  const update = () => {
    updatePlayerProgress(player);
    if (!player.paused && !player.ended) progressAnimationFrame = requestAnimationFrame(update);
  };
  progressAnimationFrame = requestAnimationFrame(update);
}

function stopProgressAnimation() {
  if (progressAnimationFrame !== null) {
    cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = null;
  }
}

function setPlayerStatus(message, isError = false) {
  const status = document.getElementById("audio-player-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatDetailedTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${String(wholeMinutes).padStart(2, "0")}:${remainingSeconds}`;
}

async function loadAudioPreview(entry) {
  const requestId = ++waveformRequestId;
  waveformPeaks = [];
  trimPreviewActive = false;
  stopProgressAnimation();
  const [details, fileUrl] = await Promise.all([
    window.electronAPI.getFileDetails(entry.path),
    window.electronAPI.getFileUrl(entry.path),
  ]);
  if (requestId !== waveformRequestId) return;

  currentAudioPath = entry.path;
  currentAudioName = entry.name;
  currentAudioExtension = entry.extension;
  const player = document.getElementById("audio-preview-player");
  setTrimMode(false, player);
  setTranscriptionMode(false, player);
  clearTranscript();
  player.pause();
  document.getElementById("audio-preview-name").textContent = entry.name;
  document.getElementById("audio-preview-details").textContent = details.error
    ? entry.extension.toUpperCase()
    : `${entry.extension.toUpperCase()} · ${formatSize(details.size)}`;
  document.getElementById("audio-empty-state").style.display = "none";
  document.getElementById("audio-preview-container").style.display = "flex";
  updatePlayerProgress(player);

  if (fileUrl.error) {
    player.removeAttribute("src");
    player.load();
    setPlayerStatus(fileUrl.error, true);
    syncTrimSelection(player);
  } else {
    player.src = fileUrl.url;
    player.setAttribute("aria-label", `Preview ${entry.name}`);
    player.load();
    loadWaveform(entry.path, requestId);
  }
}

async function renderAudioDirectory(path, container) {
  container.innerHTML = '<div class="tree-item" style="color: var(--text-muted); padding-left: 25px;">Loading...</div>';
  const entries = await window.electronAPI.readDirectory(path);
  if (entries.error) {
    container.innerHTML = `<div class="tree-item" style="color: #f48771; padding-left: 10px;">Error: ${escapeHtml(entries.error)}</div>`;
    return;
  }
  const filteredEntries = entries.filter(
    (entry) => entry.isDirectory || audioExtensions.includes(entry.extension.toLowerCase()),
  );
  container.innerHTML = "";
  if (filteredEntries.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="material-symbols-rounded">audio_file</span>No audio files found.</div>';
    return;
  }

  filteredEntries.forEach((entry) => {
    const node = document.createElement("div");
    node.className = "tree-node";
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDirectory ? "folder" : "file"}`;
    const content = document.createElement("div");
    content.className = "item-content";
    content.style.display = "flex";
    content.style.alignItems = "center";
    content.style.flex = "1";
    content.style.minWidth = "0";
    content.innerHTML = `${entry.isDirectory
      ? '<span class="material-symbols-rounded folder-toggle">chevron_right</span>'
      : '<span class="folder-toggle empty"></span>'
    }<span class="material-symbols-rounded icon">${entry.isDirectory ? "folder" : "audio_file"}</span><span class="name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>`;
    item.appendChild(content);
    node.appendChild(item);

    if (entry.isDirectory) {
      const children = document.createElement("div");
      children.className = "children-container";
      node.appendChild(children);
      let isLoaded = false;
      const syncExpandedState = () => content.setAttribute(
        "aria-expanded",
        item.classList.contains("open") ? "true" : "false",
      );
      const toggleDirectory = async (forceOpen = null) => {
        const shouldOpen = forceOpen === null ? !item.classList.contains("open") : forceOpen;
        item.classList.toggle("open", shouldOpen);
        children.classList.toggle("open", shouldOpen);
        if (shouldOpen && !isLoaded) {
          await renderAudioDirectory(entry.path, children);
          isLoaded = true;
        }
        syncExpandedState();
      };
      content.setAttribute("aria-label", `Open ${entry.name}`);
      makeKeyboardAction(content, () => toggleDirectory());
      content.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          toggleDirectory(true);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          toggleDirectory(false);
        } else {
          handleVerticalNavigation(event, content, "#audio-file-tree .item-content");
        }
      });
      content.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        toggleDirectory();
      });
      syncExpandedState();
    } else {
      const selectAudio = async (event = {}) => {
        event.stopPropagation?.();
        document.querySelectorAll("#audio-file-tree .tree-item.selected")
          .forEach((selected) => selected.classList.remove("selected"));
        item.classList.add("selected");
        await loadAudioPreview(entry);
      };
      content.setAttribute("aria-label", `Preview ${entry.name}`);
      makeKeyboardAction(content, selectAudio);
      content.addEventListener("keydown", (event) =>
        handleVerticalNavigation(event, content, "#audio-file-tree .item-content"),
      );
      content.addEventListener("mousedown", (event) => {
        if (event.button === 0) selectAudio(event);
      });
    }
    container.appendChild(node);
  });
}

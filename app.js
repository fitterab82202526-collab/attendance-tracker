const storageKey = "trainee-attendance-v1";
const todayKey = getLocalDateKey(new Date());

const els = {
  video: document.querySelector("#camera"),
  overlay: document.querySelector("#overlay"),
  empty: document.querySelector("#cameraEmpty"),
  start: document.querySelector("#startCamera"),
  recognize: document.querySelector("#recognizeFace"),
  capture: document.querySelector("#captureFace"),
  save: document.querySelector("#saveTrainee"),
  name: document.querySelector("#traineeName"),
  traineeId: document.querySelector("#traineeId"),
  status: document.querySelector("#status"),
  rows: document.querySelector("#attendanceRows"),
  template: document.querySelector("#rowTemplate"),
  total: document.querySelector("#statTotal"),
  present: document.querySelector("#statPresent"),
  missing: document.querySelector("#statMissing"),
  date: document.querySelector("#attendanceDate"),
  dateLabel: document.querySelector("#dateLabel"),
  exportCsv: document.querySelector("#exportCsv"),
  clearDay: document.querySelector("#clearDay"),
};

let stream = null;
let capturedDescriptor = null;
let capturedPreview = null;
let detector = null;
let selectedDate = todayKey;

const state = loadState();

function loadState() {
  const fallback = { trainees: [], attendance: {} };
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || fallback;
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.style.color =
    tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--accent)" : "var(--muted)";
}

function todayAttendance() {
  if (!state.attendance[selectedDate]) state.attendance[selectedDate] = {};
  return state.attendance[selectedDate];
}

async function startCamera() {
  if (stream) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    els.empty.hidden = true;
    els.start.disabled = true;

    if ("FaceDetector" in window) {
      detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    }

    setStatus("Camera started. Keep one face centered and well lit.", "success");
    drawLoop();
  } catch (error) {
    setStatus("Camera permission was not granted, or no camera was found.", "danger");
  }
}

async function getFaceBox(source) {
  const width = source.videoWidth || source.width;
  const height = source.videoHeight || source.height;

  if (detector) {
    try {
      const faces = await detector.detect(source);
      if (faces.length) return faces[0].boundingBox;
    } catch {
      detector = null;
    }
  }

  const size = Math.min(width, height) * 0.54;
  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    width: size,
    height: size,
  };
}

async function captureDescriptor() {
  if (!stream || !els.video.videoWidth) {
    setStatus("Start the camera first.", "danger");
    return null;
  }

  const box = await getFaceBox(els.video);
  const sample = document.createElement("canvas");
  const size = 32;
  sample.width = size;
  sample.height = size;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    els.video,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    size,
    size
  );

  const image = ctx.getImageData(0, 0, size, size).data;
  const descriptor = [];
  let total = 0;

  for (let i = 0; i < image.length; i += 4) {
    const value = (image[i] * 0.299 + image[i + 1] * 0.587 + image[i + 2] * 0.114) / 255;
    descriptor.push(value);
    total += value;
  }

  const mean = total / descriptor.length;
  const normalized = descriptor.map((value) => Number((value - mean).toFixed(4)));

  return {
    descriptor: normalized,
    preview: sample.toDataURL("image/jpeg", 0.78),
    box,
  };
}

function distance(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum / a.length);
}

function markPresent(trainee, score) {
  todayAttendance()[trainee.id] = {
    status: "present",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    score: Number(score.toFixed(4)),
  };
  saveState();
  render();
}

async function recognizeFace() {
  if (!state.trainees.length) {
    setStatus("Add at least one trainee before recognizing faces.", "danger");
    return;
  }

  const capture = await captureDescriptor();
  if (!capture) return;

  const matches = state.trainees
    .map((trainee) => ({ trainee, score: distance(capture.descriptor, trainee.face) }))
    .sort((a, b) => a.score - b.score);

  const best = matches[0];
  const second = matches[1];
  const confident = best.score < 0.18 && (!second || second.score - best.score > 0.015);

  if (!confident) {
    setStatus("No confident match. Try brighter light and a straight-on face.", "danger");
    return;
  }

  markPresent(best.trainee, best.score);
  setStatus(`${best.trainee.name} marked present.`, "success");
}

async function captureForNewTrainee() {
  const capture = await captureDescriptor();
  if (!capture) return;

  capturedDescriptor = capture.descriptor;
  capturedPreview = capture.preview;
  setStatus("Face captured. Add the trainee details and save.", "success");
}

function saveTrainee() {
  const name = els.name.value.trim();
  const id = els.traineeId.value.trim();

  if (!name || !id) {
    setStatus("Enter both name and trainee ID.", "danger");
    return;
  }

  if (!capturedDescriptor) {
    setStatus("Capture a face before saving.", "danger");
    return;
  }

  if (state.trainees.some((trainee) => trainee.id.toLowerCase() === id.toLowerCase())) {
    setStatus("That trainee ID already exists.", "danger");
    return;
  }

  state.trainees.push({
    id,
    name,
    face: capturedDescriptor,
    photo: capturedPreview,
    createdAt: new Date().toISOString(),
  });

  capturedDescriptor = null;
  capturedPreview = null;
  els.name.value = "";
  els.traineeId.value = "";
  saveState();
  render();
  setStatus(`${name} added.`, "success");
}

function toggleManual(id) {
  const attendance = todayAttendance();
  if (attendance[id]?.status === "present") {
    delete attendance[id];
  } else {
    const trainee = state.trainees.find((item) => item.id === id);
    if (trainee) markPresent(trainee, 0);
  }
  saveState();
  render();
}

function exportCsv() {
  const rows = [["Date", "Name", "Trainee ID", "Status", "Time"]];
  const attendance = todayAttendance();

  state.trainees.forEach((trainee) => {
    const record = attendance[trainee.id];
    rows.push([
      selectedDate,
      trainee.name,
      trainee.id,
      record ? "Present" : "Pending",
      record?.time || "",
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${selectedDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearDay() {
  state.attendance[selectedDate] = {};
  saveState();
  render();
  setStatus("Selected day's attendance cleared.");
}

function changeDate() {
  selectedDate = els.date.value || todayKey;
  render();
}

function render() {
  const attendance = todayAttendance();
  const presentCount = state.trainees.filter((trainee) => attendance[trainee.id]).length;
  const isToday = selectedDate === todayKey;

  els.date.value = selectedDate;
  els.dateLabel.textContent = isToday ? "Today" : selectedDate;
  els.total.textContent = state.trainees.length;
  els.present.textContent = presentCount;
  els.missing.textContent = Math.max(state.trainees.length - presentCount, 0);
  els.rows.textContent = "";

  if (!state.trainees.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No trainees added yet.";
    row.append(cell);
    els.rows.append(row);
    return;
  }

  state.trainees
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((trainee) => {
      const row = els.template.content.firstElementChild.cloneNode(true);
      const cells = row.querySelectorAll("td");
      const record = attendance[trainee.id];
      const badge = document.createElement("span");
      badge.className = `badge ${record ? "present" : "pending"}`;
      badge.textContent = record ? "Present" : "Pending";

      cells[0].textContent = trainee.name;
      cells[1].textContent = trainee.id;
      cells[2].append(badge);
      cells[3].textContent = record?.time || "-";

      const action = cells[4].querySelector("button");
      action.textContent = record ? "Undo" : "Mark";
      action.addEventListener("click", () => toggleManual(trainee.id));

      els.rows.append(row);
    });
}

function drawLoop() {
  if (!stream) return;
  const canvas = els.overlay;
  const rect = els.video.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  const side = Math.min(canvas.width, canvas.height) * 0.54;
  ctx.strokeRect((canvas.width - side) / 2, (canvas.height - side) / 2, side, side);
  requestAnimationFrame(drawLoop);
}

els.start.addEventListener("click", startCamera);
els.capture.addEventListener("click", captureForNewTrainee);
els.recognize.addEventListener("click", recognizeFace);
els.save.addEventListener("click", saveTrainee);
els.exportCsv.addEventListener("click", exportCsv);
els.clearDay.addEventListener("click", clearDay);
els.date.addEventListener("change", changeDate);

render();

// app.js - full updated JS
// Mic-save fix + uncheckable radio toggle (keeps existing mic buttons & UI)

// DEV ONLY: unregister all service workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => {
      try { r.unregister(); } catch(e){}
    });
  });
}

/* ---------- DOM refs ---------- */
const container = document.getElementById("container");
const dayPicker = document.getElementById("dayPicker");
const prevDayBtn = document.getElementById("prevDay");
const nextDayBtn = document.getElementById("nextDay");
const todayBtn = document.getElementById("todayBtn");
const resetDayBtn = document.getElementById("resetDay");
const exportCsvBtn = document.getElementById("exportCsv");
const exportPdfBtn = document.getElementById("exportPdf");
const dateLabel = document.getElementById("dateLabel");
const clockEl = document.getElementById("clock");
const toastContainer = document.getElementById("toastContainer");
const themeSelect = document.getElementById("themeSelect");

const slotStartTimeInput = document.getElementById("slotStartTime");
const slotDurationValueInput = document.getElementById("slotDurationValue");
const slotDurationUnitSelect = document.getElementById("slotDurationUnit");
const applySlotSettingsBtn = document.getElementById("applySlotSettings");

const modalOverlay = document.getElementById("basicModalOverlay");
const modalMessageEl = document.getElementById("modalMessage");
const modalCloseBtn = document.getElementById("modalClose");

/* ---------- constants / keys ---------- */
const THEME_KEY = "hourly-tracker-theme";
const SLOT_SETTINGS_KEY = "hourly-slot-settings";

/* ---------- helpers ---------- */
function pad(n){ return String(n).padStart(2,"0"); }

function showToast(msg, dur=1400){
  if(!toastContainer) return;
  toastContainer.innerHTML = "";
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  toastContainer.appendChild(t);
  requestAnimationFrame(()=> t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),200); }, dur);
}

function showModal(message){
  if (!modalOverlay || !modalMessageEl) return;
  modalMessageEl.textContent = message;
  modalOverlay.classList.remove("hidden");
  modalOverlay.setAttribute("aria-hidden","false");
}
function hideModal(){
  if (!modalOverlay) return;
  modalOverlay.classList.add("hidden");
  modalOverlay.setAttribute("aria-hidden","true");
}
if (modalCloseBtn){
  modalCloseBtn.addEventListener("click", hideModal);
}
if (modalOverlay){
  modalOverlay.addEventListener("click", (e)=>{ if (e.target === modalOverlay) hideModal(); });
}

/* ---------- live clock ---------- */
function updateClock() {
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
updateClock();
setInterval(updateClock, 1000);

/* ---------- Speech to text ---------- */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let recognition = null;
let activeMicButton = null;
let activeTargetInput = null;
let baseText = "";

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-IN";

  recognition.onresult = (event) => {
    let interim = "";
    let finalTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalTranscript += res[0].transcript;
      else interim += res[0].transcript;
    }
    if (activeTargetInput) {
      // update the visible input field
      activeTargetInput.value = baseText + finalTranscript + interim;

      // IMPORTANT: dispatch an 'input' event so the existing listeners inside renderSlots
      // update the slot model, mark unsaved, and enable the Save button automatically.
      activeTargetInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Also mark stored flag false if slot ref present (defensive)
      if (activeTargetInput._slotRef) {
        activeTargetInput._slotRef.saved = false;
      }
    }
  };

  recognition.onerror = (ev) => {
    console.warn("Speech recognition error", ev);
    showToast("Voice input error");
    stopListening();
  };

  recognition.onend = () => {
    if (activeMicButton) activeMicButton.classList.remove("listening");
    activeMicButton = null;
    activeTargetInput = null;
    baseText = "";
  };
}

function startListening(micButton, targetInput){
  if (!recognition) {
    showToast("Voice input not supported in this browser");
    return;
  }
  if (activeMicButton && activeMicButton !== micButton) recognition.stop();
  if (micButton.classList.contains("listening")) { recognition.stop(); return; }
  activeMicButton = micButton;
  activeTargetInput = targetInput;
  baseText = targetInput.value || "";
  micButton.classList.add("listening");
  try { recognition.start(); } catch (e) { console.warn("recognition.start() error", e); }
}
function stopListening(){ if (!recognition) return; try { recognition.stop(); } catch(e){} }

/* ---------- date helpers ---------- */
function formatDateKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function formatReadableDate(d){ return d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"2-digit"}); }
function storageKeyForDate(d){ return `hourly-${formatDateKey(d)}`; }
function getDateOnly(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/* ---------- slot settings ---------- */
function parseTimeToMinutes(timeStr){
  if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return 0;
  const [h,m] = timeStr.split(":").map(Number);
  return (h*60 + m) % 1440;
}
function minutesToHHMM(minutes){
  minutes = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(minutes/60);
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}`;
}

function getSlotSettings(){
  const defaults = { startTime: "06:00", durationMinutes: 60 };
  try {
    const raw = localStorage.getItem(SLOT_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed.startTime || !parsed.durationMinutes) return defaults;
    return {
      startTime: parsed.startTime,
      durationMinutes: Math.max(1, Number(parsed.durationMinutes) || 60)
    };
  } catch(e){ console.error(e); return defaults; }
}
function saveSlotSettings(settings){ try{ localStorage.setItem(SLOT_SETTINGS_KEY, JSON.stringify(settings)); }catch(e){ console.error(e); } }
function syncSlotSettingsUI(){
  const { startTime, durationMinutes } = getSlotSettings();
  if (slotStartTimeInput) slotStartTimeInput.value = startTime;
  if (slotDurationValueInput && slotDurationUnitSelect){
    if (durationMinutes % 60 === 0){
      slotDurationUnitSelect.value = "hours";
      slotDurationValueInput.value = String(durationMinutes / 60);
    } else {
      slotDurationUnitSelect.value = "minutes";
      slotDurationValueInput.value = String(durationMinutes);
    }
  }
}

function getSlotSettingsFromUI(){
  let time = slotStartTimeInput?.value || "06:00";
  if (!/^\d{2}:\d{2}$/.test(time)) time = "06:00";
  let val = Number(slotDurationValueInput?.value || 60);
  if (!Number.isFinite(val) || val <= 0) val = 60;
  if (val > 600) val = 600;
  const unit = slotDurationUnitSelect?.value || "minutes";
  let durationMinutes = unit === "hours" ? val*60 : val;
  if (durationMinutes <= 0) durationMinutes = 60;
  return { startTime: time, durationMinutes };
}

/* generate slot definitions for current settings, finishing at 00:00 of same day */
function generateSlotDefinitions(){
  const { startTime, durationMinutes } = getSlotSettings();
  const startMinutes = parseTimeToMinutes(startTime);
  const dayMinutes = 1440; // 24*60
  const slots = [];
  if (durationMinutes <= 0) return slots;

  let currentStart = startMinutes;
  let index = 0;
  while (true){
    let currentEnd = currentStart + durationMinutes;
    if (currentEnd >= dayMinutes){
      currentEnd = dayMinutes; // force to midnight
    }
    const startStr = minutesToHHMM(currentStart);
    const endStr = (currentEnd === dayMinutes) ? "00:00" : minutesToHHMM(currentEnd);
    slots.push({ id: `s${index}`, hour: `${startStr} - ${endStr}` });
    index++;
    if (currentEnd >= dayMinutes) break;
    currentStart = currentEnd;
  }
  return slots;
}

/* ---------- storage & slots ---------- */

function isSlotEmpty(s) {
  const statusEmpty = (!s.status || s.status === "none" || s.status === "");
  return (
    (!s.planned || s.planned.trim() === "") &&
    (!s.done || s.done.trim() === "") &&
    statusEmpty &&
    (!s.halfDetail || s.halfDetail.trim() === "")
  );
}

function hasStoredDataForDate(dateObj){
  try {
    const raw = localStorage.getItem(storageKeyForDate(dateObj));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    return parsed.some(s => !isSlotEmpty(s || {}));
  } catch(e){
    console.error(e);
    return false;
  }
}

function loadSlotsForDate(dateObj){
  const defs = generateSlotDefinitions();
  let storedMap = new Map();
  try{
    const raw = localStorage.getItem(storageKeyForDate(dateObj));
    if (raw){
      const storedArr = JSON.parse(raw);
      if (Array.isArray(storedArr)){
        storedArr.forEach(s=>{ if (s && typeof s.hour === "string") storedMap.set(s.hour, s); });
      }
    }
  }catch(e){ console.error(e); }

  return defs.map((def, idx)=>{
    const existing = storedMap.get(def.hour) || {};
    const slot = {
      id: existing.id || `s${idx}`,
      hour: def.hour,
      planned: existing.planned || "",
      done: existing.done || "",
      status: existing.status || "",
      halfDetail: existing.halfDetail || "",
      saved: !!existing.saved
    };
    if (!slot.planned && !slot.done && !slot.halfDetail && slot.status === "none"){ slot.status = ""; }
    return slot;
  });
}

function saveForDate(dateObj, slots){
  try { localStorage.setItem(storageKeyForDate(dateObj), JSON.stringify(slots)); showToast("Saved"); }
  catch(e){ console.error(e); showToast("Save failed"); }
}
function clearForDate(dateObj){ try { localStorage.removeItem(storageKeyForDate(dateObj)); } catch(e){ console.error(e); } }

/* ---------- render ---------- */
function escapeHtml(t){ if (t == null) return ""; return String(t).replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function renderDate(d){ if (dateLabel) dateLabel.textContent = formatReadableDate(d); if (dayPicker) dayPicker.value = formatDateKey(d); }

function renderSlots(slots){
  container.innerHTML = "";
  const percents = [10,20,30,40,50,60,70,80,90,100];

  slots.forEach((s, idx) => {
    const box = document.createElement("div");
    const doneClass = s.status === "done" ? " done" : "";
    box.className = "hour-box" + doneClass;

    const checkedNone = s.status === "none" ? "checked" : "";
    const checkedHalf = s.status === "half" ? "checked" : "";
    const checkedDone = s.status === "done" ? "checked" : "";

    let percentOptionsHtml = '<option value="">Select percentage</option>';
    percents.forEach(p => {
      const value = `${p}%`;
      const selected = s.halfDetail === value ? ' selected' : '';
      percentOptionsHtml += `<option value="${value}"${selected}>${p}% completed</option>`;
    });

    box.innerHTML = `
      <div class="hour-title">${s.hour}</div>

      <div class="field">
        <label>Planned</label>
        <div class="input-with-mic">
          <input class="planned" placeholder="Planned task" value="${escapeHtml(s.planned)}">
          <button type="button" class="voice-btn" title="Speak to fill planned"><i class="bi bi-mic-fill"></i></button>
        </div>
      </div>

      <div class="field">
        <label>What I did</label>
        <div class="input-with-mic">
          <input class="done" placeholder="What you did" value="${escapeHtml(s.done)}">
          <button type="button" class="voice-btn" title="Speak to fill done"><i class="bi bi-mic-fill"></i></button>
        </div>
      </div>

      <div class="field">
        <label style="display:block; margin-bottom:6px;">Status</label>
        <div class="status-options">
          <label class="status-option">
            <input type="radio" name="status-${idx}" value="none" class="status-radio" ${checkedNone}>
            Not done
          </label>
          <label class="status-option">
            <input type="radio" name="status-${idx}" value="half" class="status-radio" ${checkedHalf}>
            Half completed
          </label>
          <label class="status-option">
            <input type="radio" name="status-${idx}" value="done" class="status-radio" ${checkedDone}>
            Completed
          </label>
        </div>

        <div class="half-detail-row" style="margin-top:8px; display:${s.status === "half" ? "block" : "none"};">
          <select class="half-detail-input">
            ${percentOptionsHtml}
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:8px;">
        <div style="font-size:13px; color:var(--muted)"></div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="save action">
            <i class="bi bi-check2"></i>
            <span class="save-label">${s.saved ? "Saved" : "Save"}</span>
          </button>
          <button class="clear action"><i class="bi bi-x-lg"></i> Clear</button>
        </div>
      </div>
    `;

    const plannedInput = box.querySelector(".planned");
    const plannedMic = box.querySelectorAll(".voice-btn")[0];
    const doneInput   = box.querySelector(".done");
    const doneMic     = box.querySelectorAll(".voice-btn")[1];
    const statusRadios = box.querySelectorAll(".status-radio");
    const halfDetailRow = box.querySelector(".half-detail-row");
    const halfDetailInput = box.querySelector(".half-detail-input");
    const saveBtn = box.querySelector(".save");
    const saveLabel = box.querySelector(".save-label");
    const clearBtn = box.querySelector(".clear");

    // attach a reference so recognition and input dispatch can access the slot object
    plannedInput._slotRef = s;
    doneInput._slotRef = s;

    function markUnsaved(){ s.saved = false; if (saveLabel) saveLabel.textContent = "Save"; }

    function updateSaveState() {
      if (isSlotEmpty(s)) { saveBtn.disabled = true; saveBtn.classList.add("disabled-btn"); }
      else { saveBtn.disabled = false; saveBtn.classList.remove("disabled-btn"); }
    }
    updateSaveState();

    // when user types (or when mic dispatches input), update slot model and enable Save
    plannedInput.addEventListener("input", (e) => { s.planned = e.target.value; markUnsaved(); updateSaveState(); });
    doneInput.addEventListener("input", (e) => { s.done = e.target.value; markUnsaved(); updateSaveState(); });

    /* ---------- STATUS RADIO HANDLING (toggleable) ----------
       Use mousedown to remember prior checked state, then on click if it was already checked
       we uncheck it and dispatch change so rest of logic runs. This approach avoids blocking
       normal checking behavior when it wasn't already checked.
    */
    statusRadios.forEach(r => {
      // remember whether it was checked before user interaction
      r.addEventListener('mousedown', (ev) => {
        r._wasChecked = r.checked;
      });

      r.addEventListener('click', (ev) => {
        if (r._wasChecked) {
          // user clicked on already-checked radio -> uncheck it and dispatch change
          // do this in microtask so browser's native click handling is settled
          setTimeout(() => {
            r.checked = false;
            r._wasChecked = false;
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }, 0);
        }
        // otherwise normal behavior will check the radio and change handler below will run
      });

      // change handler updates slot state & UI
      r.addEventListener("change", (e) => {
        const groupName = r.name;
        const group = box.querySelectorAll(`input[name="${groupName}"]`);
        let selected = "";
        group.forEach(g => { if (g.checked) selected = g.value; });
        s.status = selected; // "" if none checked
        if (s.status === "half") {
          halfDetailRow.style.display = "block";
        } else {
          halfDetailRow.style.display = "none";
          s.halfDetail = "";
        }
        if (s.status === "done") box.classList.add("done"); else box.classList.remove("done");
        markUnsaved();
        updateSaveState();
      });
    });

    if (halfDetailInput) {
      halfDetailInput.addEventListener("change", (e) => {
        s.halfDetail = e.target.value;
        markUnsaved();
        updateSaveState();
      });
    }

    saveBtn.addEventListener("click", () => {
      if (isSlotEmpty(s)) { showToast("Empty slot — add content or status first"); return; }
      s.saved = true;
      if (saveLabel) saveLabel.textContent = "Saved";
      saveForDate(currentDate, slotsState);
    });

    clearBtn.addEventListener("click", () => {
      s.planned = "";
      s.done = "";
      s.status = "";
      s.halfDetail = "";
      s.saved = false;
      renderSlots(slotsState);
    });

    function attachMic(micButton, targetInput){
      if (!SpeechRecognition || !recognition) {
        micButton.addEventListener("click", () => showToast("Voice input not supported in this browser"));
        return;
      }
      micButton.addEventListener("click", (e) => {
        e.preventDefault();
        if (micButton.classList.contains("listening")) {
          stopListening();
          micButton.classList.remove("listening");
        } else {
          startListening(micButton, targetInput);
        }
      });
    }
    attachMic(plannedMic, plannedInput);
    attachMic(doneMic, doneInput);

    container.appendChild(box);
  });
}

/* ---------- CSV & PDF export ---------- */
function exportCsvForDateShared(d, slots){
  const rows = [["Hour","Planned","Done","Status","HalfDetail"]];
  slots.forEach(s=>{
    const planned = (s.planned||"").replace(/"/g,'""');
    const done = (s.done||"").replace(/"/g,'""');
    const status = s.status || "";
    const half = (s.halfDetail||"").replace(/"/g,'""');
    rows.push([s.hour, `"${planned}"`, `"${done}"`, status, `"${half}"`]);
  });
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const fileName = `hourly-${formatDateKey(d)}.csv`;
  triggerDownload(blob, fileName);
}

async function exportPdfForDate(d, slots) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({orientation: 'portrait', unit: 'pt', format: 'a4'});
    doc.setFontSize(14);
    doc.text(`Hourly Report — ${formatReadableDate(d)}`, 40, 40);

    const rows = slots.map(s => [
      s.hour,
      s.planned || "",
      s.done || "",
      s.status === "half" ? "Half" : (s.status === "done" ? "Done" : (s.status === "" ? "" : s.status)),
      s.halfDetail || ""
    ]);

    doc.autoTable({
      head: [['Hour','Planned','Done','Status','Half detail']],
      body: rows,
      startY: 70,
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [40, 116, 166], textColor: 255 }
    });

    const pdfBlob = doc.output('blob');
    const fileName = `hourly-${formatDateKey(d)}.pdf`;
    triggerDownload(pdfBlob, fileName);
  } catch (err) {
    console.error("PDF export failed", err);
    showToast("PDF export failed");
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Downloaded");
}

/* ---------- theme ---------- */
function applyTheme(th){ document.body.setAttribute("data-theme", th || "light"); if(themeSelect) themeSelect.value = th || "light"; }
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved) applyTheme(saved);
  else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
  if(themeSelect){
    themeSelect.addEventListener("change", (e) => {
      applyTheme(e.target.value);
      try{ localStorage.setItem(THEME_KEY, e.target.value); }catch(e){}
      showToast("Theme changed");
    });
  }
}

/* ---------- state & date navigation ---------- */
let currentDate = new Date();
let slotsState = [];

function loadAndRender(){
  renderDate(currentDate);
  slotsState = loadSlotsForDate(currentDate);
  renderSlots(slotsState);
}

/* central date-change function with rules:
   - Past date with NO stored data -> show popup "No Entry Added", don't change date
   - Past date with data -> allow
   - Today/future -> allow (no popup)
*/
function tryChangeDate(newDate){
  const today = getDateOnly(new Date());
  const target = getDateOnly(newDate);

  if (target < today){
    const hasData = hasStoredDataForDate(target);
    if (!hasData){
      showModal("No Entry Added");
      if (dayPicker) dayPicker.value = formatDateKey(currentDate);
      return;
    }
  }

  currentDate = target;
  loadAndRender();
}

if (dayPicker){
  dayPicker.addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    const [y,m,d] = val.split("-");
    if(!y || !m || !d) return;
    const nd = new Date(Number(y), Number(m)-1, Number(d));
    tryChangeDate(nd);
  });
}

if (prevDayBtn){
  prevDayBtn.addEventListener("click", ()=>{
    const nd = new Date(currentDate);
    nd.setDate(nd.getDate()-1);
    tryChangeDate(nd);
  });
}
if (nextDayBtn){
  nextDayBtn.addEventListener("click", ()=>{
    const nd = new Date(currentDate);
    nd.setDate(nd.getDate()+1);
    tryChangeDate(nd);
  });
}
if (todayBtn){
  todayBtn.addEventListener("click", ()=>{
    const today = new Date();
    tryChangeDate(today);
  });
}

/* apply slot settings button */
if (applySlotSettingsBtn){
  applySlotSettingsBtn.addEventListener("click", ()=>{
    const uiSettings = getSlotSettingsFromUI();
    saveSlotSettings(uiSettings);
    showToast("Slot settings applied");
    slotsState = loadSlotsForDate(currentDate);
    renderSlots(slotsState);
  });
}

/* export buttons */
if (exportCsvBtn){ exportCsvBtn.addEventListener("click", ()=> exportCsvForDateShared(currentDate, slotsState)); }
if (exportPdfBtn){ exportPdfBtn.addEventListener("click", ()=> exportPdfForDate(currentDate, slotsState)); }

/* reset day */
if (resetDayBtn){
  resetDayBtn.addEventListener("click", ()=>{
    if(!confirm("Reset this day's entries? This will only remove data for the currently selected date.")) return;
    const backup = JSON.stringify(slotsState);
    clearForDate(currentDate);
    slotsState = loadSlotsForDate(currentDate);
    saveForDate(currentDate, slotsState);
    loadAndRender();
    showToast("Day reset");

    function tryUndo(e){
      if((e.ctrlKey || e.metaKey) && e.key === "z"){
        try{
          localStorage.setItem(storageKeyForDate(currentDate), backup);
          loadAndRender();
          showToast("Undo reset");
        }catch(err){ console.error(err); }
        window.removeEventListener("keydown", tryUndo);
      }
    }
    window.addEventListener("keydown", tryUndo);
  });
}

/* ---------- init ---------- */
initTheme();
syncSlotSettingsUI();
loadAndRender();

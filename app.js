const STORAGE_KEY = "school_powerbank_rental_v1";
const RENT_HOURS = 6;
const DAILY_RETURN_HOUR = 17;
const DAILY_RETURN_MINUTE = 0;
const DEFAULT_ADMIN_PASSWORD = "0000";
const ADMIN_PASSWORD_STORAGE_KEY = "school_powerbank_admin_password_v1";
const ADMIN_AUTH_KEY = "school_powerbank_admin_auth_v1";
const STUDENT_ID_PREFIXES = [10, 20, 30];
const STUDENT_ID_GROUPS = Array.from({ length: 8 }, (_, index) => index + 1);
const STUDENT_ID_TAILS = Array.from({ length: 30 }, (_, index) => String(index + 1).padStart(2, "0"));
const RETENTION_DAYS = 7;
const MAX_LOG_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAdminPassword() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_ADMIN_PASSWORD;
  }
  return localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY) || DEFAULT_ADMIN_PASSWORD;
}

function setAdminPassword(password) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(ADMIN_PASSWORD_STORAGE_KEY, password);
}

function getLogAgeDays(log, now = Date.now()) {
  if (!log || !log.at) return 0;
  const ageMs = now - new Date(log.at).getTime();
  return ageMs / DAY_MS;
}

function isArchivedLog(log, now = Date.now()) {
  const ageDays = getLogAgeDays(log, now);
  return ageDays > RETENTION_DAYS && ageDays <= MAX_LOG_AGE_DAYS;
}

function pruneExpiredLogs(data) {
  if (!data || !Array.isArray(data.logs)) return;
  const now = Date.now();
  const cutoff = now - MAX_LOG_AGE_DAYS * DAY_MS;
  data.logs = data.logs.filter((log) => new Date(log.at).getTime() >= cutoff);
}

function getRecentLogs(logs, now = Date.now()) {
  return (Array.isArray(logs) ? logs : []).filter((log) => !isArchivedLog(log, now));
}

function getArchivedLogs(logs, now = Date.now()) {
  return (Array.isArray(logs) ? logs : []).filter((log) => isArchivedLog(log, now));
}

function getRelevantLogs(logs, selectedBatteryIds = [], showAllHistory = false, includeArchived = false, now = Date.now()) {
  const normalizedLogs = Array.isArray(logs) ? logs : [];
  const selectedIds = Array.isArray(selectedBatteryIds) ? selectedBatteryIds : [];
  const filteredByBattery = showAllHistory || !selectedIds.length
    ? normalizedLogs
    : normalizedLogs.filter((log) => selectedIds.some((id) => log.detail.includes(id) || log.detail.includes(`배터리 ${id}`)));

  const filteredByAge = includeArchived
    ? filteredByBattery.filter((log) => isArchivedLog(log, now))
    : filteredByBattery.filter((log) => !isArchivedLog(log, now));

  return filteredByAge.slice(0, 60);
}

function createInitialData() {
  const batteries = [];

  for (let i = 1; i <= 20; i += 1) {
    batteries.push({
      id: String(i),
      name: `배터리 ${i}`,
      status: "available",
      borrower: "",
      borrowedAt: "",
      dueAt: ""
    });
  }

  return {
    batteries,
    logs: [
      {
        at: new Date().toISOString(),
        action: "시스템 초기화",
        detail: "기본 배터리 20개 생성"
      }
    ]
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    const init = createInitialData();
    saveData(init);
    return init;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.batteries || !Array.isArray(parsed.batteries)) {
      throw new Error("invalid-data");
    }

    let migrated = false;
    parsed.batteries = parsed.batteries.map((battery) => {
      const normalizedId = normalizeBatteryCode(battery.id);
      if (normalizedId !== battery.id || !battery.name) {
        migrated = true;
      }
      return {
        ...battery,
        id: normalizedId,
        name: battery.name || `배터리 ${normalizedId}`
      };
    });

    pruneExpiredLogs(parsed);

    if (migrated) {
      addLog(parsed, "시스템 변환", "배터리 정보 형식을 정리했습니다.");
      saveData(parsed);
    }

    return parsed;
  } catch {
    const init = createInitialData();
    saveData(init);
    return init;
  }
}

function saveData(data) {
  pruneExpiredLogs(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function addLog(data, action, detail) {
  pruneExpiredLogs(data);
  data.logs.unshift({
    at: new Date().toISOString(),
    action,
    detail
  });
  data.logs = data.logs.slice(0, 120);
}

function statsFromData(data) {
  const total = data.batteries.length;
  const rented = data.batteries.filter((b) => b.status === "rented").length;
  const available = total - rented;
  const now = Date.now();
  const overdue = data.batteries.filter((b) => b.status === "rented" && b.dueAt && new Date(b.dueAt).getTime() < now).length;

  return { total, available, rented, overdue };
}

function formatTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  return `${date.toLocaleDateString("ko-KR")} ${date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function normalizeBatteryCode(input) {
  const raw = (input || "").trim().toUpperCase();
  if (!raw) return "";

  const pbMatch = raw.match(/^PB-(\d{1,3})$/);
  if (pbMatch) {
    return String(Number(pbMatch[1]));
  }

  const numericMatch = raw.match(/^\d+$/);
  if (numericMatch) {
    return String(Number(raw));
  }

  return raw;
}

function buildStudentId(prefix, group, tail) {
  return `${prefix}${group}${String(tail).padStart(2, "0")}`;
}

function normalizeStudentId(studentId) {
  return String(studentId || "").trim();
}

function isWeekend(date = new Date()) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function getDueAtForToday(now = new Date()) {
  const dueAt = new Date(now);
  dueAt.setHours(DAILY_RETURN_HOUR, DAILY_RETURN_MINUTE, 0, 0);

  if (dueAt.getTime() <= now.getTime()) {
    dueAt.setDate(dueAt.getDate() + 1);
  }

  return dueAt;
}

function borrowBattery(data, studentId, batteryCode) {
  const normalizedStudentId = normalizeStudentId(studentId);

  if (!normalizedStudentId) return { ok: false, message: "학번을 선택해주세요." };
  if (!batteryCode) return { ok: false, message: "배터리 번호를 입력해주세요." };

  const battery = data.batteries.find((b) => b.id === batteryCode);
  if (!battery) return { ok: false, message: "등록되지 않은 배터리 번호입니다." };
  if (battery.status === "rented") {
    return { ok: false, message: `이미 대여 중입니다. (${battery.borrower})` };
  }

  const alreadyBorrowed = data.batteries.some((item) => {
    if (item.status !== "rented") return false;
    const borrower = normalizeStudentId(item.borrower);
    return borrower && borrower === normalizedStudentId;
  });
  if (alreadyBorrowed) {
    return { ok: false, message: "이미 대여 중인 배터리가 있어, 한 학번당 배터리는 1개만 대여할 수 있습니다." };
  }

  const now = new Date();
  const dueAt = getDueAtForToday(now);
  battery.status = "rented";
  battery.borrower = normalizedStudentId;
  battery.borrowedAt = now.toISOString();
  battery.dueAt = dueAt.toISOString();

  addLog(data, "대여", `${battery.borrower} -> ${battery.name || battery.id}`);
  saveData(data);

  return {
    ok: true,
    message: `${battery.name || battery.id} 대여 완료. 반납 예정 ${formatTime(battery.dueAt)}`
  };
}

function returnBattery(data, studentId, batteryCode, force = false) {
  const normalizedStudentId = normalizeStudentId(studentId);

  if (!force && !normalizedStudentId) return { ok: false, message: "학번을 선택해주세요." };
  if (!batteryCode) return { ok: false, message: "반납할 배터리 코드를 입력해주세요." };

  const battery = data.batteries.find((b) => b.id === batteryCode);
  if (!battery) return { ok: false, message: "등록되지 않은 배터리 번호입니다." };
  if (battery.status === "available") {
    return { ok: false, message: "이미 반납 상태입니다." };
  }

  if (!force && normalizeStudentId(battery.borrower) !== normalizedStudentId) {
    return { ok: false, message: `현재 대여자(${battery.borrower})와 일치하지 않습니다.` };
  }

  const previousBorrower = battery.borrower;
  battery.status = "available";
  battery.borrower = "";
  battery.borrowedAt = "";
  battery.dueAt = "";

  addLog(data, force ? "관리자 강제 반납" : "반납", `${previousBorrower} -> ${battery.name || battery.id}`);
  saveData(data);

  return {
    ok: true,
    message: `${battery.name || battery.id} 반납 완료되었습니다.`
  };
}

function renderStatCards(target, stats) {
  if (!target) return;

  target.innerHTML = `
    <article class="stat-card"><p class="stat-label">전체</p><p class="stat-value">${stats.total}</p></article>
    <article class="stat-card"><p class="stat-label">대여 가능</p><p class="stat-value">${stats.available}</p></article>
    <article class="stat-card"><p class="stat-label">대여 중</p><p class="stat-value">${stats.rented}</p></article>
    <article class="stat-card"><p class="stat-label">연체</p><p class="stat-value">${stats.overdue}</p></article>
  `;
}

function getBatteryHistoryLogs(logs, batteryId, limit = 3) {
  if (!batteryId) return [];
  const normalizedBatteryId = String(batteryId).trim();
  const escapedId = normalizedBatteryId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const batteryPattern = new RegExp(`(^|[^0-9])배터리\\s+${escapedId}($|[^0-9])`);

  return (Array.isArray(logs) ? logs : [])
    .filter((log) => {
      const detail = String(log?.detail || "");
      if (!detail) return false;
      return batteryPattern.test(detail);
    })
    .slice(0, limit);
}

function renderHistory(target, logs, filterText = "", limit = 15) {
  if (!target) return;
  const displayLogs = logs
    .filter((log) => (filterText ? log.detail.includes(filterText) : true))
    .slice(0, limit);

  if (displayLogs.length === 0) {
    target.innerHTML = "<li>아직 기록이 없습니다.</li>";
    return;
  }

  target.innerHTML = displayLogs
    .map(
      (log) =>
        `<li><strong>${log.action}</strong> · ${log.detail}<br />${formatTime(log.at)}</li>`
    )
    .join("");
}

function requestAdminAccess() {
  const modal = document.getElementById("admin-auth-modal");
  const input = document.getElementById("admin-password-input");
  const message = document.getElementById("admin-auth-message");
  const confirmBtn = document.getElementById("admin-auth-confirm");
  const cancelBtn = document.getElementById("admin-auth-cancel");

  if (!modal || !input || !message || !confirmBtn || !cancelBtn) {
    return Promise.resolve({ ok: false, canceled: true });
  }

  modal.classList.remove("hidden");
  input.value = "";
  message.textContent = "";

  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onInputKeyDown);
      modal.classList.add("hidden");
    }

    function onConfirm() {
      if (input.value === getAdminPassword()) {
        sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
        cleanup();
        resolve({ ok: true, canceled: false });
        return;
      }

      sessionStorage.removeItem(ADMIN_AUTH_KEY);
      message.textContent = "비밀번호가 올바르지 않습니다.";
      message.style.color = "var(--danger)";
      input.value = "";
      input.focus();
    }

    function onCancel() {
      sessionStorage.removeItem(ADMIN_AUTH_KEY);
      cleanup();
      resolve({ ok: false, canceled: true });
    }

    function onInputKeyDown(event) {
      if (event.key === "Enter") {
        onConfirm();
      }
      if (event.key === "Escape") {
        onCancel();
      }
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onInputKeyDown);
    input.focus();
  });
}

function hasAdminAccess() {
  return sessionStorage.getItem(ADMIN_AUTH_KEY) === "true";
}

function initStudentPage() {
  const prefixSelect = document.getElementById("student-id-prefix");
  const groupSelect = document.getElementById("student-id-group");
  const tailSelect = document.getElementById("student-id-tail");
  const batteryCodeInput = document.getElementById("battery-code-input");
  const borrowBtn = document.getElementById("borrow-btn");
  const returnBtn = document.getElementById("return-btn");
  const adminLink = document.getElementById("admin-link");
  const message = document.getElementById("student-message");
  const dueInfo = document.getElementById("borrow-due-info");
  const statsEl = document.getElementById("student-stats");
  const historyEl = document.getElementById("student-history");
  const studentIdPreview = document.getElementById("student-id-preview");

  function updatePreview() {
    if (studentIdPreview) {
      const studentId = buildStudentId(prefixSelect.value, groupSelect.value, tailSelect.value);
      studentIdPreview.textContent = `선택된 학번: ${studentId}`;
    }
  }

  function setDueInfo(text) {
    if (!dueInfo) return;
    dueInfo.textContent = text || "";
    dueInfo.style.color = text ? "var(--accent)" : "var(--ink-soft)";
  }

  function updateBorrowButtonState() {
    const weekend = isWeekend();
    if (borrowBtn) {
      borrowBtn.disabled = weekend;
      borrowBtn.classList.toggle("is-disabled", weekend);
      borrowBtn.setAttribute("aria-disabled", String(weekend));
    }
    if (weekend) {
      setDueInfo("주말에는 대여할 수 없습니다. 평일에만 대여 가능합니다.");
    }
  }

  function refresh() {
    const data = loadData();
    renderStatCards(statsEl, statsFromData(data));
    const studentId = buildStudentId(prefixSelect.value, groupSelect.value, tailSelect.value);
    renderHistory(historyEl, data.logs, studentId);
    updatePreview();
    updateBorrowButtonState();
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? "var(--danger)" : "var(--ink-soft)";
  }

  borrowBtn.addEventListener("click", () => {
    const data = loadData();
    const studentId = buildStudentId(prefixSelect.value, groupSelect.value, tailSelect.value);
    const batteryCode = normalizeBatteryCode(batteryCodeInput.value);
    batteryCodeInput.value = batteryCode;

    if (isWeekend()) {
      setMessage("주말에는 대여할 수 없습니다. 평일에만 대여 가능합니다.", true);
      setDueInfo("");
      return;
    }

    const result = borrowBattery(data, studentId, batteryCode);
    setMessage(result.message, !result.ok);
    if (result.ok) {
      const battery = data.batteries.find((item) => item.id === batteryCode);
      setDueInfo(battery && battery.dueAt ? `반납 예정: ${formatTime(battery.dueAt)}` : "");
    } else {
      setDueInfo("");
    }
    refresh();
  });

  returnBtn.addEventListener("click", () => {
    const data = loadData();
    const studentId = buildStudentId(prefixSelect.value, groupSelect.value, tailSelect.value);
    const batteryCode = normalizeBatteryCode(batteryCodeInput.value);
    batteryCodeInput.value = batteryCode;

    const result = returnBattery(data, studentId, batteryCode);
    setMessage(result.message, !result.ok);
    if (result.ok) {
      setDueInfo("");
    }
    refresh();
  });

  adminLink.addEventListener("click", async (event) => {
    event.preventDefault();

    const result = await requestAdminAccess();
    if (result.ok) {
      window.location.href = "./admin.html";
      return;
    }

    if (!result.canceled) {
      setMessage("관리자 비밀번호가 올바르지 않습니다.", true);
    }
  });

  [prefixSelect, groupSelect, tailSelect].forEach((select) => {
    select.addEventListener("change", refresh);
  });

  refresh();
}

async function initAdminPage() {
  const statsEl = document.getElementById("admin-stats");
  const listEl = document.getElementById("battery-list");
  const logsEl = document.getElementById("admin-logs");
  const archivedLogsEl = document.getElementById("archived-logs");
  const addBatteryBtn = document.getElementById("admin-add-battery");
  const addBatteryCountInput = document.getElementById("battery-add-count");
  const showAllHistory = document.getElementById("show-all-battery-history");
  const authNotice = document.getElementById("admin-auth-notice");
  const authButton = document.getElementById("admin-auth-open");
  const passwordInput = document.getElementById("admin-password-change-input");
  const passwordSaveButton = document.getElementById("admin-password-save");
  const passwordMessage = document.getElementById("admin-password-message");
  const recentLogsToggleButton = document.getElementById("toggle-recent-logs");
  const selectedBatteryIds = new Set();
  let showExpandedRecentLogs = false;

  function updateAuthNotice() {
    const adminControls = document.querySelectorAll("[data-admin-only]");
    if (!authNotice || !authButton) return;
    if (hasAdminAccess()) {
      authNotice.classList.add("hidden");
      authButton.classList.add("hidden");
      adminControls.forEach((el) => el.classList.remove("hidden"));
      return;
    }
    authNotice.classList.remove("hidden");
    authButton.classList.remove("hidden");
    adminControls.forEach((el) => el.classList.add("hidden"));
  }

  function renderBatteryList(data) {
    if (!listEl) return;
    listEl.innerHTML = data.batteries
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((battery) => {
        const rentedInfo = battery.status === "rented" ? `${battery.borrower || "-"} / ${formatTime(battery.dueAt)}` : "보관함 대기";
        const label = battery.status === "rented" ? "대여중" : "대여가능";
        const batteryName = escapeHtml(battery.name || `배터리 ${battery.id}`);
        const checked = selectedBatteryIds.has(battery.id) ? "checked" : "";
        const recentHistory = getBatteryHistoryLogs(data.logs, battery.id, 3)
          .map((log) => `<li><strong>${escapeHtml(log.action)}</strong> · ${escapeHtml(log.detail)}<br />${formatTime(log.at)}</li>`)
          .join("");
        const historyMarkup = recentHistory
          ? `<ul class="battery-history-list">${recentHistory}</ul>`
          : '<p class="message">이력 없음</p>';
        const stateSummary = battery.status === "rented"
          ? (battery.dueAt && new Date(battery.dueAt).getTime() < Date.now() ? "연체 중" : "현재 대여 중")
          : "대여 가능";
        return `
          <article class="battery-item">
            <div class="battery-main">
              <div class="battery-head">
                <strong>${batteryName}</strong>
                <span class="badge ${battery.status}">${label}</span>
              </div>
              <small>${escapeHtml(rentedInfo)}</small>
              <p class="battery-state-summary">${escapeHtml(stateSummary)}</p>
              <div class="battery-controls">
                <label class="checkbox-row">
                  <input type="checkbox" data-battery-id="${battery.id}" ${checked} />
                  이력 보기
                </label>
                <input class="battery-name-input" data-battery-id="${battery.id}" type="text" value="${batteryName}" placeholder="배터리 이름" />
                <div class="button-row compact">
                  <button class="btn btn-ghost" data-action="rename" data-battery-id="${battery.id}" type="button">이름 변경</button>
                  <button class="btn btn-ghost" data-action="delete" data-battery-id="${battery.id}" type="button">삭제</button>
                </div>
                <div class="battery-history-block">
                  <p class="history-caption">최근 대여 기록</p>
                  ${historyMarkup}
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function refresh() {
    const data = loadData();
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const selectedIds = Array.from(selectedBatteryIds);
    const showAll = Boolean(showAllHistory && showAllHistory.checked);

    renderStatCards(statsEl, statsFromData(data));
    renderBatteryList(data);
    const recentLogLimit = showExpandedRecentLogs ? 60 : 8;
    renderHistory(logsEl, getRelevantLogs(logs, selectedIds, showAll, false), "", recentLogLimit);
    renderHistory(archivedLogsEl, getRelevantLogs(logs, selectedIds, showAll, true), "", 8);
    if (recentLogsToggleButton) {
      recentLogsToggleButton.textContent = showExpandedRecentLogs ? "간략히 보기" : "전체 기록 보기";
    }
    if (archivedLogsEl) {
      archivedLogsEl.classList.add("hidden");
    }
    updateAuthNotice();
  }

  if (authButton) {
    authButton.addEventListener("click", async () => {
      const result = await requestAdminAccess();
      if (result.ok) {
        refresh();
      }
    });
  }

  if (passwordSaveButton && passwordInput && passwordMessage) {
    passwordSaveButton.addEventListener("click", () => {
      if (!hasAdminAccess()) {
        passwordMessage.textContent = "관리자 인증이 필요합니다.";
        passwordMessage.style.color = "var(--danger)";
        return;
      }

      const nextPassword = (passwordInput.value || "").trim();
      if (!nextPassword) {
        passwordMessage.textContent = "변경할 비밀번호를 입력해주세요.";
        passwordMessage.style.color = "var(--danger)";
        return;
      }

      setAdminPassword(nextPassword);
      passwordInput.value = "";
      passwordMessage.textContent = "관리자 비밀번호가 변경되었습니다.";
      passwordMessage.style.color = "var(--accent)";
    });
  }

  if (recentLogsToggleButton) {
    recentLogsToggleButton.addEventListener("click", () => {
      showExpandedRecentLogs = !showExpandedRecentLogs;
      refresh();
    });
  }

  if (listEl) {
    listEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const data = loadData();
      const batteryId = button.dataset.batteryId;
      const battery = data.batteries.find((item) => item.id === batteryId);
      if (!battery) return;

      if (button.dataset.action === "rename") {
        const input = listEl.querySelector(`input.battery-name-input[data-battery-id="${batteryId}"]`);
        battery.name = (input.value || "").trim() || `배터리 ${battery.id}`;
        addLog(data, "배터리 변경", `${battery.name} 이름 변경`);
        saveData(data);
        refresh();
        return;
      }

      if (button.dataset.action === "delete") {
        data.batteries = data.batteries.filter((item) => item.id !== batteryId);
        addLog(data, "배터리 삭제", `${battery.name || battery.id} 삭제`);
        saveData(data);
        refresh();
      }
    });

    listEl.addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[type='checkbox'][data-battery-id]");
      if (!checkbox) return;
      const batteryId = checkbox.dataset.batteryId;
      if (checkbox.checked) {
        selectedBatteryIds.add(batteryId);
      } else {
        selectedBatteryIds.delete(batteryId);
      }
      refresh();
    });
  }

  if (addBatteryBtn) {
    addBatteryBtn.addEventListener("click", () => {
      if (!hasAdminAccess()) {
        if (authNotice) {
          authNotice.textContent = "관리자 인증이 필요합니다.";
          authNotice.classList.remove("hidden");
        }
        return;
      }

      const data = loadData();
      const count = Number(addBatteryCountInput.value || 1);
      const startId = data.batteries.length + 1;
      for (let index = 0; index < count; index += 1) {
        const newId = String(startId + index);
        data.batteries.push({
          id: newId,
          name: `배터리 ${newId}`,
          status: "available",
          borrower: "",
          borrowedAt: "",
          dueAt: ""
        });
      }
      addLog(data, "배터리 추가", `${count}개 배터리 추가`);
      saveData(data);
      refresh();
    });
  }

  if (showAllHistory) {
    showAllHistory.addEventListener("change", refresh);
  }

  refresh();
}

function initializePage() {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  if (document.body.dataset.page === "student") {
    initStudentPage();
  }

  if (document.body.dataset.page === "admin") {
    initAdminPage();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePage);
  } else {
    initializePage();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createInitialData,
    loadData,
    saveData,
    addLog,
    borrowBattery,
    returnBattery,
    getLogAgeDays,
    isArchivedLog,
    pruneExpiredLogs,
    getRecentLogs,
    getArchivedLogs,
    getRelevantLogs,
    getBatteryHistoryLogs,
    getAdminPassword,
    setAdminPassword
  };
}

// VERIDIAN AI Office Add-in -- task pane logic.
// GAP-CONNECTOR-LAYERS (Priority 14 Wave 2). Same-origin fetches to
// /api/v1/... (this file is served from the same Next.js app), auth via a
// self-serve vk_ API key (Settings > API Keys) sent as
// Authorization: Bearer <key> -- the exact mechanism requireAuthOrApiKey()
// already validates for every other /api/v1 route. No new auth flow.
(function () {
  "use strict";

  var STORAGE_KEY = "veridian_office_addin_api_key";
  var VALID_TYPES = ["GST", "TDS", "MCA", "PF", "ESIC", "INCOME_TAX", "ROC", "LABOUR", "ENVIRONMENTAL", "OTHER"];

  var state = { apiKey: null, host: null, departments: [] };

  var el = {}; // filled in wireDom()

  function wireDom() {
    el.connectPanel = document.getElementById("connect-panel");
    el.connectedPanel = document.getElementById("connected-panel");
    el.apiKeyInput = document.getElementById("api-key-input");
    el.connectBtn = document.getElementById("connect-btn");
    el.connectStatus = document.getElementById("connect-status");
    el.connectedAs = document.getElementById("connected-as");
    el.disconnectBtn = document.getElementById("disconnect-btn");
    el.tabBtns = document.querySelectorAll(".tab-btn");
    el.tabBrowse = document.getElementById("tab-browse");
    el.tabCreate = document.getElementById("tab-create");
    el.searchInput = document.getElementById("search-input");
    el.searchBtn = document.getElementById("search-btn");
    el.itemsList = document.getElementById("items-list");
    el.itemsEmpty = document.getElementById("items-empty");
    el.itemsError = document.getElementById("items-error");
    el.useSelectionBtn = document.getElementById("use-selection-btn");
    el.fTitle = document.getElementById("f-title");
    el.fType = document.getElementById("f-type");
    el.fDepartment = document.getElementById("f-department");
    el.fPriority = document.getElementById("f-priority");
    el.fDueDate = document.getElementById("f-due-date");
    el.fDescription = document.getElementById("f-description");
    el.createBtn = document.getElementById("create-btn");
    el.createStatus = document.getElementById("create-status");
  }

  function apiFetch(path, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, {
      Authorization: "Bearer " + state.apiKey,
      "Content-Type": "application/json",
    });
    return fetch(path, options).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          var message = (body && body.error) || ("Request failed (" + res.status + ")");
          throw new Error(message);
        }
        return body;
      });
    });
  }

  function connect(apiKey) {
    state.apiKey = apiKey;
    return apiFetch("/api/v1/connectors/office-addin/whoami").then(function (data) {
      localStorage.setItem(STORAGE_KEY, apiKey);
      el.connectedAs.textContent = "Connected as " + (data.orgName || "your org") +
        (data.keyName ? " (" + data.keyName + ")" : "");
      el.connectPanel.classList.add("hidden");
      el.connectedPanel.classList.remove("hidden");
      populateTypeOptions();
      loadDepartments();
      loadItems("");
    });
  }

  function disconnect() {
    state.apiKey = null;
    localStorage.removeItem(STORAGE_KEY);
    el.connectedPanel.classList.add("hidden");
    el.connectPanel.classList.remove("hidden");
    el.apiKeyInput.value = "";
    el.connectStatus.textContent = "";
  }

  function populateTypeOptions() {
    el.fType.innerHTML = "";
    VALID_TYPES.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      el.fType.appendChild(opt);
    });
  }

  function loadDepartments() {
    return apiFetch("/api/v1/connectors/office-addin/departments").then(function (data) {
      state.departments = data.departments || [];
      el.fDepartment.innerHTML = "";
      if (state.departments.length === 0) {
        var opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No departments found";
        el.fDepartment.appendChild(opt);
        return;
      }
      state.departments.forEach(function (d) {
        var opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = d.name;
        el.fDepartment.appendChild(opt);
      });
    }).catch(function (err) {
      console.error("Failed to load departments", err);
    });
  }

  function badgeClass(status) {
    return "badge badge-" + (status || "pending");
  }

  function renderItems(items) {
    el.itemsList.innerHTML = "";
    el.itemsError.classList.add("hidden");
    if (!items || items.length === 0) {
      el.itemsEmpty.classList.remove("hidden");
      return;
    }
    el.itemsEmpty.classList.add("hidden");
    items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "item-card";

      var title = document.createElement("div");
      title.className = "item-title";
      title.textContent = item.title;
      card.appendChild(title);

      var badge = document.createElement("span");
      badge.className = badgeClass(item.status);
      badge.textContent = (item.status || "pending").replace("_", " ");

      var due = item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "no due date";
      var metaText = document.createTextNode(" " + item.complianceType + " " + String.fromCharCode(183) + " Due " + due);

      var meta = document.createElement("div");
      meta.className = "item-meta";
      meta.appendChild(badge);
      meta.appendChild(metaText);
      card.appendChild(meta);

      var insertBtn = document.createElement("button");
      insertBtn.className = "btn btn-secondary";
      insertBtn.textContent = state.host === "Excel" ? "Insert row" : "Insert into document";
      insertBtn.addEventListener("click", function () { insertItem(item); });
      card.appendChild(insertBtn);

      el.itemsList.appendChild(card);
    });
  }

  function loadItems(search) {
    var query = search ? "?search=" + encodeURIComponent(search) + "&limit=25" : "?limit=25";
    return apiFetch("/api/v1/compliance" + query).then(function (data) {
      renderItems(data.compliance || []);
    }).catch(function (err) {
      el.itemsError.textContent = err.message;
      el.itemsError.classList.remove("hidden");
      el.itemsEmpty.classList.add("hidden");
      el.itemsList.innerHTML = "";
    });
  }

  // --- Office.js document interaction -------------------------------------

  function insertItem(item) {
    var due = item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "no due date";
    if (state.host === "Excel" && typeof Excel !== "undefined") {
      Excel.run(function (context) {
        var sheet = context.workbook.worksheets.getActiveWorksheet();
        var usedRange = sheet.getUsedRangeOrNullObject();
        usedRange.load("rowCount");
        return context.sync().then(function () {
          var startRow = usedRange.isNullObject ? 0 : usedRange.rowCount;
          var target = sheet.getRangeByIndexes(startRow, 0, 1, 5);
          target.values = [[item.title, item.complianceType, item.status, due, item.priority]];
          return context.sync();
        });
      }).catch(function (err) { console.error("Excel insert failed", err); });
    } else if (typeof Word !== "undefined") {
      Word.run(function (context) {
        var body = context.document.body;
        var para = body.insertParagraph(
          item.title + " -- " + item.complianceType + " -- " + (item.status || "pending").replace("_", " ") + " -- Due " + due,
          Word.InsertLocation.end
        );
        para.font.bold = false;
        return context.sync();
      }).catch(function (err) { console.error("Word insert failed", err); });
    }
  }

  function useSelectionAsTitle() {
    if (state.host === "Excel" && typeof Excel !== "undefined") {
      Excel.run(function (context) {
        var range = context.workbook.getSelectedRange();
        range.load("values");
        return context.sync().then(function () {
          var v = range.values && range.values[0] && range.values[0][0];
          if (v) el.fTitle.value = String(v);
        });
      }).catch(function (err) { console.error("Excel selection read failed", err); });
    } else if (typeof Word !== "undefined") {
      Word.run(function (context) {
        var range = context.document.getSelection();
        range.load("text");
        return context.sync().then(function () {
          if (range.text) el.fTitle.value = range.text.trim().slice(0, 200);
        });
      }).catch(function (err) { console.error("Word selection read failed", err); });
    }
  }

  // --- Form handling --------------------------------------------------------

  function submitCreate() {
    el.createStatus.textContent = "";
    el.createStatus.className = "status";

    var body = {
      title: el.fTitle.value.trim(),
      complianceType: el.fType.value,
      departmentId: el.fDepartment.value,
      priority: el.fPriority.value,
      dueDate: el.fDueDate.value,
      description: el.fDescription.value.trim() || undefined,
    };

    if (!body.title) return showCreateError("Title is required.");
    if (!body.departmentId) return showCreateError("Select a department.");
    if (!body.dueDate) return showCreateError("Due date is required.");

    el.createBtn.disabled = true;
    apiFetch("/api/v1/compliance", { method: "POST", body: JSON.stringify(body) })
      .then(function () {
        el.createStatus.textContent = "Created.";
        el.createStatus.className = "status ok";
        el.fTitle.value = "";
        el.fDescription.value = "";
        el.fDueDate.value = "";
        loadItems("");
      })
      .catch(function (err) { showCreateError(err.message); })
      .then(function () { el.createBtn.disabled = false; });
  }

  function showCreateError(message) {
    el.createStatus.textContent = message;
    el.createStatus.className = "status error";
  }

  // --- Wiring -----------------------------------------------------------

  function switchTab(name) {
    el.tabBtns.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === name);
    });
    el.tabBrowse.classList.toggle("hidden", name !== "browse");
    el.tabCreate.classList.toggle("hidden", name !== "create");
  }

  function init() {
    wireDom();

    el.connectBtn.addEventListener("click", function () {
      var key = el.apiKeyInput.value.trim();
      if (key.indexOf("vk_") !== 0) {
        el.connectStatus.textContent = "That does not look like a VERIDIAN API key (should start with vk_).";
        el.connectStatus.className = "status error";
        return;
      }
      el.connectStatus.textContent = "Connecting...";
      el.connectStatus.className = "status";
      connect(key).catch(function (err) {
        el.connectStatus.textContent = err.message;
        el.connectStatus.className = "status error";
      });
    });

    el.disconnectBtn.addEventListener("click", disconnect);
    el.searchBtn.addEventListener("click", function () { loadItems(el.searchInput.value.trim()); });
    el.searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") loadItems(el.searchInput.value.trim());
    });
    el.useSelectionBtn.addEventListener("click", useSelectionAsTitle);
    el.createBtn.addEventListener("click", submitCreate);
    el.tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      el.connectStatus.textContent = "Reconnecting...";
      connect(saved).catch(function () {
        localStorage.removeItem(STORAGE_KEY);
        el.connectStatus.textContent = "";
      });
    }
  }

  if (typeof Office !== "undefined") {
    Office.onReady(function (info) {
      state.host = info.host;
      init();
    });
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
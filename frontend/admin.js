/* admin.js — logic for admin.html ONLY (per architecture: one JS file per page) */
(function () {
  "use strict";

  /* =========================================================================
     CONFIG
     Set these two values once real credentials exist. Until KM_GOOGLE_CLIENT_ID
     is set, the Google Sign-In button cannot render.
     ========================================================================= */
  const GOOGLE_CLIENT_ID = window.KM_GOOGLE_CLIENT_ID || "";
  // Convenience-only, client-side allowlist for showing a friendly error.
  // THIS IS NOT A SECURITY BOUNDARY. The Azure Function endpoints must verify
  // the Google ID token server-side and check the email against the real
  // allowlist there — a browser check can always be bypassed.
  const ADMIN_EMAILS = window.KM_ADMIN_EMAILS || [];
  const API_BASE =
    "https://communication-fn.azurewebsites.net/api/KaliMandir?code=ybuYDQDF-EC2Fn0ez0UoT9bA0NCDprTb-rsvlb1GNHmVAzFuzGUvPw==" ||
    null;

  // See index.js for why this exists: API_BASE may already end in "?code=...",
  // so we must compose additional params with "&", never append a path segment.
  function apiUrl(type, params) {
    if (!API_BASE) return null;
    const sep = API_BASE.includes("?") ? "&" : "?";
    let url = `${API_BASE}${sep}type=${encodeURIComponent(type)}`;
    if (params) {
      for (const key in params)
        url += `&${key}=${encodeURIComponent(params[key])}`;
    }
    return url;
  }

  const EMERGENCY_FALLBACK = {
    hours: {
      standard: { open: "8:00 AM", close: "4:00 PM" },
      special: {
        days_en: "Saturday & Tuesday",
        days_hi: "शनिवार व मंगलवार",
        open: "10:00 AM",
        close: "4:00 PM",
        note_en: "",
        note_hi: "",
      },
      notice_en: "",
      notice_hi: "",
    },
    contact: {
      address: "N.M Road, Belabagan, Deoghar, Jharkhand, India – 814112",
      mobile: "+91-9431777784",
    },
    slides: [],
    gallery: [],
    schedule: [],
    samagriLists: [],
    custodians: [],
    bank_details: "",
    qr_image: null,
  };

  // Mutable working copies, edited by the form UI and written out on Save.
  let content = null;
  let currentUser = null;

  /* ---------------- Content load / save ---------------- */
  // See index.js for why this exists: fetch() has no built-in timeout, and a
  // slow/unreachable backend would otherwise hang the admin panel's initial
  // load indefinitely instead of falling back to default content promptly.
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  }

  async function loadDefaults() {
    try {
      const res = await fetchWithTimeout(
        "assets/default-content.json",
        { cache: "no-store" },
        4000,
      );
      if (!res.ok) throw new Error("bad status");
      return await res.json();
    } catch (err) {
      console.warn("Falling back to emergency inline content.", err);
      return EMERGENCY_FALLBACK;
    }
  }

  async function loadContent() {
    let base = await loadDefaults();
    if (API_BASE) {
      try {
        const res = await fetchWithTimeout(
          apiUrl("content"),
          { cache: "no-store" },
          4000,
        );
        if (res.ok) base = { ...base, ...(await res.json()) };
      } catch (err) {
        console.warn(
          "Content API unavailable or slow, editing default content.",
          err,
        );
      }
    }
    try {
      const local = JSON.parse(
        localStorage.getItem("km_content_override") || "null",
      );
      if (local) base = { ...base, ...local };
    } catch (err) {
      /* ignore */
    }
    return base;
  }

  /* Uploads a data-URL image to the Media function when the backend is
     configured, returning a real hosted URL. Falls back to the data URL
     itself when no backend is configured yet, so the admin panel still
     works fully offline for local preview — same fallback-first pattern
     used everywhere else. */
  async function uploadImage(dataUrl, filename, contentType) {
    if (!API_BASE || !currentUser || !currentUser.idToken) return dataUrl;
    try {
      const res = await fetchWithTimeout(
        apiUrl("media"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentUser.idToken}`,
          },
          body: JSON.stringify({ filename, contentType, dataBase64: dataUrl }),
        },
        20000,
      );
      if (!res.ok) throw new Error("upload failed");
      const data = await res.json();
      // The function returns just a filename; we build the fetchable URL
      // ourselves since we already know API_BASE (including the function key).
      return data.filename ? apiUrl("media", { file: data.filename }) : dataUrl;
    } catch (err) {
      console.warn(
        "Media upload failed, falling back to inline image for local preview.",
        err,
      );
      return dataUrl;
    }
  }

  async function persist(partial) {
    const existing = JSON.parse(
      localStorage.getItem("km_content_override") || "{}",
    );
    const merged = { ...existing, ...partial };
    localStorage.setItem("km_content_override", JSON.stringify(merged));
    content = { ...content, ...partial };

    if (API_BASE) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (currentUser && currentUser.idToken)
          headers["Authorization"] = `Bearer ${currentUser.idToken}`;
        await fetchWithTimeout(
          apiUrl("content"),
          { method: "POST", headers, body: JSON.stringify(partial) },
          8000,
        );
      } catch (err) {
        console.warn("Could not sync to backend, saved locally only.", err);
      }
    }
  }

  function flashSaved(key) {
    const el = document.querySelector(`[data-status="${key}"]`);
    if (!el) return;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }

  /* ---------------- Theme switcher ---------------- */
  const THEMES = [
    "dark",
    "dusk",
    "marigold",
    "sandstone",
    "royal-purple",
    "lotus",
  ];
  function initTheme() {
    const html = document.documentElement;
    const saved = localStorage.getItem("km_theme");
    const theme = THEMES.includes(saved) ? saved : "dark";
    html.setAttribute("data-theme", theme);

    const switchEl = document.getElementById("themeSwitch");
    if (!switchEl) return;
    const btn = document.getElementById("themeBtn");
    const options = switchEl.querySelectorAll(".theme-option");

    function setActive(t) {
      options.forEach((o) =>
        o.classList.toggle("active", o.dataset.themeOpt === t),
      );
    }
    setActive(theme);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      switchEl.classList.toggle("open");
    });
    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        const t = opt.dataset.themeOpt;
        html.setAttribute("data-theme", t);
        localStorage.setItem("km_theme", t);
        setActive(t);
        switchEl.classList.remove("open");
      });
    });
    document.addEventListener("click", (e) => {
      if (!switchEl.contains(e.target)) switchEl.classList.remove("open");
    });
  }

  /* ---------------- Auth ---------------- */
  function decodeJwt(token) {
    try {
      const payload = token.split(".")[1];
      return JSON.parse(
        decodeURIComponent(
          escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))),
        ),
      );
    } catch (err) {
      return null;
    }
  }

  function handleCredentialResponse(response) {
    const payload = decodeJwt(response.credential);
    if (!payload) {
      showAuthError(
        "Could not read the Google sign-in response. Please try again.",
      );
      return;
    }
    if (ADMIN_EMAILS.length && !ADMIN_EMAILS.includes(payload.email)) {
      showAuthError(
        `${payload.email} is not on the temple's admin list. Ask the committee to add this email.`,
      );
      return;
    }
    const user = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      idToken: response.credential,
    };
    sessionStorage.setItem("km_admin_session", JSON.stringify(user));
    enterAdmin(user);
  }

  function showAuthError(msg) {
    const el = document.getElementById("authError");
    el.textContent = msg;
    el.style.display = "block";
  }

  function initGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID) {
      const btn = document.getElementById("googleSignInBtn");
      btn.innerHTML =
        '<p class="hint" style="max-width:36ch;">Google Sign-In isn\'t configured yet — set <code>window.KM_GOOGLE_CLIENT_ID</code> in admin.html with your OAuth Client ID from Google Cloud Console.</p>';
      return;
    }
    if (!window.google || !window.google.accounts) {
      // GIS script may still be loading; retry shortly.
      setTimeout(initGoogleSignIn, 300);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
    });
    google.accounts.id.renderButton(
      document.getElementById("googleSignInBtn"),
      {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "signin_with",
      },
    );
  }

  function enterAdmin(user) {
    currentUser = user;
    document.getElementById("loginScreen").style.display = "none";
    const app = document.getElementById("adminApp");
    app.style.display = "block";
    document.getElementById("userName").textContent = user.name;
    const photo = document.getElementById("userPhoto");
    if (user.picture) {
      photo.src = user.picture;
      photo.style.display = "block";
    } else {
      photo.style.display = "none";
    }
    initApp();
  }

  function signOut() {
    sessionStorage.removeItem("km_admin_session");
    currentUser = null;
    if (window.google && window.google.accounts) {
      try {
        google.accounts.id.disableAutoSelect();
      } catch (err) {
        /* ignore */
      }
    }
    document.getElementById("adminApp").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("authError").style.display = "none";
  }

  function restoreSession() {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("km_admin_session") || "null",
      );
      if (saved) {
        enterAdmin(saved);
        return true;
      }
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  /* ---------------- Tabs ---------------- */
  function initTabs() {
    document.querySelectorAll(".admin-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document
          .querySelectorAll(".admin-tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".admin-panel")
          .forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document
          .querySelector(`.admin-panel[data-panel="${tab.dataset.tab}"]`)
          .classList.add("active");
        if (tab.dataset.tab === "analytics") renderAnalytics();
      });
    });
  }

  /* ---------------- Hours panel (standard + special Sat/Tue) ---------------- */
  function fillHours() {
    const h = content.hours || {};
    const std = h.standard || {};
    const spec = h.special || {};
    document.getElementById("hoursOpen").value = std.open || "";
    document.getElementById("hoursClose").value = std.close || "";
    document.getElementById("specialDaysEn").value = spec.days_en || "";
    document.getElementById("specialDaysHi").value = spec.days_hi || "";
    document.getElementById("specialOpen").value = spec.open || "";
    document.getElementById("specialClose").value = spec.close || "";
    document.getElementById("specialNoteEn").value = spec.note_en || "";
    document.getElementById("specialNoteHi").value = spec.note_hi || "";
    document.getElementById("noticeEn").value = h.notice_en || "";
    document.getElementById("noticeHi").value = h.notice_hi || "";
  }
  function saveHours() {
    const hours = {
      standard: {
        open: document.getElementById("hoursOpen").value.trim(),
        close: document.getElementById("hoursClose").value.trim(),
      },
      special: {
        days_en: document.getElementById("specialDaysEn").value.trim(),
        days_hi: document.getElementById("specialDaysHi").value.trim(),
        open: document.getElementById("specialOpen").value.trim(),
        close: document.getElementById("specialClose").value.trim(),
        note_en: document.getElementById("specialNoteEn").value.trim(),
        note_hi: document.getElementById("specialNoteHi").value.trim(),
      },
      notice_en: document.getElementById("noticeEn").value.trim(),
      notice_hi: document.getElementById("noticeHi").value.trim(),
    };
    persist({ hours });
    flashSaved("hours");
  }

  /* ---------------- Schedule panel (repeatable) ---------------- */
  let scheduleData = [];
  function renderScheduleItems() {
    const wrap = document.getElementById("scheduleItems");
    wrap.innerHTML =
      scheduleData
        .map(
          (it, i) => `<div class="repeat-item" data-i="${i}">
          <button class="remove-btn" data-remove-schedule="${i}" title="Remove">×</button>
          <div class="field-row">
            <div class="field"><label>Date — English</label><input type="text" data-s="date_en" data-i="${i}" value="${escapeAttr(it.date_en)}"></div>
            <div class="field"><label>Date — Hindi</label><input type="text" data-s="date_hi" data-i="${i}" value="${escapeAttr(it.date_hi)}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Title — English</label><input type="text" data-s="title_en" data-i="${i}" value="${escapeAttr(it.title_en)}"></div>
            <div class="field"><label>Title — Hindi</label><input type="text" data-s="title_hi" data-i="${i}" value="${escapeAttr(it.title_hi)}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Description — English</label><textarea data-s="desc_en" data-i="${i}">${escapeHtml(it.desc_en)}</textarea></div>
            <div class="field"><label>Description — Hindi</label><textarea data-s="desc_hi" data-i="${i}">${escapeHtml(it.desc_hi)}</textarea></div>
          </div>
        </div>`,
        )
        .join("") ||
      '<p class="hint">No festival dates yet — add the first one below.</p>';
  }
  function saveSchedule() {
    persist({ schedule: scheduleData });
    flashSaved("schedule");
  }

  /* ---------------- Samagri panel: multiple lists, each with its own items ---------------- */
  let samagriListsData = [];

  function slugify(str) {
    return (
      (str || "list")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || `list-${Date.now()}`
    );
  }

  function renderSamagriListsEditor() {
    const wrap = document.getElementById("samagriListsEditor");
    wrap.innerHTML =
      samagriListsData
        .map((list, li) => {
          const itemRows = list.items
            .map(
              (
                it,
                ii,
              ) => `<div class="item-row" data-li="${li}" data-ii="${ii}">
              <input type="text" data-field="en" placeholder="Item — English" value="${escapeAttr(it.en)}">
              <input type="text" data-field="hi" placeholder="Item — Hindi" value="${escapeAttr(it.hi)}">
              <input type="text" data-field="qty" placeholder="Quantity" value="${escapeAttr(it.qty)}">
              <button type="button" class="remove-item-btn" data-remove-item data-li="${li}" data-ii="${ii}" title="Remove item">×</button>
            </div>`,
            )
            .join("");

          return `<div class="list-editor-card" data-li="${li}">
          <div class="list-editor-head">
            <div class="field"><label>List title — English</label><input type="text" data-list-field="title_en" data-li="${li}" value="${escapeAttr(list.title_en)}"></div>
            <div class="field"><label>List title — Hindi</label><input type="text" data-list-field="title_hi" data-li="${li}" value="${escapeAttr(list.title_hi)}"></div>
            <button type="button" class="remove-list-btn" data-remove-list="${li}">Remove list</button>
          </div>
          <div class="item-row header-row">
            <span>Item (English)</span><span>Item (Hindi)</span><span>Quantity</span><span></span>
          </div>
          <div data-items-for="${li}">${itemRows}</div>
          <button type="button" class="btn-add-item" data-add-item="${li}">+ Add item to this list</button>
        </div>`;
        })
        .join("") ||
      '<p class="hint">No samagri lists yet — add one below.</p>';
  }

  function saveSamagriLists() {
    persist({ samagriLists: samagriListsData });
    flashSaved("samagri");
  }

  /* ---------------- Hero photo (gallery panel) ---------------- */
  let heroImageData = null;
  function renderHeroImageUpload() {
    const grid = document.getElementById("heroUploadGrid");
    grid.innerHTML = heroImageData
      ? `<div class="upload-item"><img src="${heroImageData}" alt=""><button class="remove-btn" id="removeHeroImage" title="Remove">×</button></div>`
      : '<p class="hint">Using the default hero photo.</p>';
    const removeBtn = document.getElementById("removeHeroImage");
    if (removeBtn)
      removeBtn.addEventListener("click", () => {
        heroImageData = null;
        renderHeroImageUpload();
      });
  }

  /* ---------------- Gallery panel (uploads) ---------------- */
  let galleryData = [];
  function renderGalleryUploads() {
    const grid = document.getElementById("galleryUploadGrid");
    grid.innerHTML = galleryData
      .map(
        (g, i) => `<div class="upload-item">
          ${g.image ? `<img src="${g.image}" alt="">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:0.7rem;text-align:center;padding:6px;">${escapeHtml(g.caption_en || "photo")}</div>`}
          <button class="remove-btn" data-remove-gallery="${i}" title="Remove">×</button>
        </div>`,
      )
      .join("");
  }
  function handleGalleryFiles(fileList) {
    const files = Array.from(fileList).slice(0, 12);
    let pending = files.length;
    if (!pending) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const localDataUrl = reader.result;
        const caption = file.name.replace(/\.[^.]+$/, "");
        const idx =
          galleryData.push({
            image: localDataUrl,
            caption_en: caption,
            caption_hi: caption,
          }) - 1;
        pending -= 1;
        if (pending === 0) renderGalleryUploads();
        // Upload in the background and swap in the real hosted URL once ready
        // (only actually calls the network when a backend is configured).
        const hostedUrl = await uploadImage(localDataUrl, file.name, file.type);
        if (galleryData[idx]) {
          galleryData[idx].image = hostedUrl;
          renderGalleryUploads();
        }
      };
      reader.readAsDataURL(file);
    });
  }
  function saveGallery() {
    persist({
      gallery: galleryData,
      hero_image: heroImageData || content.hero_image || null,
    });
    flashSaved("gallery");
  }

  /* ---------------- Custodians panel (2 fixed temple-committee people) ---------------- */
  let custodiansData = [];
  function renderCustodiansEditor() {
    const wrap = document.getElementById("custodiansEditor");
    wrap.innerHTML = custodiansData
      .map(
        (c, i) => `<div class="custodian-editor-card" data-ci="${i}">
          <div class="upload-grid" data-custodian-photo="${i}">
            ${
              c.photo
                ? `<div class="upload-item"><img src="${c.photo}" alt=""><button class="remove-btn" data-remove-custodian-photo="${i}" title="Remove">×</button></div>`
                : `<label class="upload-drop" style="padding:14px;font-size:0.72rem;"><input type="file" accept="image/*" data-custodian-file="${i}" style="display:none;">Add photo</label>`
            }
          </div>
          <div class="field" style="margin-bottom:10px;"><label>Name</label><input type="text" data-cust-field="name" data-ci="${i}" value="${escapeAttr(c.name)}"></div>
          <div class="field-row">
            <div class="field"><label>Role — English</label><input type="text" data-cust-field="role_en" data-ci="${i}" value="${escapeAttr(c.role_en)}"></div>
            <div class="field"><label>Role — Hindi</label><input type="text" data-cust-field="role_hi" data-ci="${i}" value="${escapeAttr(c.role_hi)}"></div>
          </div>
        </div>`,
      )
      .join("");

    wrap.querySelectorAll("[data-custodian-file]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const i = Number(input.dataset.custodianFile);
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          custodiansData[i].photo = reader.result;
          renderCustodiansEditor();
          const hostedUrl = await uploadImage(
            reader.result,
            file.name,
            file.type,
          );
          custodiansData[i].photo = hostedUrl;
        };
        reader.readAsDataURL(file);
      });
    });
    wrap.querySelectorAll("[data-remove-custodian-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        custodiansData[Number(btn.dataset.removeCustodianPhoto)].photo = null;
        renderCustodiansEditor();
      });
    });
  }
  function saveCustodians() {
    /* included in saveDonations, see below */
  }

  /* ---------------- Donations / contact panel ---------------- */
  let qrData = null;
  function fillDonations() {
    document.getElementById("contactAddress").value =
      content.contact?.address || "";
    document.getElementById("contactMobile").value =
      content.contact?.mobile || "";
    document.getElementById("bankDetails").value = content.bank_details || "";
    qrData = content.qr_image || null;
    renderQrUpload();
  }
  function renderQrUpload() {
    const grid = document.getElementById("qrUploadGrid");
    grid.innerHTML = qrData
      ? `<div class="upload-item"><img src="${qrData}" alt=""><button class="remove-btn" id="removeQr" title="Remove">×</button></div>`
      : '<p class="hint">No custom QR uploaded — the site shows a placeholder QR graphic.</p>';
    const removeBtn = document.getElementById("removeQr");
    if (removeBtn)
      removeBtn.addEventListener("click", () => {
        qrData = null;
        renderQrUpload();
      });
  }
  function saveDonations() {
    const donations = {
      contact: {
        address: document.getElementById("contactAddress").value.trim(),
        mobile: document.getElementById("contactMobile").value.trim(),
      },
      bank_details: document.getElementById("bankDetails").value.trim(),
      qr_image: qrData,
      custodians: custodiansData,
    };
    persist(donations);
    flashSaved("donations");
  }

  /* ---------------- Analytics panel ---------------- */
  async function fetchBackendAnalytics() {
    if (!API_BASE || !currentUser || !currentUser.idToken) return null;
    try {
      const res = await fetchWithTimeout(
        apiUrl("analytics"),
        {
          headers: { Authorization: `Bearer ${currentUser.idToken}` },
        },
        6000,
      );
      if (!res.ok) return null;
      return await res.json(); // { views: {total, byDay, byPath}, visitors: {total, newVisitors, repeatVisitors, byCountry, byState, byCity, recent} }
    } catch (err) {
      console.warn(
        "Could not load backend analytics, showing local demo log instead.",
        err,
      );
      return null;
    }
  }

  function renderGeoList(elId, counts) {
    const el = document.getElementById(elId);
    const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
    el.innerHTML = entries.length
      ? entries
          .map(
            ([name, count]) =>
              `<div class="geo-row"><span class="name">${escapeHtml(name)}</span><span class="count">${count}</span></div>`,
          )
          .join("")
      : '<p class="hint">No data yet.</p>';
  }

  function formatVisitTime(iso) {
    if (!iso) return "–";
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (err) {
      return iso;
    }
  }

  function renderRecentVisitors(recent) {
    const body = document.getElementById("recentVisitorsBody");
    if (!recent || !recent.length) {
      body.innerHTML =
        '<tr><td colspan="4"><span class="hint">No visitors recorded yet.</span></td></tr>';
      return;
    }
    body.innerHTML = recent
      .map((v) => {
        const location =
          [v.city, v.state, v.country]
            .filter((x) => x && x !== "Unknown")
            .join(", ") || "Unknown";
        return `<tr>
          <td>${escapeHtml(v.ip || "–")}</td>
          <td>${escapeHtml(location)}</td>
          <td class="qty-col">${v.visitCount || 1}</td>
          <td class="qty-col">${formatVisitTime(v.lastVisit)}</td>
        </tr>`;
      })
      .join("");
  }

  function renderVisitorStats(visitors) {
    if (visitors) {
      document.getElementById("statVisitorsTotal").textContent =
        visitors.total ?? 0;
      document.getElementById("statVisitorsNew").textContent =
        visitors.newVisitors ?? 0;
      document.getElementById("statVisitorsRepeat").textContent =
        visitors.repeatVisitors ?? 0;
      renderGeoList("byCountryList", visitors.byCountry);
      renderGeoList("byStateList", visitors.byState);
      renderGeoList("byCityList", visitors.byCity);
      renderRecentVisitors(visitors.recent);
    } else {
      // No backend connected — visitor/geo data can only come from the server
      // (geo-IP lookup has to happen server-side), so there's no meaningful
      // local-preview equivalent the way page-views has. Show a clear reason
      // rather than fake zeros.
      ["statVisitorsTotal", "statVisitorsNew", "statVisitorsRepeat"].forEach(
        (id) => {
          document.getElementById(id).textContent = "–";
        },
      );
      const note =
        '<p class="hint">Connect the Azure backend to see visitor location data.</p>';
      document.getElementById("byCountryList").innerHTML = note;
      document.getElementById("byStateList").innerHTML = "";
      document.getElementById("byCityList").innerHTML = "";
      document.getElementById("recentVisitorsBody").innerHTML =
        `<tr><td colspan="4">${note}</td></tr>`;
    }
  }

  async function renderAnalytics() {
    const backend = await fetchBackendAnalytics();
    const log = backend
      ? backend.views.byDay
      : JSON.parse(localStorage.getItem("km_analytics") || "{}");
    const source = backend ? "live" : "local";

    const days = Object.keys(log).sort().slice(-14);
    const total = backend
      ? backend.views.total
      : Object.values(log).reduce((a, b) => a + b, 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const today = log[todayKey] || 0;
    const last14Sum = days.reduce((sum, d) => sum + log[d], 0);
    const avg = days.length ? Math.round(last14Sum / days.length) : 0;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statToday").textContent = today;
    document.getElementById("statAvg").textContent = avg;

    const max = Math.max(1, ...days.map((d) => log[d]));
    const bars = document.getElementById("analyticsBars");
    const sourceNote = `<p class="hint" style="margin-bottom:12px;">${source === "live" ? "Live data from the Azure backend, all visitors." : "Local demo data — this browser only. Connect the Azure backend for real site-wide analytics."}</p>`;
    bars.innerHTML =
      sourceNote +
      (days.length
        ? days
            .map(
              (d) => `<div class="bar-row">
                <span class="day">${d}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${(log[d] / max) * 100}%"></span></span>
                <span class="count">${log[d]}</span>
              </div>`,
            )
            .join("")
        : '<p class="hint">No visits logged yet. Open index.html a few times to see demo data here.</p>');

    renderVisitorStats(backend ? backend.visitors : null);
  }

  /* ---------------- Helpers ---------------- */
  function escapeHtml(str) {
    return (str || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }

  /* ---------------- Wire up all interactions ---------------- */
  function initApp() {
    fillHours();
    scheduleData = JSON.parse(JSON.stringify(content.schedule || []));
    samagriListsData = JSON.parse(JSON.stringify(content.samagriLists || []));
    galleryData = JSON.parse(JSON.stringify(content.gallery || []));
    custodiansData = JSON.parse(
      JSON.stringify(
        content.custodians && content.custodians.length === 2
          ? content.custodians
          : [
              { name: "", role_en: "", role_hi: "", photo: null },
              { name: "", role_en: "", role_hi: "", photo: null },
            ],
      ),
    );
    heroImageData = content.hero_image || null;
    renderScheduleItems();
    renderSamagriListsEditor();
    renderGalleryUploads();
    renderHeroImageUpload();
    renderCustodiansEditor();
    fillDonations();

    document
      .querySelector('[data-save="hours"]')
      .addEventListener("click", saveHours);
    document
      .querySelector('[data-save="schedule"]')
      .addEventListener("click", saveSchedule);
    document
      .querySelector('[data-save="samagri"]')
      .addEventListener("click", saveSamagriLists);
    document
      .querySelector('[data-save="gallery"]')
      .addEventListener("click", saveGallery);
    document
      .querySelector('[data-save="donations"]')
      .addEventListener("click", saveDonations);

    document.getElementById("addScheduleItem").addEventListener("click", () => {
      scheduleData.push({
        date_en: "",
        date_hi: "",
        title_en: "",
        title_hi: "",
        desc_en: "",
        desc_hi: "",
      });
      renderScheduleItems();
    });
    document.getElementById("scheduleItems").addEventListener("input", (e) => {
      const el = e.target.closest("[data-s]");
      if (!el) return;
      scheduleData[el.dataset.i][el.dataset.s] = el.value;
    });
    document.getElementById("scheduleItems").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-schedule]");
      if (!btn) return;
      scheduleData.splice(Number(btn.dataset.removeSchedule), 1);
      renderScheduleItems();
    });

    // Samagri: add list / add item / edit item / remove item / remove list
    document.getElementById("addSamagriList").addEventListener("click", () => {
      const title_en = `New List ${samagriListsData.length + 1}`;
      samagriListsData.push({
        id: slugify(title_en),
        title_en,
        title_hi: "",
        items: [{ en: "", hi: "", qty: "" }],
      });
      renderSamagriListsEditor();
    });
    const listsEditor = document.getElementById("samagriListsEditor");
    listsEditor.addEventListener("input", (e) => {
      const listField = e.target.closest("[data-list-field]");
      if (listField) {
        const li = Number(listField.dataset.li);
        samagriListsData[li][listField.dataset.listField] = listField.value;
        if (listField.dataset.listField === "title_en")
          samagriListsData[li].id = slugify(listField.value);
        return;
      }
      const itemRow = e.target.closest("[data-field]");
      if (itemRow) {
        const li = Number(itemRow.closest("[data-li]").dataset.li);
        const ii = Number(itemRow.closest("[data-ii]").dataset.ii);
        samagriListsData[li].items[ii][itemRow.dataset.field] = itemRow.value;
      }
    });
    listsEditor.addEventListener("click", (e) => {
      const addItemBtn = e.target.closest("[data-add-item]");
      if (addItemBtn) {
        samagriListsData[Number(addItemBtn.dataset.addItem)].items.push({
          en: "",
          hi: "",
          qty: "",
        });
        renderSamagriListsEditor();
        return;
      }
      const removeItemBtn = e.target.closest("[data-remove-item]");
      if (removeItemBtn) {
        samagriListsData[Number(removeItemBtn.dataset.li)].items.splice(
          Number(removeItemBtn.dataset.ii),
          1,
        );
        renderSamagriListsEditor();
        return;
      }
      const removeListBtn = e.target.closest("[data-remove-list]");
      if (removeListBtn) {
        samagriListsData.splice(Number(removeListBtn.dataset.removeList), 1);
        renderSamagriListsEditor();
      }
    });

    document
      .getElementById("galleryFileInput")
      .addEventListener("change", (e) => handleGalleryFiles(e.target.files));
    document.getElementById("heroFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        heroImageData = reader.result;
        renderHeroImageUpload();
        heroImageData = await uploadImage(reader.result, file.name, file.type);
      };
      reader.readAsDataURL(file);
    });
    document
      .getElementById("galleryUploadGrid")
      .addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove-gallery]");
        if (!btn) return;
        galleryData.splice(Number(btn.dataset.removeGallery), 1);
        renderGalleryUploads();
      });

    document.getElementById("qrFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        qrData = reader.result;
        renderQrUpload();
        qrData = await uploadImage(reader.result, file.name, file.type);
      };
      reader.readAsDataURL(file);
    });

    // Custodian text fields (name/role) — photo handled inside renderCustodiansEditor
    document
      .getElementById("custodiansEditor")
      .addEventListener("input", (e) => {
        const el = e.target.closest("[data-cust-field]");
        if (!el) return;
        custodiansData[Number(el.dataset.ci)][el.dataset.custField] = el.value;
      });

    renderAnalytics();
  }

  /* ---------------- Boot ---------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    content = await loadContent();
    initTabs();
    document.getElementById("signOutBtn").addEventListener("click", signOut);

    if (!restoreSession()) {
      initGoogleSignIn();
    }
  });
})();

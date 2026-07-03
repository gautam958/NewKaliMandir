/* admin.js — logic for admin.html ONLY (per architecture: one JS file per page) */
(function () {
  "use strict";

  /* =========================================================================
     CONFIG
     Set these two values once real credentials exist. Until KM_GOOGLE_CLIENT_ID
     is set, the real Google Sign-In button cannot render, and only "Demo mode"
     is available to preview the CMS.
     ========================================================================= */
  const GOOGLE_CLIENT_ID = window.KM_GOOGLE_CLIENT_ID || "";
  // Convenience-only, client-side allowlist for showing a friendly error.
  // THIS IS NOT A SECURITY BOUNDARY. The Azure Function endpoints must verify
  // the Google ID token server-side and check the email against the real
  // allowlist there — a browser check can always be bypassed.
  const ADMIN_EMAILS = window.KM_ADMIN_EMAILS || [];
  const API_BASE = window.KALI_MANDIR_API_BASE || null;

  const EMERGENCY_FALLBACK = {
    hours: { open: "8:00 AM", close: "4:00 PM", notice_en: "", notice_hi: "" },
    contact: { address: "N.M Road, Belabagan, Deoghar, Jharkhand, India – 814112", mobile: "+91-9431777784" },
    slides: [], gallery: [], schedule: [], samagri: [], bank_details: "", qr_image: null
  };

  // Mutable working copies, edited by the form UI and written out on Save.
  let content = null;
  let currentUser = null;

  /* ---------------- Content load / save ---------------- */
  async function loadDefaults() {
    try {
      const res = await fetch("assets/default-content.json", { cache: "no-store" });
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
        const res = await fetch(`${API_BASE}/content`, { cache: "no-store" });
        if (res.ok) base = { ...base, ...(await res.json()) };
      } catch (err) {
        console.warn("Content API unavailable, editing default content.", err);
      }
    }
    try {
      const local = JSON.parse(localStorage.getItem("km_content_override") || "null");
      if (local) base = { ...base, ...local };
    } catch (err) { /* ignore */ }
    return base;
  }

  async function persist(partial) {
    const existing = JSON.parse(localStorage.getItem("km_content_override") || "{}");
    const merged = { ...existing, ...partial };
    localStorage.setItem("km_content_override", JSON.stringify(merged));
    content = { ...content, ...partial };

    if (API_BASE) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (currentUser && currentUser.idToken) headers["Authorization"] = `Bearer ${currentUser.idToken}`;
        await fetch(`${API_BASE}/content`, { method: "POST", headers, body: JSON.stringify(partial) });
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

  /* ---------------- Auth ---------------- */
  function decodeJwt(token) {
    try {
      const payload = token.split(".")[1];
      return JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))));
    } catch (err) {
      return null;
    }
  }

  function handleCredentialResponse(response) {
    const payload = decodeJwt(response.credential);
    if (!payload) {
      showAuthError("Could not read the Google sign-in response. Please try again.");
      return;
    }
    if (ADMIN_EMAILS.length && !ADMIN_EMAILS.includes(payload.email)) {
      showAuthError(`${payload.email} is not on the temple's admin list. Ask the committee to add this email.`);
      return;
    }
    const user = { name: payload.name, email: payload.email, picture: payload.picture, idToken: response.credential, demo: false };
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
      btn.innerHTML = '<p class="hint" style="max-width:36ch;">Google Sign-In isn\'t configured yet — set <code>window.KM_GOOGLE_CLIENT_ID</code> in admin.html with your OAuth Client ID from Google Cloud Console.</p>';
      return;
    }
    if (!window.google || !window.google.accounts) {
      // GIS script may still be loading; retry shortly.
      setTimeout(initGoogleSignIn, 300);
      return;
    }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
    google.accounts.id.renderButton(document.getElementById("googleSignInBtn"), {
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with"
    });
  }

  function enterAdmin(user) {
    currentUser = user;
    document.getElementById("loginScreen").style.display = "none";
    const app = document.getElementById("adminApp");
    app.style.display = "block";
    document.getElementById("userName").textContent = user.demo ? `${user.name} (demo)` : user.name;
    const photo = document.getElementById("userPhoto");
    if (user.picture) { photo.src = user.picture; photo.style.display = "block"; } else { photo.style.display = "none"; }
    if (!API_BASE) {
      document.getElementById("backendStatus").textContent =
        "No Azure Functions API configured yet — changes save to this browser only (local preview mode). Deploy /azure-functions and set window.KALI_MANDIR_API_BASE to sync edits to the live site.";
    }
    initApp();
  }

  function signOut() {
    sessionStorage.removeItem("km_admin_session");
    currentUser = null;
    if (window.google && window.google.accounts) {
      try { google.accounts.id.disableAutoSelect(); } catch (err) { /* ignore */ }
    }
    document.getElementById("adminApp").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("authError").style.display = "none";
  }

  function restoreSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem("km_admin_session") || "null");
      if (saved) { enterAdmin(saved); return true; }
    } catch (err) { /* ignore */ }
    return false;
  }

  /* ---------------- Tabs ---------------- */
  function initTabs() {
    document.querySelectorAll(".admin-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.querySelector(`.admin-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
        if (tab.dataset.tab === "analytics") renderAnalytics();
      });
    });
  }

  /* ---------------- Hours panel ---------------- */
  function fillHours() {
    document.getElementById("hoursOpen").value = content.hours?.open || "";
    document.getElementById("hoursClose").value = content.hours?.close || "";
    document.getElementById("noticeEn").value = content.hours?.notice_en || "";
    document.getElementById("noticeHi").value = content.hours?.notice_hi || "";
  }
  function saveHours() {
    const hours = {
      open: document.getElementById("hoursOpen").value.trim(),
      close: document.getElementById("hoursClose").value.trim(),
      notice_en: document.getElementById("noticeEn").value.trim(),
      notice_hi: document.getElementById("noticeHi").value.trim()
    };
    persist({ hours });
    flashSaved("hours");
  }

  /* ---------------- Schedule panel (repeatable) ---------------- */
  let scheduleData = [];
  function renderScheduleItems() {
    const wrap = document.getElementById("scheduleItems");
    wrap.innerHTML = scheduleData
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
        </div>`
      )
      .join("") || '<p class="hint">No festival dates yet — add the first one below.</p>';
  }
  function saveSchedule() { persist({ schedule: scheduleData }); flashSaved("schedule"); }

  /* ---------------- Samagri panel (repeatable) ---------------- */
  let samagriData = [];
  function renderSamagriItems() {
    const wrap = document.getElementById("samagriItems");
    wrap.innerHTML = samagriData
      .map(
        (it, i) => `<div class="repeat-item" data-i="${i}">
          <button class="remove-btn" data-remove-samagri="${i}" title="Remove">×</button>
          <div class="field-row">
            <div class="field"><label>Item — English</label><input type="text" data-sg="en" data-i="${i}" value="${escapeAttr(it.en)}"></div>
            <div class="field"><label>Item — Hindi</label><input type="text" data-sg="hi" data-i="${i}" value="${escapeAttr(it.hi)}"></div>
          </div>
        </div>`
      )
      .join("") || '<p class="hint">List is empty — add the first item below.</p>';
  }
  function saveSamagri() { persist({ samagri: samagriData }); flashSaved("samagri"); }

  /* ---------------- Hero photo (gallery panel) ---------------- */
  let heroImageData = null;
  function renderHeroImageUpload() {
    const grid = document.getElementById("heroUploadGrid");
    grid.innerHTML = heroImageData
      ? `<div class="upload-item"><img src="${heroImageData}" alt=""><button class="remove-btn" id="removeHeroImage" title="Remove">×</button></div>`
      : '<p class="hint">Using the default hero photo.</p>';
    const removeBtn = document.getElementById("removeHeroImage");
    if (removeBtn) removeBtn.addEventListener("click", () => { heroImageData = null; renderHeroImageUpload(); });
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
        </div>`
      )
      .join("");
  }
  function handleGalleryFiles(fileList) {
    const files = Array.from(fileList).slice(0, 12);
    let pending = files.length;
    if (!pending) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        galleryData.push({ image: reader.result, caption_en: file.name.replace(/\.[^.]+$/, ""), caption_hi: file.name.replace(/\.[^.]+$/, "") });
        pending -= 1;
        if (pending === 0) renderGalleryUploads();
      };
      reader.readAsDataURL(file);
    });
  }
  function saveGallery() { persist({ gallery: galleryData, hero_image: heroImageData || content.hero_image || null }); flashSaved("gallery"); }

  /* ---------------- Donations / contact panel ---------------- */
  let qrData = null;
  function fillDonations() {
    document.getElementById("contactAddress").value = content.contact?.address || "";
    document.getElementById("contactMobile").value = content.contact?.mobile || "";
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
    if (removeBtn) removeBtn.addEventListener("click", () => { qrData = null; renderQrUpload(); });
  }
  function saveDonations() {
    const donations = {
      contact: {
        address: document.getElementById("contactAddress").value.trim(),
        mobile: document.getElementById("contactMobile").value.trim()
      },
      bank_details: document.getElementById("bankDetails").value.trim(),
      qr_image: qrData
    };
    persist(donations);
    flashSaved("donations");
  }

  /* ---------------- Analytics panel ---------------- */
  async function fetchBackendAnalytics() {
    if (!API_BASE || !currentUser || !currentUser.idToken) return null;
    try {
      const res = await fetch(`${API_BASE}/analytics`, {
        headers: { Authorization: `Bearer ${currentUser.idToken}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.byDay || null; // { "2026-06-20": 14, ... }
    } catch (err) {
      console.warn("Could not load backend analytics, showing local demo log instead.", err);
      return null;
    }
  }

  async function renderAnalytics() {
    const backendLog = await fetchBackendAnalytics();
    const log = backendLog || JSON.parse(localStorage.getItem("km_analytics") || "{}");
    const source = backendLog ? "live" : "local";

    const days = Object.keys(log).sort().slice(-14);
    const total = Object.values(log).reduce((a, b) => a + b, 0);
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
              </div>`
            )
            .join("")
        : '<p class="hint">No visits logged yet. Open index.html a few times to see demo data here.</p>');
  }

  /* ---------------- Helpers ---------------- */
  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  /* ---------------- Wire up all interactions ---------------- */
  function initApp() {
    fillHours();
    scheduleData = JSON.parse(JSON.stringify(content.schedule || []));
    samagriData = JSON.parse(JSON.stringify(content.samagri || []));
    galleryData = JSON.parse(JSON.stringify(content.gallery || []));
    heroImageData = content.hero_image || null;
    renderScheduleItems();
    renderSamagriItems();
    renderGalleryUploads();
    renderHeroImageUpload();
    fillDonations();

    document.querySelector('[data-save="hours"]').addEventListener("click", saveHours);
    document.querySelector('[data-save="schedule"]').addEventListener("click", saveSchedule);
    document.querySelector('[data-save="samagri"]').addEventListener("click", saveSamagri);
    document.querySelector('[data-save="gallery"]').addEventListener("click", saveGallery);
    document.querySelector('[data-save="donations"]').addEventListener("click", saveDonations);

    document.getElementById("addScheduleItem").addEventListener("click", () => {
      scheduleData.push({ date_en: "", date_hi: "", title_en: "", title_hi: "", desc_en: "", desc_hi: "" });
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

    document.getElementById("addSamagriItem").addEventListener("click", () => {
      samagriData.push({ en: "", hi: "" });
      renderSamagriItems();
    });
    document.getElementById("samagriItems").addEventListener("input", (e) => {
      const el = e.target.closest("[data-sg]");
      if (!el) return;
      samagriData[el.dataset.i][el.dataset.sg] = el.value;
    });
    document.getElementById("samagriItems").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-samagri]");
      if (!btn) return;
      samagriData.splice(Number(btn.dataset.removeSamagri), 1);
      renderSamagriItems();
    });

    document.getElementById("galleryFileInput").addEventListener("change", (e) => handleGalleryFiles(e.target.files));
    document.getElementById("heroFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { heroImageData = reader.result; renderHeroImageUpload(); };
      reader.readAsDataURL(file);
    });
    document.getElementById("galleryUploadGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-gallery]");
      if (!btn) return;
      galleryData.splice(Number(btn.dataset.removeGallery), 1);
      renderGalleryUploads();
    });

    document.getElementById("qrFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { qrData = reader.result; renderQrUpload(); };
      reader.readAsDataURL(file);
    });

    renderAnalytics();
  }

  /* ---------------- Boot ---------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    content = await loadContent();
    initTabs();
    document.getElementById("signOutBtn").addEventListener("click", signOut);
    document.getElementById("demoModeBtn").addEventListener("click", () => {
      const user = { name: "Demo Admin", email: "demo@local.preview", picture: "", idToken: null, demo: true };
      sessionStorage.setItem("km_admin_session", JSON.stringify(user));
      enterAdmin(user);
    });

    if (!restoreSession()) {
      initGoogleSignIn();
    }
  });
})();

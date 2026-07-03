/* index.js — logic for index.html ONLY (per architecture: one JS file per page) */
(function () {
  "use strict";

  // Absolute minimum inline fallback, used only if assets/default-content.json
  // itself fails to load (e.g. no network at all). Real defaults live there.
  const EMERGENCY_FALLBACK = {
    hours: { open: "8:00 AM", close: "4:00 PM", notice_en: "", notice_hi: "" },
    contact: { address: "N.M Road, Belabagan, Deoghar, Jharkhand, India – 814112", mobile: "+91-9431777784" },
    slides: [], gallery: [], schedule: [], samagri: [], bank_details: "", qr_image: null
  };

  // Azure Functions content API base — set this once the backend is deployed.
  const API_BASE = window.KALI_MANDIR_API_BASE || null; // e.g. "https://kalimandir-func.azurewebsites.net/api"

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
        if (!res.ok) throw new Error("bad status");
        base = { ...base, ...(await res.json()) };
      } catch (err) {
        console.warn("Content API unavailable, using default content.", err);
      }
    }
    // Local admin-panel edits (used until the Azure backend is deployed / for local preview)
    try {
      const local = JSON.parse(localStorage.getItem("km_content_override") || "null");
      if (local) base = { ...base, ...local };
    } catch (err) { /* ignore malformed local data */ }
    return base;
  }

  /* ---------------- Language toggle ---------------- */
  function initLanguage() {
    const html = document.documentElement;
    const saved = localStorage.getItem("km_lang") || "en";
    html.setAttribute("data-lang", saved);
    document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.langBtn === saved);
      btn.addEventListener("click", () => {
        const lang = btn.dataset.langBtn;
        html.setAttribute("data-lang", lang);
        localStorage.setItem("km_lang", lang);
        document.querySelectorAll("[data-lang-btn]").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  /* ---------------- Scroll-spy nav ---------------- */
  function initScrollSpy() {
    const links = Array.from(document.querySelectorAll(".diya-nav a"));
    const sections = links
      .map((l) => document.getElementById(l.dataset.target))
      .filter(Boolean);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            links.forEach((l) => l.classList.toggle("active", l.dataset.target === id));
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
  }

  /* ---------------- Fade-in on scroll ---------------- */
  function initFadeIns() {
    document.querySelectorAll(".section, .hero").forEach((el) => el.classList.add("fade-in"));
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in-view")),
      { threshold: 0.08 }
    );
    document.querySelectorAll(".fade-in").forEach((el) => io.observe(el));
  }

  /* ---------------- Renderers ---------------- */
  function renderSlider(slides) {
    const track = document.getElementById("sliderTrack");
    if (!track || !slides.length) return;
    const doubled = slides.concat(slides); // seamless loop
    track.innerHTML = doubled
      .map(
        (s) => `<div class="tile" style="background-image:${s.image ? `url('${s.image}')` : "none"};background:${s.image ? "" : s.color}">
          <span lang-el="en">${s.label_en}</span><span lang-el="hi">${s.label_hi}</span>
        </div>`
      )
      .join("");
  }

  function renderGallery(items) {
    const grid = document.getElementById("galleryGrid");
    if (!grid) return;
    grid.innerHTML = items
      .map(
        (g) => `<div class="g-item" style="${g.image ? `background-image:url('${g.image}')` : ""}">
          <span class="cap"><span lang-el="en">${g.caption_en}</span><span lang-el="hi">${g.caption_hi}</span></span>
        </div>`
      )
      .join("");
  }

  function renderSchedule(items) {
    const wrap = document.getElementById("scheduleTimeline");
    if (!wrap) return;
    wrap.innerHTML = items
      .map(
        (it) => `<div class="t-item">
          <div class="t-date"><span lang-el="en">${it.date_en}</span><span lang-el="hi">${it.date_hi}</span></div>
          <div class="t-title"><span lang-el="en">${it.title_en}</span><span lang-el="hi">${it.title_hi}</span></div>
          <div class="t-desc"><span lang-el="en">${it.desc_en}</span><span lang-el="hi">${it.desc_hi}</span></div>
        </div>`
      )
      .join("");
  }

  function renderSamagri(items) {
    const list = document.getElementById("samagriList");
    if (!list) return;
    const checkedState = JSON.parse(localStorage.getItem("km_samagri_checked") || "{}");
    list.innerHTML = items
      .map((it, i) => {
        const id = `samagri-${i}`;
        const checked = checkedState[i] ? "checked" : "";
        const checkedClass = checkedState[i] ? "checked" : "";
        return `<li>
          <input type="checkbox" id="${id}" data-idx="${i}" ${checked}>
          <label for="${id}" class="${checkedClass}"><span lang-el="en">${it.en}</span><span lang-el="hi">${it.hi}</span></label>
        </li>`;
      })
      .join("");

    list.addEventListener("change", (e) => {
      const cb = e.target.closest("input[type=checkbox]");
      if (!cb) return;
      const idx = cb.dataset.idx;
      const state = JSON.parse(localStorage.getItem("km_samagri_checked") || "{}");
      state[idx] = cb.checked;
      localStorage.setItem("km_samagri_checked", JSON.stringify(state));
      cb.nextElementSibling.classList.toggle("checked", cb.checked);
    });
  }

  function renderHours(hours) {
    const grid = document.getElementById("hoursGrid");
    if (grid && hours.open && hours.close) {
      grid.innerHTML = `<div class="hours-card">
        <span class="eyebrow" lang-el="en">All Days</span><span class="eyebrow" lang-el="hi">सभी दिन</span>
        <div class="time">${hours.open} – ${hours.close}</div>
        <div class="note" lang-el="en">Standard hours. Festival-day timings may vary — check the notice below.</div>
        <div class="note" lang-el="hi">सामान्य समय। पर्व के दिनों का समय भिन्न हो सकता है — नीचे सूचना देखें।</div>
      </div>`;
    }
    const notice = document.getElementById("hoursNotice");
    if (notice && hours.notice_en) {
      const spans = notice.querySelectorAll("p");
      if (spans[0]) spans[0].textContent = hours.notice_en;
      if (spans[1]) spans[1].textContent = hours.notice_hi;
    }
  }

  function renderContact(contact) {
    if (!contact) return;
    // Scoped to the Contact section so the Donations section's own
    // .contact-row elements (Bank Transfer / In Person) are untouched.
    const addrEls = document.querySelectorAll('#contact .contact-row .v');
    if (addrEls[0] && contact.address) addrEls[0].textContent = contact.address;
    if (addrEls[1] && contact.mobile) {
      const link = addrEls[1].querySelector("a");
      if (link) { link.textContent = contact.mobile; link.href = `tel:${contact.mobile.replace(/[^\d+]/g, "")}`; }
    }
    const addrCardEn = document.querySelector('.addr-card [lang-el="en"]');
    const addrCardHi = document.querySelector('.addr-card [lang-el="hi"]');
    if (addrCardEn && contact.address) addrCardEn.textContent = contact.address;
    if (addrCardHi && contact.address) addrCardHi.textContent = contact.address;
  }

  function renderHeroImage(heroImage) {
    if (!heroImage) return;
    const hero = document.querySelector(".hero");
    if (hero) hero.style.setProperty("--hero-image", `url('${heroImage}')`);
  }

  function renderBank(bankDetails) {
    const el = document.getElementById("bankDetails");
    if (el && bankDetails) el.textContent = bankDetails;
  }

  function renderQr(qrImage) {
    if (!qrImage) return;
    const box = document.querySelector(".qr-box svg");
    if (box) {
      const img = document.createElement("img");
      img.src = qrImage;
      img.alt = "Donation QR code";
      img.style.width = "150px";
      img.style.height = "150px";
      img.style.borderRadius = "4px";
      box.replaceWith(img);
    }
  }

  /* ---------------- Lightweight analytics beacon ----------------
     Posts to the Azure Function analytics endpoint if configured;
     always also logs a local demo counter so the Admin dashboard
     has something to show before the backend is deployed. */
  function trackVisit() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const log = JSON.parse(localStorage.getItem("km_analytics") || "{}");
      log[today] = (log[today] || 0) + 1;
      localStorage.setItem("km_analytics", JSON.stringify(log));
    } catch (err) { /* ignore */ }

    if (API_BASE) {
      fetch(`${API_BASE}/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location.pathname, ts: Date.now() }),
        keepalive: true
      }).catch(() => {});
    }
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initLanguage();
    initScrollSpy();
    initFadeIns();
    trackVisit();

    const content = await loadContent();
    renderHeroImage(content.hero_image || null);
    renderSlider(content.slides || []);
    renderGallery(content.gallery || []);
    renderSchedule(content.schedule || []);
    renderSamagri(content.samagri || []);
    renderHours(content.hours || {});
    renderContact(content.contact || {});
    renderBank(content.bank_details || "");
    renderQr(content.qr_image || null);
  });
})();

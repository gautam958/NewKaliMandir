/* index.js — logic for index.html ONLY (per architecture: one JS file per page) */
(function () {
  "use strict";

  // Absolute minimum inline fallback, used only if assets/default-content.json
  // itself fails to load (e.g. no network at all). Real defaults live there.
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

  // Azure Functions content API base — set this once the backend is deployed.
  const API_BASE =
    "https://communication-fn.azurewebsites.net/api/KaliMandir?code=ybuYDQDF-EC2Fn0ez0UoT9bA0NCDprTb-rsvlb1GNHmVAzFuzGUvPw==" ||
    null; // e.g. "https://kalimandir-func.azurewebsites.net/api"

  async function loadDefaults() {
    try {
      const res = await fetch("assets/default-content.json", {
        cache: "no-store",
      });
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
      const local = JSON.parse(
        localStorage.getItem("km_content_override") || "null",
      );
      if (local) base = { ...base, ...local };
    } catch (err) {
      /* ignore malformed local data */
    }
    return base;
  }

  /* ---------------- Theme switcher ---------------- */
  const THEMES = ["dark", "dusk", "marigold", "sandstone"];
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
        document
          .querySelectorAll("[data-lang-btn]")
          .forEach((b) => b.classList.toggle("active", b === btn));
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
            links.forEach((l) =>
              l.classList.toggle("active", l.dataset.target === id),
            );
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 },
    );
    sections.forEach((s) => observer.observe(s));
  }

  /* ---------------- Fade-in on scroll ---------------- */
  function initFadeIns() {
    document
      .querySelectorAll(".section, .hero")
      .forEach((el) => el.classList.add("fade-in"));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach(
          (e) => e.isIntersecting && e.target.classList.add("in-view"),
        ),
      { threshold: 0.08 },
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
        (
          s,
        ) => `<div class="tile" style="background-image:${s.image ? `url('${s.image}')` : "none"};background:${s.image ? "" : s.color}">
          <span lang-el="en">${s.label_en}</span><span lang-el="hi">${s.label_hi}</span>
        </div>`,
      )
      .join("");
  }

  /* ---- Gallery + lightbox ---- */
  let galleryItems = [];
  let lightboxIndex = 0;

  function renderGallery(items) {
    galleryItems = items || [];
    const grid = document.getElementById("galleryGrid");
    if (!grid) return;
    grid.innerHTML = galleryItems
      .map(
        (
          g,
          i,
        ) => `<div class="g-item" data-idx="${i}" style="${g.image ? `background-image:url('${g.image}')` : ""}">
          <span class="cap"><span lang-el="en">${g.caption_en}</span><span lang-el="hi">${g.caption_hi}</span></span>
        </div>`,
      )
      .join("");

    grid.querySelectorAll(".g-item").forEach((el) => {
      el.addEventListener("click", () => openLightbox(Number(el.dataset.idx)));
    });
  }

  function initLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    document
      .getElementById("lightboxClose")
      .addEventListener("click", closeLightbox);
    document
      .getElementById("lightboxPrev")
      .addEventListener("click", () => stepLightbox(-1));
    document
      .getElementById("lightboxNext")
      .addEventListener("click", () => stepLightbox(1));
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (!lightbox.classList.contains("open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") stepLightbox(-1);
      if (e.key === "ArrowRight") stepLightbox(1);
    });
  }

  function openLightbox(index) {
    if (
      !galleryItems.length ||
      !galleryItems[index] ||
      !galleryItems[index].image
    )
      return;
    lightboxIndex = index;
    renderLightbox();
    document.getElementById("lightbox").classList.add("open");
  }
  function closeLightbox() {
    document.getElementById("lightbox").classList.remove("open");
  }
  function stepLightbox(delta) {
    const n = galleryItems.length;
    lightboxIndex = (lightboxIndex + delta + n) % n;
    renderLightbox();
  }
  function renderLightbox() {
    const item = galleryItems[lightboxIndex];
    const lang = document.documentElement.getAttribute("data-lang") || "en";
    document.getElementById("lightboxImg").src = item.image;
    document.getElementById("lightboxCap").textContent =
      lang === "hi" ? item.caption_hi : item.caption_en;
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
        </div>`,
      )
      .join("");
  }

  /* ---- Samagri: multiple collapsible, tabular, downloadable/printable lists ---- */
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

  function getSamagriCheckedState() {
    try {
      return JSON.parse(localStorage.getItem("km_samagri_checked") || "{}");
    } catch (e) {
      return {};
    }
  }
  function setSamagriChecked(listId, itemIdx, checked) {
    const state = getSamagriCheckedState();
    state[listId] = state[listId] || {};
    state[listId][itemIdx] = checked;
    localStorage.setItem("km_samagri_checked", JSON.stringify(state));
  }

  function renderSamagriLists(lists) {
    const container = document.getElementById("samagriListsContainer");
    if (!container) return;
    const checkedState = getSamagriCheckedState();

    container.innerHTML = (lists || [])
      .map((list, li) => {
        const listChecked = checkedState[list.id] || {};
        const rows = list.items
          .map((it, ii) => {
            const checked = !!listChecked[ii];
            return `<tr class="${checked ? "checked" : ""}">
              <td class="check-col"><input type="checkbox" data-list="${list.id}" data-item="${ii}" ${checked ? "checked" : ""}></td>
              <td><span lang-el="en">${escapeHtml(it.en)}</span><span lang-el="hi">${escapeHtml(it.hi)}</span></td>
              <td class="qty-col">${escapeHtml(it.qty || "")}</td>
            </tr>`;
          })
          .join("");

        return `<details class="samagri-card" ${li === 0 ? "open" : ""} data-list-id="${list.id}">
          <summary>
            <span class="s-left">
              <span lang-el="en">${escapeHtml(list.title_en)}</span><span lang-el="hi">${escapeHtml(list.title_hi)}</span>
              <span class="count">${list.items.length} <span lang-el="en">items</span><span lang-el="hi">वस्तुएं</span></span>
            </span>
            <span class="chev">&#10095;</span>
          </summary>
          <div class="toolbar">
            <button type="button" data-action="download" data-list-id="${list.id}">⬇ <span lang-el="en">Download</span><span lang-el="hi">डाउनलोड</span></button>
            <button type="button" data-action="print" data-list-id="${list.id}">🖶 <span lang-el="en">Print</span><span lang-el="hi">प्रिंट</span></button>
          </div>
          <div class="samagri-table-wrap">
            <table class="samagri-table">
              <thead><tr>
                <th></th>
                <th><span lang-el="en">Item</span><span lang-el="hi">वस्तु</span></th>
                <th><span lang-el="en">Quantity</span><span lang-el="hi">मात्रा</span></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </details>`;
      })
      .join("");

    container.addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-list]');
      if (!cb) return;
      setSamagriChecked(cb.dataset.list, cb.dataset.item, cb.checked);
      cb.closest("tr").classList.toggle("checked", cb.checked);
    });

    container.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const list = lists.find((l) => l.id === btn.dataset.listId);
      if (!list) return;
      if (btn.dataset.action === "download") downloadSamagriList(list);
      if (btn.dataset.action === "print") printSamagriList(list);
    });
  }

  function downloadSamagriList(list) {
    const lines = [
      `${list.title_en} / ${list.title_hi}`,
      "New Kali Mandir, Belabagan, Deoghar",
      "",
      ...list.items.map(
        (it, i) => `${i + 1}. ${it.en} / ${it.hi} — ${it.qty || ""}`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${list.id}-puja-samagri.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printSamagriList(list) {
    const rows = list.items
      .map(
        (it, i) =>
          `<tr><td>${i + 1}</td><td>${escapeHtml(it.en)}<br><span style="color:#666;font-size:0.9em;">${escapeHtml(it.hi)}</span></td><td>${escapeHtml(it.qty || "")}</td></tr>`,
      )
      .join("");
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win) return; // popup blocked
    win.document
      .write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(list.title_en)}</title>
      <style>
        body{font-family:Georgia,serif;padding:32px;color:#111;}
        h1{font-size:1.4rem;margin-bottom:0;}
        .sub{color:#666;margin-top:4px;margin-bottom:24px;font-size:0.9rem;}
        table{width:100%;border-collapse:collapse;}
        th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ddd;font-size:0.95rem;}
        th{color:#7a0c1e;text-transform:uppercase;font-size:0.72rem;letter-spacing:0.04em;}
      </style></head><body>
      <h1>${escapeHtml(list.title_en)} / ${escapeHtml(list.title_hi)}</h1>
      <div class="sub">New Kali Mandir, Belabagan, Deoghar</div>
      <table><thead><tr><th>#</th><th>Item</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    win.document.close();
    win.onload = () => win.print();
    // Fallback in case onload doesn't fire (some browsers with about:blank docs)
    setTimeout(() => {
      try {
        win.print();
      } catch (e) {}
    }, 400);
  }

  /* ---- Visiting hours: standard + special (Sat/Tue) ---- */
  function renderHours(hours) {
    const grid = document.getElementById("hoursGrid");
    if (grid && hours.standard) {
      const std = hours.standard;
      const spec = hours.special || {};
      grid.innerHTML = `
        <div class="hours-card">
          <span class="eyebrow" lang-el="en">Other Days</span>
          <span class="eyebrow" lang-el="hi">अन्य दिन</span>
          <div class="time">${std.open} – ${std.close}</div>
          <div class="note" lang-el="en">Standard darshan hours.</div>
          <div class="note" lang-el="hi">सामान्य दर्शन समय।</div>
        </div>
        <div class="hours-card special">
          <span class="eyebrow" lang-el="en">${spec.days_en || "Saturday & Tuesday"}</span>
          <span class="eyebrow" lang-el="hi">${spec.days_hi || "शनिवार व मंगलवार"}</span>
          <div class="time">${spec.open} – ${spec.close}</div>
          <div class="note" lang-el="en">${spec.note_en || ""}</div>
          <div class="note" lang-el="hi">${spec.note_hi || ""}</div>
          <span class="badge" lang-el="en">Special Puja Day</span>
          <span class="badge" lang-el="hi">विशेष पूजा दिवस</span>
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
    const addrEls = document.querySelectorAll("#contact .contact-row .v");
    if (addrEls[0] && contact.address) addrEls[0].textContent = contact.address;
    if (addrEls[1] && contact.mobile) {
      const link = addrEls[1].querySelector("a");
      if (link) {
        link.textContent = contact.mobile;
        link.href = `tel:${contact.mobile.replace(/[^\d+]/g, "")}`;
      }
    }
    const addrCardEn = document.querySelector('.addr-card [lang-el="en"]');
    const addrCardHi = document.querySelector('.addr-card [lang-el="hi"]');
    if (addrCardEn && contact.address) addrCardEn.textContent = contact.address;
    if (addrCardHi && contact.address) addrCardHi.textContent = contact.address;
  }

  /* ---- Custodians (two fixed temple-committee people, shown in Contact Us) ---- */
  function renderCustodians(custodians) {
    const grid = document.getElementById("custodiansGrid");
    if (!grid || !custodians || !custodians.length) return;
    grid.innerHTML = custodians
      .map(
        (c) => `<div class="custodian-card">
          ${c.photo ? `<img class="photo" src="${c.photo}" alt="${escapeHtml(c.name)}">` : `<div class="photo-placeholder">🕉</div>`}
          <div>
            <div class="name">${escapeHtml(c.name)}</div>
            <div class="role"><span lang-el="en">${escapeHtml(c.role_en)}</span><span lang-el="hi">${escapeHtml(c.role_hi)}</span></div>
          </div>
        </div>`,
      )
      .join("");
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
    } catch (err) {
      /* ignore */
    }

    if (API_BASE) {
      fetch(`${API_BASE}/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location.pathname, ts: Date.now() }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initLanguage();
    initScrollSpy();
    initFadeIns();
    initLightbox();
    trackVisit();

    const content = await loadContent();
    renderHeroImage(content.hero_image || null);
    renderSlider(content.slides || []);
    renderGallery(content.gallery || []);
    renderSchedule(content.schedule || []);
    renderSamagriLists(content.samagriLists || []);
    renderHours(content.hours || {});
    renderContact(content.contact || {});
    renderCustodians(content.custodians || []);
    renderBank(content.bank_details || "");
    renderQr(content.qr_image || null);
  });
})();

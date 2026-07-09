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
  // Builds a request URL against API_BASE using query-param dispatch
  // (?type=content, ?type=media, ...) rather than appending path segments.
  // This matters because API_BASE may already end in "?code=..." (a Function
  // App key) — appending "/content" after a query string produces an invalid
  // URL, but appending "&type=content" always composes safely.
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

  // fetch() has no built-in timeout — on a flaky mobile connection, an
  // unreachable or slow backend can leave this hanging far longer than any
  // user will wait, and since hero/gallery/etc. only render AFTER loadContent()
  // resolves, the whole page's dynamic content stalls with it. This wraps any
  // fetch with a hard deadline so we always fall back to default-content.json
  // promptly instead of leaving visitors staring at a half-loaded page.
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
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
        if (!res.ok) throw new Error("bad status");
        base = { ...base, ...(await res.json()) };
      } catch (err) {
        console.warn(
          "Content API unavailable or slow, using default content.",
          err,
        );
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
        (g, i) => `<div class="g-item" data-idx="${i}">
          ${g.image ? `<img src="${g.image}" alt="${escapeHtml(g.caption_en || "")}" loading="lazy" decoding="async" onload="this.classList.add('loaded')">` : ""}
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
    const lang = document.documentElement.getAttribute("data-lang") || "en";
    const title = lang === "hi" ? list.title_hi : list.title_en;
    const lines = [
      title,
      "New Kali Mandir, Belabagan, Deoghar",
      "",
      ...list.items.map((it, i) => {
        const name =
          lang === "hi" ? `${it.hi} (${it.en})` : `${it.en} / ${it.hi}`;
        const qty = it.qty ? ` — ${it.qty}` : "";
        return `${i + 1}. ${name}${qty}`;
      }),
    ];

    // Use a BOM so apps like Excel / Notepad recognise UTF-8 (important for Hindi text).
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\r\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${list.id}-puja-samagri.txt`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Delay revocation — some browsers (especially on mobile) need time to
    // read the object URL before it is invalidated.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 3000);
  }

  function printSamagriList(list) {
    const lang = document.documentElement.getAttribute("data-lang") || "en";
    const title = lang === "hi" ? list.title_hi : list.title_en;

    const rows = list.items
      .map((it, i) => {
        const name =
          lang === "hi"
            ? `${escapeHtml(it.hi)}<br><span style="color:#666;font-size:0.88em;">${escapeHtml(it.en)}</span>`
            : `${escapeHtml(it.en)}<br><span style="color:#666;font-size:0.88em;">${escapeHtml(it.hi)}</span>`;
        return `<tr>
          <td style="width:28px">${i + 1}</td>
          <td>${name}</td>
          <td style="white-space:nowrap;color:#555">${escapeHtml(it.qty || "")}</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Mukta:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Mukta', Georgia, serif; padding: 36px 40px; color: #1a1a1a; font-size: 14px; }
    h1 { font-size: 1.35rem; color: #7a0c1e; margin-bottom: 2px; }
    .sub { color: #555; font-size: 0.85rem; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 7px 10px; border-bottom: 2px solid #c8203f;
         font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: #7a0c1e; }
    td { padding: 9px 10px; border-bottom: 1px dashed #ddd; vertical-align: top; line-height: 1.4; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 28px; font-size: 0.75rem; color: #999; border-top: 1px solid #eee; padding-top: 10px; }
    @media print {
      body { padding: 12px 16px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">New Kali Mandir, Belabagan, Deoghar &nbsp;·&nbsp; N.M Road, 814112</div>
  <table>
    <thead><tr><th>#</th><th>Item / वस्तु</th><th>Qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">newkalimandir.github.io &nbsp;·&nbsp; +91-9431777784</div>
  <p class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 28px;background:#c8203f;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer">🖨 Print / Save as PDF</button>
  </p>
</body>
</html>`;

    // Blob URL, not a data: URL — Chrome silently blocks window.open() on
    // data: URLs (returns a non-null "window" that never actually navigates,
    // so a `!win` fallback check never fires), but has no such restriction
    // on blob: URLs, which is exactly this same-origin-generated-content case.
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      // Revoke once the new tab has had time to load the content it needs.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else {
      URL.revokeObjectURL(url);
      alert("Please allow pop-ups for this site to use the Print feature.");
    }
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

  /* ---------------- Visitor tracking (index.html ONLY — never admin.html) ----------------
     Posts to the Azure Function's track_visitor endpoint if configured, which
     logs a page view AND records an anonymous visitor (new vs. repeat, with
     IP-based geo lookup done server-side). Always also logs a local demo
     counter so something shows in the Admin dashboard's page-view chart even
     before a backend is connected — the visitor/geo metrics themselves only
     come from the real backend, since geo-IP lookup has to happen server-side. */
  function getVisitorId() {
    let id = localStorage.getItem("km_visitor_id");
    if (!id) {
      id =
        window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("km_visitor_id", id);
    }
    return id;
  }

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
      fetch(apiUrl("track_visitor"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: location.pathname,
          visitorId: getVisitorId(),
          ts: Date.now(),
        }),
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

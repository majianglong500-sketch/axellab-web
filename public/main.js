// AXEL LAB — lang, lightbox, menu, parametric field
(function () {
  const KEY = "axellab-lang";

  function setLang(l) {
    document.body.classList.remove("lang-en", "lang-cn");
    document.body.classList.add("lang-" + l);
    try {
      localStorage.setItem(KEY, l);
    } catch (e) {}
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.textContent = l === "cn" ? "EN" : "中文";
    });
    document.documentElement.lang = l === "cn" ? "zh" : "en";
  }

  let saved = "cn";
  try {
    saved = localStorage.getItem(KEY) || "cn";
  } catch (e) {}

  /* ---------- Parametric grid field (canvas 2d, AXEL-owned) ---------- */
  function initParametricField() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Still draw a static faint grid
    }
    if (document.getElementById("px-grid")) return;

    var canvas = document.createElement("canvas");
    canvas.id = "px-grid";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);

    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0,
      h = 0;
    var cols = 0,
      rows = 0;
    var gap = 48;
    var points = [];
    var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    var reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var running = true;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      gap = w < 720 ? 40 : w < 1100 ? 46 : 52;
      cols = Math.ceil(w / gap) + 2;
      rows = Math.ceil(h / gap) + 2;
      points = [];
      var ox = ((w % gap) / 2) - gap;
      var oy = ((h % gap) / 2) - gap;
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var x = ox + i * gap;
          var y = oy + j * gap;
          points.push({
            bx: x,
            by: y,
            x: x,
            y: y,
            phase: (i * 0.37 + j * 0.21) % (Math.PI * 2),
          });
        }
      }
    }

    function onMove(e) {
      var t = e.touches && e.touches[0];
      mouse.tx = t ? t.clientX : e.clientX;
      mouse.ty = t ? t.clientY : e.clientY;
    }
    function onLeave() {
      mouse.tx = -9999;
      mouse.ty = -9999;
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) requestAnimationFrame(frame);
    });

    var t0 = performance.now();
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      var t = (now - t0) * 0.001;

      // Smooth mouse
      mouse.x += (mouse.tx - mouse.x) * (reduced ? 1 : 0.12);
      mouse.y += (mouse.ty - mouse.y) * (reduced ? 1 : 0.12);

      ctx.clearRect(0, 0, w, h);

      // Deep vignette wash
      var g = ctx.createRadialGradient(
        w * 0.5,
        h * 0.35,
        40,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.75
      );
      g.addColorStop(0, "rgba(255,90,42,0.045)");
      g.addColorStop(1, "rgba(7,9,11,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      var radius = Math.min(220, Math.max(140, Math.min(w, h) * 0.28));
      var radius2 = radius * radius;

      // Displace points
      for (var p = 0; p < points.length; p++) {
        var pt = points[p];
        var dx = pt.bx - mouse.x;
        var dy = pt.by - mouse.y;
        var d2 = dx * dx + dy * dy;
        var infl = 0;
        if (d2 < radius2 && mouse.tx > -9000) {
          var d = Math.sqrt(d2) || 0.0001;
          var fall = 1 - d / radius;
          fall = fall * fall;
          // Push outward (parametric bump) + slight swirl
          var nx = dx / d;
          var ny = dy / d;
          var push = fall * 18;
          var swirl = fall * 10;
          pt.x = pt.bx + nx * push - ny * swirl;
          pt.y = pt.by + ny * push + nx * swirl;
          infl = fall;
        } else {
          // Idle micro drift — suggests computation
          var drift = reduced ? 0 : Math.sin(t * 0.7 + pt.phase) * 1.2;
          pt.x += (pt.bx + drift - pt.x) * 0.08;
          pt.y += (pt.by + Math.cos(t * 0.55 + pt.phase) * 1.1 - pt.y) * 0.08;
          infl = 0;
        }
        pt._infl = infl;
      }

      // Lines (sparse — every other cell)
      ctx.lineWidth = 1;
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var idx = j * cols + i;
          var a = points[idx];
          if (i + 1 < cols) {
            var b = points[idx + 1];
            var alpha = 0.045 + Math.max(a._infl || 0, b._infl || 0) * 0.35;
            ctx.strokeStyle = "rgba(255,90,42," + alpha + ")";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          if (j + 1 < rows) {
            var c = points[idx + cols];
            var alpha2 = 0.045 + Math.max(a._infl || 0, c._infl || 0) * 0.35;
            ctx.strokeStyle = "rgba(255,90,42," + alpha2 + ")";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
          }
        }
      }

      // Nodes
      for (var k = 0; k < points.length; k++) {
        var q = points[k];
        var s = 1.1 + (q._infl || 0) * 2.4;
        var al = 0.22 + (q._infl || 0) * 0.75;
        ctx.fillStyle = "rgba(255,90,42," + al + ")";
        ctx.beginPath();
        ctx.arc(q.x, q.y, s, 0, Math.PI * 2);
        ctx.fill();
        if ((q._infl || 0) > 0.35) {
          ctx.strokeStyle = "rgba(255,90,42," + (q._infl * 0.5) + ")";
          ctx.beginPath();
          ctx.arc(q.x, q.y, 6 + q._infl * 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    resize();
    requestAnimationFrame(frame);
  }

  document.addEventListener("DOMContentLoaded", function () {
    setLang(saved);
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        setLang(document.body.classList.contains("lang-cn") ? "en" : "cn");
      });
    });

    // Lightbox (legacy selectors)
    var images = document.querySelectorAll(
      ".bw-primary img, .bw-thumbs img, .detail-fig img, .gallery2 img, .axb img"
    );
    images.forEach(function (img) {
      img.style.cursor = "zoom-in";
      img.addEventListener("click", function () {
        var overlay = document.createElement("div");
        overlay.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
        var fullImg = document.createElement("img");
        fullImg.src = img.src;
        fullImg.style.cssText =
          "max-width:95%;max-height:95%;object-fit:contain;border:1px solid rgba(255,90,42,.35);";
        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);
        overlay.onclick = function () {
          document.body.removeChild(overlay);
        };
      });
    });

    var menuBtn = document.querySelector(".menu-toggle");
    var navLinks = document.querySelector(".nav-links");
    if (menuBtn && navLinks) {
      menuBtn.addEventListener("click", function () {
        navLinks.classList.toggle("open");
      });
    }

    initParametricField();

    // Optional HUD on homepage hero
    var hero = document.querySelector(".hero > div");
    if (hero && !document.querySelector(".px-hud")) {
      var hud = document.createElement("div");
      hud.className = "px-hud";
      hud.innerHTML =
        '<span>SCALE <em>1:1</em></span><span>FIELD <em>ACTIVE</em></span><span>GRID <em>PARAMETRIC</em></span><span>LAB <em>AXEL</em></span>';
      hero.appendChild(hud);
    }
  });
})();

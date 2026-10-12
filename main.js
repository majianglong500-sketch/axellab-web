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

  /* ---------- Clean curved 3D space-frame (Canvas 2D) ----------
   * Future X–adjacent: even spacing, soft low-freq hills, sparse glow nodes.
   * Avoid dense node blobs / noisy pinches. Brand #FF5A2A.
   */
  function initParametricField() {
    if (document.getElementById("px-grid")) return;

    var canvas = document.createElement("canvas");
    canvas.id = "px-grid";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);

    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0,
      h = 0;
    var cols = 0,
      rows = 0;
    var points = [];
    var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    var reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var running = true;

    var camZ = 640;
    var focal = 580;
    var spanX = 1;
    var spanY = 1;
    var waveAmp = 70;
    var tilt = 0.32;
    var cosT = 1,
      sinT = 0;

    // Low-frequency smooth shell — no high-octave noise (avoids messy look)
    function heightField(u, v, t) {
      var tw = reduced ? 0 : t * 0.28;
      var h1 = Math.sin((u * 0.9 + 0.2) * Math.PI + tw) * Math.cos((v * 0.75 - 0.1) * Math.PI);
      var h2 = Math.sin((u * 0.45 - v * 0.35) * Math.PI + tw * 0.7) * 0.55;
      var h3 = Math.cos((u * 0.3 + v * 0.55) * Math.PI - tw * 0.5) * 0.35;
      // Very gentle bowl so edges recede slightly without pinching
      var bowl = (u * u * 0.18 + v * v * 0.12) * waveAmp * 0.35;
      return (h1 + h2 + h3) * waveAmp + bowl;
    }

    function project(x, y, z) {
      var pz = z + camZ;
      if (pz < 80) pz = 80;
      var s = focal / pz;
      return {
        sx: w * 0.5 + x * s,
        sy: h * 0.52 + y * s,
        depth: s,
        pz: pz,
      };
    }

    function worldFromUV(u, v, zLocal) {
      var x0 = u * spanX;
      var y0 = v * spanY;
      return {
        x: x0,
        y: y0 * cosT - zLocal * sinT,
        z: y0 * sinT + zLocal * cosT,
      };
    }

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Wider cells → fewer lines (clean Future X spacing)
      var dens = w < 720 ? 64 : w < 1100 ? 72 : 80;
      cols = Math.max(12, Math.min(22, Math.round(w / dens) + 2));
      rows = Math.max(9, Math.min(16, Math.round(h / dens) + 1));

      spanX = Math.max(w, 900) * 0.95;
      spanY = Math.max(h, 680) * 0.95;
      waveAmp = Math.min(120, Math.max(60, Math.min(w, h) * 0.11));
      camZ = Math.max(560, Math.min(w, h) * 0.72);
      focal = camZ * 0.9;
      // Mild tilt — enough foreshortening, no bottom knot
      tilt = 0.28 + Math.min(0.08, (h / Math.max(w, 1)) * 0.06);
      cosT = Math.cos(tilt);
      sinT = Math.sin(tilt);

      points = [];
      for (var j = 0; j < rows; j++) {
        var v = (j / (rows - 1)) * 2 - 1;
        for (var i = 0; i < cols; i++) {
          var u = (i / (cols - 1)) * 2 - 1;
          points.push({
            u: u,
            v: v,
            i: i,
            j: j,
            x: 0,
            y: 0,
            z: 0,
            sx: 0,
            sy: 0,
            depth: 1,
            pz: camZ,
            infl: 0,
            // Sparse static node markers (every 3rd on checker)
            showNode: (i + j * 2) % 3 === 0,
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

      mouse.x += (mouse.tx - mouse.x) * (reduced ? 1 : 0.12);
      mouse.y += (mouse.ty - mouse.y) * (reduced ? 1 : 0.12);

      ctx.clearRect(0, 0, w, h);

      // Very soft central wash
      var g = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        40,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.7
      );
      g.addColorStop(0, "rgba(255,90,42,0.03)");
      g.addColorStop(1, "rgba(6,7,9,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      var radius = Math.min(240, Math.max(140, Math.min(w, h) * 0.26));
      var radius2 = radius * radius;
      var hasMouse = mouse.tx > -9000;

      for (var p = 0; p < points.length; p++) {
        var pt = points[p];
        var zLocal = heightField(pt.u, pt.v, t);
        var W = worldFromUV(pt.u, pt.v, zLocal);
        var pr0 = project(W.x, W.y, W.z);

        var infl = 0;
        var tx = W.x,
          ty = W.y,
          tz = W.z;

        if (hasMouse) {
          var dx = pr0.sx - mouse.x;
          var dy = pr0.sy - mouse.y;
          var d2 = dx * dx + dy * dy;
          if (d2 < radius2) {
            var d = Math.sqrt(d2) || 0.0001;
            var fall = 1 - d / radius;
            fall = fall * fall * (3 - 2 * fall);
            infl = fall;
            // Subtle volumetric swell (not chaotic)
            var swell = fall * 28;
            var push = fall * 8;
            var nx = dx / d;
            var ny = dy / d;
            tx = W.x - nx * push * 0.35;
            ty = W.y - ny * push * 0.25;
            tz = W.z - swell;
          }
        }

        var ease = reduced ? 1 : 0.14;
        pt.x += (tx - pt.x) * ease;
        pt.y += (ty - pt.y) * ease;
        pt.z += (tz - pt.z) * ease;
        pt.infl = infl;

        var pr = project(pt.x, pt.y, pt.z);
        pt.sx = pr.sx;
        pt.sy = pr.sy;
        pt.depth = pr.depth;
        pt.pz = pr.pz;
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      function edgeFade(sx, sy) {
        var ex = (sx - w * 0.5) / (w * 0.58);
        var ey = (sy - h * 0.5) / (h * 0.58);
        var er = Math.sqrt(ex * ex + ey * ey);
        return Math.max(0, 1 - er * 0.78);
      }

      function strokeEdge(a, b) {
        var midInfl = Math.max(a.infl || 0, b.infl || 0);
        var depthFade = Math.min(a.depth, b.depth);
        var ef = Math.min(edgeFade(a.sx, a.sy), edgeFade(b.sx, b.sy));
        // Soft orange lines — capped so foreshortened edges don't bloom
        var alpha = (0.12 + depthFade * 0.07 + midInfl * 0.2) * ef;
        alpha = Math.min(0.42, alpha);
        if (alpha < 0.03) return;
        ctx.strokeStyle = "rgba(255,90,42," + alpha + ")";
        ctx.lineWidth = 0.9 + midInfl * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // H + V + one diagonal family (space-frame, not double-dense)
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var idx = j * cols + i;
          var a = points[idx];
          if (i + 1 < cols) strokeEdge(a, points[idx + 1]);
          if (j + 1 < rows) strokeEdge(a, points[idx + cols]);
          if (i + 1 < cols && j + 1 < rows) {
            strokeEdge(a, points[idx + cols + 1]);
          }
        }
      }

      // Sparse nodes only: static samples + near-mouse highlights
      for (var k = 0; k < points.length; k++) {
        var q = points[k];
        var inf = q.infl || 0;
        var ef = edgeFade(q.sx, q.sy);
        if (ef < 0.15) continue;

        var draw = false;
        var s = 0;
        var al = 0;

        if (inf > 0.2) {
          draw = true;
          s = 1.2 + inf * 2.2;
          al = (0.35 + inf * 0.4) * ef;
        } else if (q.showNode) {
          draw = true;
          s = 0.9 + q.depth * 0.35;
          al = (0.16 + q.depth * 0.08) * ef;
          al = Math.min(0.28, al);
        }

        if (!draw || al < 0.05) continue;

        if (inf > 0.45) {
          var glowR = s * 3.5;
          var gg = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, glowR);
          gg.addColorStop(0, "rgba(255,90,42," + inf * 0.28 * ef + ")");
          gg.addColorStop(1, "rgba(255,90,42,0)");
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, glowR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = "rgba(255,90,42," + al + ")";
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, s, 0, Math.PI * 2);
        ctx.fill();
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

    var images = document.querySelectorAll(
      ".bw-primary img, .bw-thumbs img, .detail-fig img, .gallery2 img"
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

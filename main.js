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

  /* ---------- Curved 3D space-frame / parametric mesh (Canvas 2D) ----------
   * Inspired by Future X–style undulating shell lattice:
   *  1) UV lattice → world XYZ with multi-octave height field (hills/valleys)
   *  2) Soft parabolic shell bias + X-tilt for horizon foreshortening
   *  3) Perspective project; depth drives alpha (atmospheric fade)
   *  4) Full triangulation (H + V + diagonal) for space-frame feel
   *  5) Pointer → local volumetric swell along surface + glowing nodes
   * Brand accent #FF5A2A. No WebGL; targets ~60fps on mid laptops.
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

    var camZ = 560;
    var focal = 540;
    var spanX = 1;
    var spanY = 1;
    var shellAmp = 70;
    var noiseAmp = 110;
    var tilt = 0.48;
    var cosT = 1,
      sinT = 0;

    // Cheap hash → value noise (no deps)
    function hash2(ix, iy) {
      var n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
      return n - Math.floor(n);
    }
    function smoothstep(t) {
      return t * t * (3 - 2 * t);
    }
    function valueNoise(x, y) {
      var x0 = Math.floor(x),
        y0 = Math.floor(y);
      var fx = x - x0,
        fy = y - y0;
      var u = smoothstep(fx),
        v = smoothstep(fy);
      var a = hash2(x0, y0);
      var b = hash2(x0 + 1, y0);
      var c = hash2(x0, y0 + 1);
      var d = hash2(x0 + 1, y0 + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y) {
      var amp = 0.55,
        freq = 1.15,
        sum = 0,
        norm = 0;
      for (var o = 0; o < 4; o++) {
        sum += amp * (valueNoise(x * freq, y * freq) * 2 - 1);
        norm += amp;
        amp *= 0.48;
        freq *= 2.05;
      }
      return sum / norm;
    }

    function heightField(u, v, t) {
      // Multi-octave terrain + soft shell bowl — Future X undulation
      var n = fbm(u * 1.6 + 0.3, v * 1.6 - 0.2);
      var n2 = fbm(u * 0.7 - t * 0.03, v * 0.7 + t * 0.02);
      var bowl = (u * u * 0.45 + v * v) * shellAmp - shellAmp * 0.28;
      var hills = n * noiseAmp + n2 * noiseAmp * 0.45;
      // Gentle traveling wave so the shell feels alive
      var wave = Math.sin((u * 2.2 + v * 1.1) * Math.PI + t * 0.55) * 12;
      return bowl + hills + (reduced ? 0 : wave);
    }

    function project(x, y, z) {
      var pz = z + camZ;
      if (pz < 48) pz = 48;
      var s = focal / pz;
      return {
        sx: w * 0.5 + x * s,
        sy: h * 0.5 + y * s,
        depth: s,
        pz: pz,
      };
    }

    function worldFromUV(u, v, zLocal) {
      var x0 = u * spanX;
      var y0 = v * spanY;
      var z0 = zLocal;
      // Tilt around X → foreshortened horizon at top
      return {
        x: x0,
        y: y0 * cosT - z0 * sinT,
        z: y0 * sinT + z0 * cosT,
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

      var dens = w < 720 ? 34 : w < 1100 ? 38 : 42;
      cols = Math.max(22, Math.min(42, Math.round(w / dens) + 6));
      rows = Math.max(16, Math.min(32, Math.round(h / dens) + 4));

      spanX = Math.max(w, 960) * 1.05;
      spanY = Math.max(h, 720) * 1.08;
      shellAmp = Math.min(100, Math.max(55, Math.min(w, h) * 0.09));
      noiseAmp = Math.min(170, Math.max(95, Math.min(w, h) * 0.155));
      camZ = Math.max(480, Math.min(w, h) * 0.62);
      focal = camZ * 0.95;
      tilt = 0.44 + Math.min(0.14, (h / Math.max(w, 1)) * 0.1);
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
            phase: (i * 0.37 + j * 0.23) % (Math.PI * 2),
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

      mouse.x += (mouse.tx - mouse.x) * (reduced ? 1 : 0.14);
      mouse.y += (mouse.ty - mouse.y) * (reduced ? 1 : 0.14);

      ctx.clearRect(0, 0, w, h);

      // Central orange atmospheric wash
      var g = ctx.createRadialGradient(
        w * 0.5,
        h * 0.48,
        20,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.72
      );
      g.addColorStop(0, "rgba(255,90,42,0.055)");
      g.addColorStop(0.55, "rgba(255,90,42,0.012)");
      g.addColorStop(1, "rgba(6,7,9,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      var radius = Math.min(280, Math.max(160, Math.min(w, h) * 0.32));
      var radius2 = radius * radius;
      var hasMouse = mouse.tx > -9000;

      // Update height field → tilt → project
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
            // Volumetric swell toward viewer + soft radial flex
            var swell = fall * 62;
            var push = fall * 16;
            var nx = dx / d;
            var ny = dy / d;
            tx = W.x - nx * push * 0.4;
            ty = W.y - ny * push * 0.3;
            tz = W.z - swell;
          }
        }

        var ease = reduced ? 1 : 0.18;
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

      // Edge fade from screen center (vignette on mesh itself)
      function edgeFade(sx, sy) {
        var ex = (sx - w * 0.5) / (w * 0.55);
        var ey = (sy - h * 0.5) / (h * 0.55);
        var er = Math.sqrt(ex * ex + ey * ey);
        return Math.max(0, 1 - er * 0.72);
      }

      function strokeEdge(a, b) {
        var midInfl = Math.max(a.infl || 0, b.infl || 0);
        var depthFade = Math.min(a.depth, b.depth);
        var ef = Math.min(edgeFade(a.sx, a.sy), edgeFade(b.sx, b.sy));
        var alpha = (0.045 + depthFade * 0.085 + midInfl * 0.42) * ef;
        if (alpha < 0.018) return;
        ctx.strokeStyle = "rgba(255,90,42," + Math.min(0.78, alpha) + ")";
        ctx.lineWidth = 0.75 + midInfl * 1.1 + depthFade * 0.35;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // Full triangulation: H, V, and consistent diagonals (space-frame)
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var idx = j * cols + i;
          var a = points[idx];
          if (i + 1 < cols) strokeEdge(a, points[idx + 1]);
          if (j + 1 < rows) strokeEdge(a, points[idx + cols]);
          if (i + 1 < cols && j + 1 < rows) {
            // Alternate diagonal direction for clean triangulation
            if ((i + j) % 2 === 0) strokeEdge(a, points[idx + cols + 1]);
            else strokeEdge(points[idx + 1], points[idx + cols]);
          }
        }
      }

      // Glowing nodes
      for (var k = 0; k < points.length; k++) {
        var q = points[k];
        var inf = q.infl || 0;
        var ef = edgeFade(q.sx, q.sy);
        if (ef < 0.08 && inf < 0.1) continue;
        var s = (0.65 + q.depth * 1.05) * (1 + inf * 2.2);
        var al = (0.14 + q.depth * 0.18 + inf * 0.75) * ef;
        if (al < 0.04) continue;

        // Soft glow halo near pointer / elevated nodes
        if (inf > 0.25 || (q.depth > 1.05 && ef > 0.55 && (k % 5 === 0))) {
          var glowR = s * (2.8 + inf * 4);
          var gg = ctx.createRadialGradient(q.sx, q.sy, 0, q.sx, q.sy, glowR);
          gg.addColorStop(0, "rgba(255,90,42," + (0.22 + inf * 0.35) * ef + ")");
          gg.addColorStop(1, "rgba(255,90,42,0)");
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, glowR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = "rgba(255,90,42," + Math.min(0.95, al) + ")";
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, s, 0, Math.PI * 2);
        ctx.fill();

        if (inf > 0.45) {
          ctx.strokeStyle = "rgba(255,90,42," + inf * 0.5 + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, 5 + inf * 10, 0, Math.PI * 2);
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

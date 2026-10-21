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

  /* ---------- Parametric grid field (canvas 2d, AXEL-owned) ----------
   * 性能：同样透明度的线 / 点合并成一条路径一次画完（原来每条线单独 stroke，
   * 1080p 屏幕每帧约 3000 次绘制调用）；「减少动态效果」时不跑动画循环，只在需要时重画。 */
  function initParametricField() {
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
    var wash = null;
    var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    var reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var running = !document.hidden;
    var queued = false;
    var BASE_A = 0.045;
    var BUCKETS = 16; // 受鼠标影响的线按透明度分 16 档，每档一次 stroke
    var lastMove = 0, lastDraw = 0;
    var IDLE_MS = 1500, IDLE_FRAME_MS = 32; // 鼠标停下 1.5 秒后，背景微动降到约 30 帧/秒

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
            infl: 0,
            phase: (i * 0.37 + j * 0.21) % (Math.PI * 2),
          });
        }
      }
      // Deep vignette wash（尺寸不变就不用每帧重建渐变）
      wash = ctx.createRadialGradient(w * 0.5, h * 0.35, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      wash.addColorStop(0, "rgba(255,90,42,0.045)");
      wash.addColorStop(1, "rgba(7,9,11,0)");
      if (reduced) request();
    }

    function request() {
      if (queued || !running) return;
      queued = true;
      requestAnimationFrame(frame);
    }

    function onMove(e) {
      var t = e.touches && e.touches[0];
      mouse.tx = t ? t.clientX : e.clientX;
      mouse.ty = t ? t.clientY : e.clientY;
      lastMove = performance.now();
      if (reduced) request();
    }
    function onLeave() {
      mouse.tx = -9999;
      mouse.ty = -9999;
      lastMove = performance.now();
      if (reduced) request();
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) request();
    });

    function edge(path, a, b) {
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }

    var t0 = performance.now();
    function frame(now) {
      queued = false;
      if (!running) return;
      if (!reduced) {
        request();
        var settled = Math.abs(mouse.tx - mouse.x) < 0.5 && Math.abs(mouse.ty - mouse.y) < 0.5;
        if (settled && now - lastMove > IDLE_MS && now - lastDraw < IDLE_FRAME_MS) return;
      }
      lastDraw = now;
      var t = (now - t0) * 0.001;

      // Smooth mouse
      mouse.x += (mouse.tx - mouse.x) * (reduced ? 1 : 0.12);
      mouse.y += (mouse.ty - mouse.y) * (reduced ? 1 : 0.12);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      var radius = Math.min(220, Math.max(140, Math.min(w, h) * 0.28));
      var radius2 = radius * radius;
      var active = mouse.tx > -9000;

      // Displace points
      for (var p = 0; p < points.length; p++) {
        var pt = points[p];
        var dx = pt.bx - mouse.x;
        var dy = pt.by - mouse.y;
        var d2 = dx * dx + dy * dy;
        if (active && d2 < radius2) {
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
          pt.infl = fall;
        } else {
          // Idle micro drift — suggests computation
          var driftX = reduced ? 0 : Math.sin(t * 0.7 + pt.phase) * 1.2;
          var driftY = reduced ? 0 : Math.cos(t * 0.55 + pt.phase) * 1.1;
          if (reduced) {
            pt.x = pt.bx;
            pt.y = pt.by;
          } else {
            pt.x += (pt.bx + driftX - pt.x) * 0.08;
            pt.y += (pt.by + driftY - pt.y) * 0.08;
          }
          pt.infl = 0;
        }
      }

      // Lines：不受影响的线一条路径画完；受影响的按透明度分档
      ctx.lineWidth = 1;
      var base = new Path2D();
      var hot = null;
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var idx = j * cols + i;
          var a = points[idx];
          for (var k = 0; k < 2; k++) {
            var b = k === 0 ? (i + 1 < cols ? points[idx + 1] : null) : (j + 1 < rows ? points[idx + cols] : null);
            if (!b) continue;
            var m = a.infl > b.infl ? a.infl : b.infl;
            if (m <= 0) {
              edge(base, a, b);
            } else {
              var bi = Math.min(BUCKETS - 1, Math.floor(m * BUCKETS));
              if (!hot) hot = [];
              if (!hot[bi]) hot[bi] = new Path2D();
              edge(hot[bi], a, b);
            }
          }
        }
      }
      ctx.strokeStyle = "rgba(255,90,42," + BASE_A + ")";
      ctx.stroke(base);
      if (hot) {
        for (var q = 0; q < BUCKETS; q++) {
          if (!hot[q]) continue;
          ctx.strokeStyle = "rgba(255,90,42," + (BASE_A + ((q + 0.5) / BUCKETS) * 0.35).toFixed(3) + ")";
          ctx.stroke(hot[q]);
        }
      }

      // Nodes：静止的点一次 fill；受影响的点（只有鼠标附近几十个）单独画
      var dots = new Path2D();
      for (var n = 0; n < points.length; n++) {
        var o = points[n];
        if (o.infl > 0) continue;
        dots.moveTo(o.x + 1.1, o.y);
        dots.arc(o.x, o.y, 1.1, 0, Math.PI * 2);
      }
      ctx.fillStyle = "rgba(255,90,42,0.22)";
      ctx.fill(dots);
      if (active) {
        for (var z = 0; z < points.length; z++) {
          var v = points[z];
          if (v.infl <= 0) continue;
          ctx.fillStyle = "rgba(255,90,42," + (0.22 + v.infl * 0.75).toFixed(3) + ")";
          ctx.beginPath();
          ctx.arc(v.x, v.y, 1.1 + v.infl * 2.4, 0, Math.PI * 2);
          ctx.fill();
          if (v.infl > 0.35) {
            ctx.strokeStyle = "rgba(255,90,42," + (v.infl * 0.5).toFixed(3) + ")";
            ctx.beginPath();
            ctx.arc(v.x, v.y, 6 + v.infl * 10, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }

    resize();
    request();
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

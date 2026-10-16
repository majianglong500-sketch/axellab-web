/* AXEL LAB 网站编辑器（所见即所得）
 * - 看到的就是真实网站页面（iframe 里渲染仓库里最新的 HTML）
 * - 编辑模式：点文字改字、点图片换图、拖动排序、新增板块
 * - 保存：通过本站 /api/github 代理，用登录者自己的 GitHub 权限一次提交到仓库，Cloudflare 自动上线
 * 没有任何密钥写在这里：登录走 /api/auth（GitHub OAuth，密钥在 Cloudflare 环境变量里）。
 */
(function () {
  "use strict";
  var OWNER = "majianglong500-sketch", REPO = "axellab-web";
  var QS = new URLSearchParams(location.search);
  var BRANCH = QS.get("branch") || "main";
  var TOKEN_KEY = "axel-editor-token";

  var PAGE_NAMES = {
    "index.html": "首页", "projects.html": "项目列表", "built-works.html": "落地案例",
    "course.html": "课程", "labnotes.html": "实验笔记", "about.html": "关于",
    "al-2026-001.html": "项目 · 20天全案落地", "al-2026-002.html": "项目 · 堡垒式公共标识",
    "al-2026-003.html": "项目 · 照片雕刻实验", "al-2026-004.html": "项目 · 第九师校园文化建设",
    "al-2026-005.html": "项目 · 商业形象空间"
  };
  var PAGE_ORDER = ["index.html", "projects.html", "built-works.html", "course.html", "labnotes.html", "about.html"];

  // 不允许在编辑器里改的地方：标志、导航、自动编号、目录、滚动字幕、软件下载的自动信息
  var PROTECT = "header.nav, .logo, .hero h1, .mod-n, .toc-n, .detail-toc, .fx-marquee, [data-axel-ver], [data-axel-notes], script, style, .ax-ui, .lightbox, video";
  var EMPTY_OK = ".axb h2, .axb p, .axb figcaption, figcaption > .cn, figcaption > .en";
  var MULTILINE = "p, .axb-text p";
  var GAL = ".gallery-grid, .gallery2, .bw-thumbs, .axb-items";

  var LIVE_CSS = [
    ".will-in{opacity:1!important;transform:none!important;transition:none!important}",
    "html.ax-on a{cursor:default}",
    "html.ax-on .ax-hover{outline:2px dashed rgba(255,90,42,.9)!important;outline-offset:3px;cursor:text}",
    "html.ax-on .ax-editing{outline:2px solid #FF5A2A!important;outline-offset:3px;background:rgba(255,90,42,.10)!important;cursor:text;min-width:1em}",
    "html.ax-on main img[data-axk]:not(.ax-lock):hover{outline:3px solid #FF5A2A;outline-offset:-3px;cursor:pointer}",
    "html.ax-on .ax-dropimg{outline:5px solid #FF5A2A!important;outline-offset:-5px;filter:brightness(1.2)}",
    "html.ax-on .ax-dropzone{box-shadow:0 0 0 3px #FF5A2A inset!important}",
    ".ax-ui{display:none}",
    "html.ax-on [data-ax-block]{position:relative}",
    "html.ax-on [data-ax-block]:hover{box-shadow:0 0 0 1px rgba(255,90,42,.5)}",
    "html.ax-on [data-ax-block].ax-cur{box-shadow:0 0 0 1px rgba(255,90,42,.8)}",
    "html.ax-on [data-ax-block]:hover>.ax-blockbar,html.ax-on [data-ax-block].ax-cur>.ax-blockbar{display:flex}",
    ".ax-blockbar{position:absolute;top:6px;right:6px;z-index:45;gap:2px;background:#111;border:1px solid #FF5A2A;border-radius:6px;padding:3px;font:12px/1 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5)}",
    ".ax-blockbar button{all:unset;cursor:pointer;color:#F1EFE9;padding:6px 8px;border-radius:4px;white-space:nowrap;font:inherit}",
    ".ax-blockbar button:hover{background:#FF5A2A;color:#111}",
    ".ax-blockbar .ax-drag{cursor:grab}",
    ".ax-blockbar .ax-tag{color:#FF5A2A;padding:6px 6px 6px 4px}",
    "html.ax-on .axb h2:empty,html.ax-on .axb p:empty,html.ax-on .axb figcaption:empty{display:block!important;min-height:1.3em}",
    "html.ax-on .axb h2:empty::before{content:'点这里写标题';opacity:.35}",
    "html.ax-on .axb p:empty::before{content:'点这里写文字说明（不写就不显示）';opacity:.35}",
    "html.ax-on .axb figcaption:empty::before{content:'点这里写图片说明（可不写）';opacity:.35}",
    "html.ax-on figcaption>.cn:empty::before,html.ax-on figcaption>.en:empty::before{content:'点这里写说明';opacity:.35}",
    ".sortable-ghost{opacity:.3!important}",
    "html.ax-on [data-ax-gal]>[data-axk]{cursor:grab}",
    "html.ax-on .detail-module__media:hover img{transform:none}",
    ".ax-flash{animation:axflash 1s ease 2}",
    "@keyframes axflash{0%,100%{box-shadow:none}50%{box-shadow:0 0 0 5px #FF5A2A}}"
  ].join("\n");

  var TEMPLATES = [
    { id: "split-l", name: "左图右文", desc: "一张图 + 一段文字", imgs: true, pic: '<i class="img" style="flex:1.1"></i><i class="txt" style="flex:1"></i>' },
    { id: "split-r", name: "右图左文", desc: "一段文字 + 一张图", imgs: true, pic: '<i class="txt" style="flex:1"></i><i class="img" style="flex:1.1"></i>' },
    { id: "full", name: "整宽大图", desc: "一张大图铺满整行", imgs: true, pic: '<i class="img" style="flex:1"></i>' },
    { id: "grid2", name: "两图并排", desc: "两列，图多自动换行", imgs: true, pic: '<i class="img" style="flex:1"></i><i class="img" style="flex:1"></i>' },
    { id: "grid3", name: "多图网格", desc: "三列，适合一组照片", imgs: true, pic: '<i class="img" style="flex:1"></i><i class="img" style="flex:1"></i><i class="img" style="flex:1"></i>' },
    { id: "text", name: "纯文字", desc: "一个标题 + 一段话", imgs: false, pic: '<i class="txt" style="flex:1"></i>' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var frame = $("axFrame");
  var S = {
    token: null, head: null, headAt: 0, pages: {}, cur: null, edit: false, editing: null,
    blobs: {}, uploaded: {}, nid: 0, snap: null, ld: null, lw: null, sortables: [],
    lastBlock: null, insertAfter: null, justDragged: 0, clickTimer: null, panel: false,
    pending: null, byHash: {}, modalTpl: null, modalImgs: [], pageList: []
  };

  /* ---------------- 小工具 ---------------- */
  var toastTimer;
  function toast(msg, bad, ms) {
    var t = $("axToast");
    t.textContent = msg; t.hidden = false; t.className = "toast" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || (bad ? 7000 : 3500));
  }
  var busyEl = null;
  function busy(msg) {
    if (!msg) { if (busyEl) { busyEl.remove(); busyEl = null; } return; }
    if (!busyEl) { busyEl = document.createElement("div"); busyEl.className = "busy"; document.body.appendChild(busyEl); }
    busyEl.textContent = msg;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function rid() { return Math.random().toString(36).slice(2, 8); }
  function byId(doc, id) { return id ? doc.querySelector('[data-axk="' + id + '"]') : null; }
  function curPg() { return S.pages[S.cur]; }
  function srcDoc() { return curPg().doc; }
  function assignIds(root) {
    var list = [root].concat([].slice.call(root.querySelectorAll ? root.querySelectorAll("*") : []));
    list.forEach(function (el) {
      if (el.nodeType === 1 && !el.hasAttribute("data-axk")) el.setAttribute("data-axk", "k" + (++S.nid));
    });
  }
  function freshIds(root) {
    [root].concat([].slice.call(root.querySelectorAll("*"))).forEach(function (el) { el.removeAttribute("data-axk"); });
    assignIds(root);
  }
  function serialize(doc) { return "<!doctype html>\n" + doc.documentElement.outerHTML + "\n"; }
  function parse(html) { return new DOMParser().parseFromString(html, "text/html"); }
  function pageName(p) { return PAGE_NAMES[p] || p.replace(/\.html$/, ""); }

  /* ---------------- GitHub（经本站代理） ---------------- */
  function gh(path, opts) {
    opts = opts || {};
    var headers = { Authorization: "token " + S.token, Accept: opts.accept || "application/vnd.github+json" };
    var init = { method: opts.method || "GET", headers: headers, cache: "no-store" };
    if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    return fetch("/api/github" + path, init).then(function (r) {
      if (opts.raw) {
        if (!r.ok) throw httpErr(r.status);
        return r.text();
      }
      return r.text().then(function (tx) {
        var j = null; try { j = tx ? JSON.parse(tx) : null; } catch (e) {}
        if (!r.ok) { var er = httpErr(r.status, j && j.message); er.status = r.status; throw er; }
        return j;
      });
    });
  }
  function httpErr(status, msg) {
    var m = status === 401 ? "登录已过期，请重新登录" :
      status === 403 ? "没有权限（或 GitHub 访问太频繁，稍后再试）" :
      status === 404 ? "找不到文件" :
      status === 409 || status === 422 ? "网站刚好被别处更新了，请再点一次保存" :
      "网络或服务器出错（" + status + "）";
    var e = new Error(m); e.status = status; e.detail = msg; return e;
  }
  var R = "/repos/" + OWNER + "/" + REPO;
  function refreshHead(force) {
    if (!force && S.head && Date.now() - S.headAt < 15000) return Promise.resolve(S.head);
    return gh(R + "/git/ref/heads/" + encodeURIComponent(BRANCH)).then(function (j) {
      S.head = j.object.sha; S.headAt = Date.now(); return S.head;
    });
  }
  function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  /* ---------------- 登录 ---------------- */
  function showLogin(err) {
    $("axLogin").hidden = false; $("axLoginErr").textContent = err || "";
  }
  function startLogin() {
    $("axLoginErr").textContent = "";
    var w = window.open("/api/auth", "axgh", "width=640,height=760");
    if (!w) { $("axLoginErr").textContent = "浏览器拦截了登录窗口，请允许弹出窗口后再点一次。"; return; }
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || typeof e.data !== "string") return;
    if (e.data === "authorizing:github") { e.source && e.source.postMessage("authorizing:github", e.origin); return; }
    var ok = "authorization:github:success:", bad = "authorization:github:error:";
    if (e.data.indexOf(ok) === 0) {
      try {
        var tok = JSON.parse(e.data.slice(ok.length)).token;
        if (tok) { localStorage.setItem(TOKEN_KEY, tok); S.token = tok; afterLogin(); }
      } catch (x) { showLogin("登录信息读取失败，请再试一次。"); }
    } else if (e.data.indexOf(bad) === 0) {
      showLogin("GitHub 登录没有成功，请再试一次。");
    }
  });
  function afterLogin() {
    busy("正在打开网站…");
    gh(R).then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        busy(); localStorage.removeItem(TOKEN_KEY);
        showLogin("这个 GitHub 账号没有修改这个网站的权限。请用网站主人的账号登录。");
        return;
      }
      $("axLogin").hidden = true;
      return refreshHead(true).then(loadPageList).then(function () {
        var m = /page=([^&]+)/.exec(location.hash);
        return openPage(m ? decodeURIComponent(m[1]) : "index.html");
      });
    }).catch(function (err) {
      busy();
      if (err.status === 401) { localStorage.removeItem(TOKEN_KEY); showLogin("登录已过期，请重新登录。"); }
      else showLogin("打不开：" + err.message);
    });
  }
  function loadPageList() {
    return gh(R + "/git/trees/" + S.head).then(function (t) {
      var names = (t.tree || []).filter(function (x) { return x.type === "blob" && /^[^/]+\.html$/.test(x.path); })
        .map(function (x) { return x.path; });
      names.sort(function (a, b) {
        var ia = PAGE_ORDER.indexOf(a), ib = PAGE_ORDER.indexOf(b);
        if (ia < 0) ia = 99; if (ib < 0) ib = 99;
        return ia - ib || a.localeCompare(b);
      });
      S.pageList = names; fillSelect();
    });
  }
  function fillSelect() {
    var sel = $("axPage"); sel.innerHTML = "";
    S.pageList.forEach(function (p) {
      var o = document.createElement("option"); o.value = p;
      o.textContent = (S.pages[p] && S.pages[p].dirty ? "● " : "") + pageName(p);
      sel.appendChild(o);
    });
    if (S.cur) sel.value = S.cur;
  }

  /* ---------------- 页面加载 / 渲染 ---------------- */
  function loadPage(path) {
    return refreshHead().then(function (sha) {
      return gh(R + "/contents/" + encPath(path) + "?ref=" + sha, { raw: true, accept: "application/vnd.github.raw" });
    }).then(function (html) {
      var doc = parse(html);
      assignIds(doc.body);
      var pg = { doc: doc, undo: [], redo: [], dirty: false, scroll: 0 };
      pg.orig = cleanHtml(doc, null);
      pg.base = serialize(doc);
      pg.origWorks = worksOf(doc);
      S.pages[path] = pg;
      if (S.pageList.indexOf(path) < 0) { S.pageList.push(path); fillSelect(); }
      return pg;
    });
  }
  function openPage(path, opts) {
    opts = opts || {};
    finishEdit();
    if (S.cur && S.lw && S.pages[S.cur]) { try { S.pages[S.cur].scroll = S.lw.scrollY; } catch (e) {} }
    var have = S.pages[path];
    if (!have) setStatus("正在打开 " + pageName(path) + "…");
    return (have ? Promise.resolve(have) : loadPage(path)).then(function (pg) {
      busy();
      history.replaceState(null, "", location.pathname + location.search + "#page=" + encodeURIComponent(path));
      render(path, { scroll: opts.hash ? 0 : pg.scroll, hash: opts.hash });
      if (opts.panel && S.edit) setPanel(true);
    }).catch(function (err) {
      busy();
      toast("打不开这个页面：" + err.message, true);
      updateUI();
    });
  }
  function render(path, opts) {
    opts = opts || {};
    S.cur = path;
    S.pending = { scroll: opts.scroll || 0, hash: opts.hash || "", focus: opts.focus || null };
    var clone = curPg().doc.cloneNode(true);
    var base = clone.createElement("base"); base.setAttribute("href", "/");
    clone.head.insertBefore(base, clone.head.firstChild);
    // 只在编辑器预览里：资源地址改成从网站根目录开始（避免浏览器预加载时找错目录）
    [].forEach.call(clone.querySelectorAll("link[href], script[src], img[src], source[src], video[src], video[poster]"), function (el) {
      ["href", "src", "poster"].forEach(function (k) {
        var v = el.getAttribute(k);
        if (v && !/^([a-z]+:|\/|#)/i.test(v)) el.setAttribute(k, "/" + v);
      });
    });
    frame.srcdoc = serialize(clone);
    $("axPage").value = path;
  }
  function rerender(focusId) {
    var y = 0; try { y = S.lw.scrollY; } catch (e) {}
    render(S.cur, { scroll: y, focus: focusId });
  }

  frame.addEventListener("load", function () {
    var href;
    try { href = frame.contentWindow.location.href; } catch (e) {
      toast("这是站外网页，编辑器里不打开。", true); if (S.cur) render(S.cur); return;
    }
    if (href === "about:blank") return;
    if (href === "about:srcdoc") { attach(); return; }
    // 页面自己跳转了（很少见）：换成编辑器里的同一页
    var u = new URL(href);
    var p = u.pathname.replace(/^\//, "") || "index.html";
    if (/\/$/.test(p)) p += "index.html";
    if (/\.html$/.test(p)) openPage(p, { hash: u.hash }); else if (S.cur) render(S.cur);
  });

  function attach() {
    var d = frame.contentDocument, w = frame.contentWindow;
    S.ld = d; S.lw = w; S.sortables = [];
    var st = d.createElement("style"); st.textContent = LIVE_CSS; d.head.appendChild(st);
    d.documentElement.classList.toggle("ax-on", S.edit);
    // 刚上传、网站还没更新完的图片：先用本机预览
    [].forEach.call(d.images, function (img) {
      var p = (img.getAttribute("src") || "").replace(/^\//, ""); if (p && S.uploaded[p]) img.src = S.uploaded[p];
    });
    [].forEach.call(d.querySelectorAll(PROTECT.replace(", script, style", "")), function (el) {
      [].forEach.call(el.querySelectorAll("img"), function (i) { i.classList.add("ax-lock"); });
    });
    markBlocks(d);
    [].forEach.call(d.querySelectorAll(GAL), function (g) { if (g.hasAttribute("data-axk")) g.setAttribute("data-ax-gal", ""); });
    d.addEventListener("click", onClick, true);
    d.addEventListener("dblclick", onDblClick, true);
    d.addEventListener("mouseover", onOver, true);
    d.addEventListener("keydown", onKey, true);
    d.addEventListener("dragover", onDragOver, true);
    d.addEventListener("dragleave", onDragLeave, true);
    d.addEventListener("drop", onDrop, true);
    d.addEventListener("focusout", function (e) { if (S.editing && e.target === S.editing.el) finishEdit(); }, true);
    var sc = d.createElement("script"); sc.src = "/admin/vendor/Sortable.min.js";
    sc.onload = initSortables; d.head.appendChild(sc);
    var pend = S.pending || {}; S.pending = null;
    function place() {
      if (pend.focus) {
        var el = byId(d, pend.focus);
        if (el) { el.scrollIntoView({ block: "center" }); flash(el); }
      } else if (pend.hash) {
        var t = d.getElementById(pend.hash.slice(1)); if (t) t.scrollIntoView();
      } else w.scrollTo(0, pend.scroll || 0);
    }
    place(); setTimeout(place, 120);
    if (S.lastBlock) { var lb = byId(d, S.lastBlock); if (lb && lb.hasAttribute("data-ax-block")) lb.classList.add("ax-cur"); }
    updateUI(); refreshPanel();
  }
  function flash(el) { el.classList.remove("ax-flash"); void el.offsetWidth; el.classList.add("ax-flash"); setTimeout(function () { el.classList.remove("ax-flash"); }, 2200); }

  function containersOf(d) {
    var list = [];
    var m = d.querySelector("main"); if (m) list.push(m);
    [].forEach.call(d.querySelectorAll(".detail-modules"), function (x) { list.push(x); });
    return list.filter(function (x) { return x.hasAttribute("data-axk"); });
  }
  function isBlockChild(ch) {
    return ch.nodeType === 1 && ch.hasAttribute("data-axk") && !/^(FOOTER|SCRIPT|STYLE|TEMPLATE)$/.test(ch.tagName) && !ch.matches(".detail-body");
  }
  function markBlocks(d) {
    containersOf(d).forEach(function (c) {
      [].forEach.call(c.children, function (ch) {
        if (!isBlockChild(ch)) return;
        ch.setAttribute("data-ax-block", "");
        var bar = d.createElement("div"); bar.className = "ax-ui ax-blockbar";
        var h = '<span class="ax-tag">板块</span><button class="ax-drag" data-act="drag" title="按住拖动，上下换位置">⠿ 拖动</button>' +
          '<button data-act="up" title="往上移">↑</button><button data-act="down" title="往下移">↓</button>';
        if (ch.matches(".axb-split, .detail-module")) h += '<button data-act="swap" title="图和文字左右互换">⇄ 左右互换</button>';
        if (ch.matches(GAL) || ch.querySelector(GAL)) h += '<button data-act="addimg" title="往这组里追加图片">＋ 图片</button>';
        h += '<button data-act="addafter" title="在这个板块下面加一个新板块">＋ 下面加板块</button><button data-act="del" title="删除这个板块">删除</button>';
        bar.innerHTML = h;
        ch.appendChild(bar);
      });
    });
  }
  function initSortables() {
    var Sortable = S.lw.Sortable; if (!Sortable) return;
    containersOf(S.ld).forEach(function (c) {
      S.sortables.push(Sortable.create(c, {
        handle: ".ax-drag", draggable: "[data-ax-block]", animation: 150, disabled: !S.edit, forceFallback: true, fallbackOnBody: true, scroll: true, bubbleScroll: true,
        onStart: function () { beginChange(); },
        onEnd: function (e) { S.justDragged = Date.now(); if (e.oldIndex === e.newIndex) { S.snap = null; return; } mirrorMove(e.item); endChange({ rerender: true, focus: e.item.getAttribute("data-axk") }); }
      }));
    });
    [].forEach.call(S.ld.querySelectorAll("[data-ax-gal]"), function (g) {
      S.sortables.push(Sortable.create(g, {
        draggable: ">[data-axk]", filter: ".ax-ui", preventOnFilter: false, animation: 150, disabled: !S.edit, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 6,
        group: g.matches(".axb-items") ? "axb-items" : undefined,
        onStart: function () { beginChange(); },
        onEnd: function (e) {
          S.justDragged = Date.now();
          if (e.from === e.to && e.oldIndex === e.newIndex) { S.snap = null; return; }
          mirrorMove(e.item); endChange({ rerender: false });
        }
      }));
    });
  }
  function mirrorMove(liveEl) {
    var src = srcDoc();
    var sEl = byId(src, liveEl.getAttribute("data-axk"));
    var sp = byId(src, liveEl.parentElement.getAttribute("data-axk"));
    if (!sEl || !sp) return;
    var n = liveEl.nextElementSibling;
    while (n && !n.hasAttribute("data-axk")) n = n.nextElementSibling;
    var sn = n && byId(src, n.getAttribute("data-axk"));
    if (sn && sn.parentNode === sp) sp.insertBefore(sEl, sn); else sp.appendChild(sEl);
  }

  /* ---------------- 改动记录 / 撤销 ---------------- */
  function beginChange() { if (S.editing) finishEdit(); if (!S.snap) S.snap = serialize(srcDoc()); }
  function endChange(o) {
    o = o || {};
    var pg = curPg();
    regenToc(pg.doc);
    var now = serialize(pg.doc);
    if (S.snap && now !== S.snap) {
      pg.undo.push(S.snap); if (pg.undo.length > 80) pg.undo.shift(); pg.redo = [];
    }
    S.snap = null;
    updateDirty(pg);
    if (o.rerender) rerender(o.focus); else { syncTocLive(); refreshPanel(); updateUI(); }
  }
  // 改了标题后，把左侧目录和编号同步到眼前的页面（不用整页刷新）
  function syncTocLive() {
    if (!S.ld) return;
    var src = srcDoc();
    var lt = S.ld.getElementById("detailToc"), st = src.getElementById("detailToc");
    if (lt && st && lt.innerHTML !== st.innerHTML) lt.innerHTML = st.innerHTML;
    [].forEach.call(src.querySelectorAll(".mod-n[data-axk]"), function (m) {
      var l = byId(S.ld, m.getAttribute("data-axk")); if (l && l.textContent !== m.textContent) l.textContent = m.textContent;
    });
  }
  function updateDirty(pg) { pg.dirty = cleanHtml(pg.doc, null) !== pg.orig; }
  function undo() {
    finishEdit(); var pg = curPg(); if (!pg || !pg.undo.length) return toast("没有可以撤销的了");
    pg.redo.push(serialize(pg.doc)); pg.doc = parse(pg.undo.pop()); updateDirty(pg); rerender(); toast("已撤销");
  }
  function redo() {
    finishEdit(); var pg = curPg(); if (!pg || !pg.redo.length) return toast("没有可以重做的了");
    pg.undo.push(serialize(pg.doc)); pg.doc = parse(pg.redo.pop()); updateDirty(pg); rerender(); toast("已重做");
  }

  /* ---------------- 目录自动更新（项目详情页左侧） ---------------- */
  function regenToc(doc) {
    var toc = doc.getElementById("detailToc"), mods = doc.querySelector(".detail-modules");
    if (!toc || !mods) return;
    var entries = [], n = 0;
    [].forEach.call(mods.children, function (sec) {
      if (sec.tagName !== "SECTION") return;
      var h2 = sec.querySelector("h2"); if (!h2) return;
      var cnEl = h2.querySelector(".cn"), enEl = h2.querySelector(".en");
      var cn, en;
      if (cnEl || enEl) { cn = cnEl ? cnEl.textContent.trim() : ""; en = enEl ? enEl.textContent.trim() : cn; }
      else { cn = h2.textContent.trim(); en = cn; }
      if (!cn && !en) return;
      n++; var num = pad2(n);
      if (!sec.id) sec.id = "blk-" + rid();
      var mn = h2.querySelector(".mod-n"); if (mn && mn.textContent !== num) mn.textContent = num;
      entries.push({ href: "#" + sec.id, n: num, cn: cn, en: en || cn });
    });
    var links = [].slice.call(toc.querySelectorAll("a"));
    var numeric = links.filter(function (a) { return /^\d+$/.test(a.getAttribute("data-n") || ""); });
    var extra = links.filter(function (a) { return !/^\d+$/.test(a.getAttribute("data-n") || ""); });
    var curSig = JSON.stringify(numeric.map(function (a) {
      var c = a.querySelector(".toc-label .cn"), e = a.querySelector(".toc-label .en");
      return [a.getAttribute("href"), a.getAttribute("data-n"), c ? c.textContent.trim() : "", e ? e.textContent.trim() : ""];
    }));
    var newSig = JSON.stringify(entries.map(function (e) { return [e.href, e.n, e.cn, e.en]; }));
    if (curSig === newSig) return;
    var parts = entries.map(function (e) {
      return '      <a href="' + esc(e.href) + '" data-n="' + e.n + '"><span class="toc-n">' + e.n + '</span><span class="toc-label"><span class="cn">' + esc(e.cn) + '</span><span class="en">' + esc(e.en) + "</span></span></a>";
    }).concat(extra.map(function (a) { var c = a.cloneNode(true); c.removeAttribute("data-axk"); [].forEach.call(c.querySelectorAll("[data-axk]"), function (x) { x.removeAttribute("data-axk"); }); return "      " + c.outerHTML; }));
    toc.innerHTML = "\n" + parts.join("\n") + "\n    ";
    assignIds(toc);
  }

  /* ---------------- 生成要保存的干净 HTML ---------------- */
  function cleanHtml(doc, stamp) {
    var c = doc.cloneNode(true);
    [].forEach.call(c.querySelectorAll("[data-axk]"), function (el) { el.removeAttribute("data-axk"); });
    if (stamp) {
      var m = c.querySelector('meta[name="axel-editor"]');
      if (!m) {
        m = c.createElement("meta"); m.setAttribute("name", "axel-editor");
        var vp = c.querySelector('meta[name="viewport"]') || c.querySelector("meta[charset]");
        if (vp && vp.parentNode === c.head) { c.head.insertBefore(m, vp.nextSibling); c.head.insertBefore(c.createTextNode("\n  "), m); }
        else c.head.appendChild(m);
      }
      m.setAttribute("content", stamp);
    }
    return serialize(c);
  }
  function worksOf(doc) {
    return [].map.call(doc.querySelectorAll(".works, .works-extra"), function (e) {
      var c = e.cloneNode(true); c.removeAttribute("data-axk");
      [].forEach.call(c.querySelectorAll("[data-axk]"), function (x) { x.removeAttribute("data-axk"); });
      return c.outerHTML;
    }).join("|");
  }
  function replaceWorks(dst, from) {
    var dWorks = dst.querySelector(".works"); if (!dWorks) return false;
    [].forEach.call(dst.querySelectorAll(".works-extra"), function (x) { x.remove(); });
    [].forEach.call(from.querySelectorAll(".works, .works-extra"), function (el) {
      var c = dst.importNode(el, true); freshIds(c);
      dWorks.parentNode.insertBefore(c, dWorks);
      dWorks.parentNode.insertBefore(dst.createTextNode("\n      "), dWorks);
    });
    dWorks.remove();
    return true;
  }
  function syncWorks() {
    var pairs = [["index.html", "projects.html"], ["projects.html", "index.html"]];
    var p = Promise.resolve();
    pairs.forEach(function (pr) {
      p = p.then(function () {
        var a = S.pages[pr[0]]; if (!a || !a.dirty || worksOf(a.doc) === a.origWorks) return;
        var b = S.pages[pr[1]];
        return (b ? Promise.resolve(b) : loadPage(pr[1])).then(function (b) {
          if (b.dirty && worksOf(b.doc) !== b.origWorks) return; // 两边都改了卡片，就不互相覆盖
          if (replaceWorks(b.doc, a.doc)) updateDirty(b);
        });
      });
    });
    return p;
  }

  /* ---------------- 编辑模式下的点击 ---------------- */
  function textTarget(el) {
    for (var e = el; e && e.nodeType === 1 && e !== S.ld.body; e = e.parentElement) {
      if (e.closest(PROTECT)) return null;
      if (!e.hasAttribute("data-axk")) continue;
      if (e.tagName === "IMG") return null;
      if (e.matches(EMPTY_OK) && !e.textContent.trim()) return e;
      for (var i = 0; i < e.childNodes.length; i++) {
        var n = e.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) return e;
      }
      if (e.matches("[data-ax-block], main, section, .detail-modules, .works, .works-extra, .project-stack, [data-ax-gal]")) return null;
    }
    return null;
  }
  function imgEditable(img) { return img.tagName === "IMG" && img.hasAttribute("data-axk") && !img.closest(PROTECT) && !!img.closest("main"); }
  function pageOf(a) {
    var href = a.getAttribute("href");
    if (!href) return null;
    if (href.charAt(0) === "#") return { path: S.cur, hash: href };
    var u; try { u = new URL(href, location.origin + "/"); } catch (e) { return null; }
    if (u.origin !== location.origin) return null;
    var p = u.pathname.replace(/^\//, "") || "index.html";
    if (/\/$/.test(p)) p += "index.html";
    if (!/^[^/]+\.html$/.test(p) || p.indexOf("admin") === 0) return null;
    return { path: p, hash: u.hash };
  }
  function scrollToHash(h) { var t = S.ld.getElementById(h.slice(1)); if (t) t.scrollIntoView({ behavior: "smooth" }); }

  function onClick(e) {
    var t = e.target;
    if (t.nodeType !== 1) t = t.parentElement;
    var bar = t.closest(".ax-blockbar");
    if (bar) { e.preventDefault(); e.stopPropagation(); var b = t.closest("button"); if (b) blockAction(b.getAttribute("data-act"), bar.parentElement); return; }
    if (t.closest(".lang-btn")) return; // 中英文切换照常
    var a = t.closest("a[href]");
    if (!S.edit) {
      if (!a) return;
      var pg = pageOf(a);
      if (pg && pg.path === S.cur && pg.hash) { e.preventDefault(); scrollToHash(pg.hash); return; }
      if (pg) { e.preventDefault(); openPage(pg.path, { hash: pg.hash }); return; }
      if (/^(mailto|tel):/.test(a.getAttribute("href"))) return;
      e.preventDefault(); if (a.href && a.getAttribute("href") !== "#") window.open(a.href, "_blank", "noopener");
      return;
    }
    if (S.editing && S.editing.el.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - S.justDragged < 400) return;
    var blk = t.closest("[data-ax-block]"); setCurBlock(blk);
    var pos = { clientX: e.clientX, clientY: e.clientY };
    clearTimeout(S.clickTimer);
    if (a) S.clickTimer = setTimeout(function () { editAt(t, pos, a); }, 280);
    else editAt(t, pos, null);
  }
  function editAt(t, pos, a) {
    if (imgEditable(t)) { finishEdit(); pickFiles(false, function (fs) { replaceImage(t, fs[0]); }); return; }
    var T = textTarget(t);
    if (T) { startEdit(T, pos); return; }
    finishEdit();
    if (a) { var pg = pageOf(a); if (pg && pg.path === S.cur && pg.hash) scrollToHash(pg.hash); else if (pg) toast("双击才会进入「" + pageName(pg.path) + "」"); }
  }
  function onDblClick(e) {
    if (!S.edit) return;
    var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (t.closest(".ax-ui")) return;
    var a = t.closest("a[href]"); if (!a) return;
    e.preventDefault(); e.stopPropagation(); clearTimeout(S.clickTimer);
    finishEdit();
    var pg = pageOf(a);
    if (!pg) return toast("这是站外链接，编辑时不打开。");
    if (pg.path === S.cur) { if (pg.hash) scrollToHash(pg.hash); return; }
    openPage(pg.path, { hash: pg.hash, panel: !!a.closest(".project") || /^al-/.test(pg.path) });
  }
  var hoverEl = null;
  function onOver(e) {
    if (!S.edit) return;
    var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    var T = (S.editing && S.editing.el.contains(t)) ? null : textTarget(t);
    if (hoverEl && hoverEl !== T) hoverEl.classList.remove("ax-hover");
    hoverEl = T; if (T) T.classList.add("ax-hover");
    if (imgEditable(t) && !t.title) t.title = t.closest("a.project") ? "点一下换封面图，双击进入这个项目" : "点一下换图，或把新图片拖到这里";
  }
  function setCurBlock(blk) {
    if (!S.ld) return;
    [].forEach.call(S.ld.querySelectorAll(".ax-cur"), function (x) { x.classList.remove("ax-cur"); });
    if (blk) { blk.classList.add("ax-cur"); S.lastBlock = blk.getAttribute("data-axk"); }
  }

  /* ---------------- 改字 ---------------- */
  function startEdit(T, pos) {
    finishEdit();
    S.snap = null; beginChange();
    S.editing = { el: T, before: T.innerHTML };
    T.classList.remove("ax-hover"); T.classList.add("ax-editing");
    T.setAttribute("contenteditable", "true"); T.setAttribute("spellcheck", "false");
    T.focus();
    try {
      var r = S.ld.caretRangeFromPoint && S.ld.caretRangeFromPoint(pos.clientX, pos.clientY);
      var sel = S.lw.getSelection();
      if (r && T.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); }
      else { var rr = S.ld.createRange(); rr.selectNodeContents(T); rr.collapse(false); sel.removeAllRanges(); sel.addRange(rr); }
    } catch (x) {}
  }
  function cleanLiveHtml(el) {
    var c = el.cloneNode(true);
    [].forEach.call(c.querySelectorAll("*"), function (x) {
      x.classList.remove("ax-hover", "ax-editing", "ax-flash");
      if (x.getAttribute("class") === "") x.removeAttribute("class");
      x.removeAttribute("contenteditable");
      if (!x.hasAttribute("data-axk")) x.removeAttribute("style");
    });
    // 只留下简单的文字格式，其他标签拆掉
    var ok = /^(SPAN|BR|B|STRONG|EM|I|A|SUP|SUB)$/;
    var bad = [].filter.call(c.querySelectorAll("*"), function (x) { return !ok.test(x.tagName); });
    bad.reverse().forEach(function (x) {
      var frag = x.ownerDocument.createDocumentFragment();
      if (/^(DIV|P)$/.test(x.tagName) && x.previousSibling) frag.appendChild(x.ownerDocument.createElement("br"));
      while (x.firstChild) frag.appendChild(x.firstChild);
      x.parentNode.replaceChild(frag, x);
    });
    var h = c.innerHTML.replace(/(<br>\s*)+$/, "");
    if (!c.textContent.trim() && !/<br>/.test(h)) h = "";
    return h;
  }
  function finishEdit(cancel) {
    if (!S.editing) return;
    var el = S.editing.el, before = S.editing.before; S.editing = null;
    el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck");
    el.classList.remove("ax-editing", "ax-hover");
    if (cancel) { el.innerHTML = before; S.snap = null; return; }
    var h = cleanLiveHtml(el);
    if (el.innerHTML !== h) el.innerHTML = h;
    var s = byId(srcDoc(), el.getAttribute("data-axk"));
    if (s && s.innerHTML !== h) s.innerHTML = h;
    endChange({});
  }
  function onKey(e) {
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (S.editing && S.editing.el.contains(e.target)) {
      if (k === "Escape") { e.preventDefault(); finishEdit(true); return; }
      if (k === "Enter") {
        e.preventDefault();
        if (S.editing.el.closest(MULTILINE) && !e.ctrlKey) S.ld.execCommand("insertLineBreak");
        else finishEdit();
        return;
      }
      if (mod && (k === "s" || k === "S")) { e.preventDefault(); finishEdit(); save(); }
      return;
    }
    shortcut(e);
  }
  function shortcut(e) {
    var k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (k === "s") { e.preventDefault(); save(); }
    else if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  }
  document.addEventListener("keydown", function (e) { if (!$("axLogin").hidden) return; shortcut(e); });
  // 粘贴只要纯文字
  frame.addEventListener("load", function () {
    try {
      frame.contentDocument.addEventListener("paste", function (e) {
        if (!S.editing) return;
        e.preventDefault();
        var tx = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
        if (!S.editing.el.closest(MULTILINE)) tx = tx.replace(/\s*\n\s*/g, " ");
        S.ld.execCommand("insertText", false, tx);
      }, true);
    } catch (x) {}
  });

  /* ---------------- 图片：压缩 / 替换 / 追加 / 删除 ---------------- */
  function pickFiles(multi, cb) {
    var inp = $(multi ? "axFiles" : "axFile");
    inp.value = "";
    inp.onchange = function () { var fs = [].slice.call(inp.files || []); if (fs.length) cb(fs); };
    inp.click();
  }
  function isImg(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name || ""); }
  function prepImage(file) {
    if (!isImg(file)) return Promise.reject(new Error("「" + (file.name || "这个文件") + "」不是图片"));
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
      throw new Error("读不了「" + (file.name || "这张图") + "」（如果是苹果手机的 HEIC 格式，请先转成 JPG 再拖进来）");
    }).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      function enc(max, q) {
        var sc = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * sc)), chh = Math.max(1, Math.round(h * sc));
        var cv = document.createElement("canvas"); cv.width = cw; cv.height = chh;
        var cx = cv.getContext("2d"); cx.drawImage(bmp, 0, 0, cw, chh);
        var alpha = false;
        if (/png|webp|gif/.test(file.type)) {
          var data = cx.getImageData(0, 0, cw, chh).data;
          for (var i = 3; i < data.length; i += 64) { if (data[i] < 250) { alpha = true; break; } }
        }
        if (!alpha) { // 透明背景以外都转成 JPG，底色用网站的黑
          var cv2 = document.createElement("canvas"); cv2.width = cw; cv2.height = chh;
          var c2 = cv2.getContext("2d"); c2.fillStyle = "#060709"; c2.fillRect(0, 0, cw, chh); c2.drawImage(cv, 0, 0); cv = cv2;
        }
        var type = alpha ? "image/webp" : "image/jpeg";
        return new Promise(function (res) { cv.toBlob(function (b) { res({ blob: b, w: cw, h: chh, ext: alpha ? "webp" : "jpg" }); }, type, q); });
      }
      return enc(2000, 0.84).then(function (r) {
        if (r.blob.size > 750 * 1024) return enc(1800, 0.76);
        return r;
      }).then(function (r) {
        if (r.blob.size > 950 * 1024) return enc(1500, 0.72);
        return r;
      });
    }).then(function (r) {
      return r.blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (hb) {
        var hex = [].map.call(new Uint8Array(hb), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("").slice(0, 12);
        if (S.byHash[hex]) return S.byHash[hex]; // 同一张图只传一次
        var dt = new Date();
        var path = "assets/uploads/" + dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) + "-" + hex + "." + r.ext;
        var url = URL.createObjectURL(r.blob);
        S.blobs[url] = { path: path, blob: r.blob, w: r.w, h: r.h };
        return (S.byHash[hex] = { url: url, path: path, w: r.w, h: r.h, size: r.blob.size });
      });
    });
  }
  function prepAll(files) {
    var out = [], errs = [];
    var p = Promise.resolve();
    files.forEach(function (f) {
      p = p.then(function () { return prepImage(f).then(function (r) { out.push(r); }, function (e) { errs.push(e.message); }); });
    });
    return p.then(function () { if (errs.length) toast(errs.join("；"), true); return out; });
  }
  function replaceImage(liveImg, file) {
    setStatus("正在压缩图片…");
    prepImage(file).then(function (im) {
      beginChange();
      var src = srcDoc();
      var s = byId(src, liveImg.getAttribute("data-axk"));
      if (!s) { S.snap = null; return; }
      s.setAttribute("src", im.url); s.removeAttribute("srcset");
      liveImg.src = im.url; liveImg.removeAttribute("srcset");
      var box = liveImg.closest(".gallery-grid > figure, .detail-module__media");
      if (box) {
        var por = im.h > im.w * 1.1;
        var sb = byId(src, box.getAttribute("data-axk"));
        [box, sb].forEach(function (x) { if (x && (por || x.classList.contains("portrait"))) x.classList.toggle("portrait", por); });
      }
      endChange({});
      toast("图片已换好（" + Math.round(im.size / 1024) + " KB），记得点「保存」");
    }).catch(function (e) { updateUI(); toast(e.message, true); });
  }
  function appendImages(liveGal, files) {
    var gid = liveGal.getAttribute("data-axk");
    setStatus("正在压缩图片…");
    prepAll(files).then(function (ims) {
      if (!ims.length) return updateUI();
      beginChange();
      var src = srcDoc(), sg = byId(src, gid);
      if (!sg) { S.snap = null; return; }
      var items = [].filter.call(sg.children, function (c) { return c.tagName !== "SCRIPT"; });
      var tmpl = items[items.length - 1];
      var first = null;
      ims.forEach(function (im) {
        var el;
        if (tmpl) el = tmpl.cloneNode(true);
        else { el = src.createElement("figure"); el.appendChild(src.createElement("img")); }
        var img = el.tagName === "IMG" ? el : el.querySelector("img");
        if (!img) { img = src.createElement("img"); el.insertBefore(img, el.firstChild); }
        img.setAttribute("src", im.url); img.setAttribute("alt", ""); img.removeAttribute("srcset");
        [].forEach.call(el.querySelectorAll("figcaption"), function (fc) {
          var tw = src.createTreeWalker(fc, NodeFilter.SHOW_TEXT), nodes = [], n;
          while ((n = tw.nextNode())) nodes.push(n);
          nodes.forEach(function (x) { x.textContent = ""; });
        });
        if (sg.matches(".gallery-grid")) { if (im.h > im.w * 1.1) el.classList.add("portrait"); else el.classList.remove("portrait"); }
        el.removeAttribute("id");
        freshIds(el);
        sg.appendChild(src.createTextNode("\n      "));
        sg.appendChild(el);
        if (!first) first = el.getAttribute("data-axk");
      });
      endChange({ rerender: true, focus: first });
      toast("已追加 " + ims.length + " 张图，记得点「保存」");
    });
  }
  function removeImageItem(itemId) {
    beginChange();
    var s = byId(srcDoc(), itemId); if (s) s.remove();
    endChange({ rerender: true });
    toast("已删除这张图（点「撤销」可以恢复）");
  }

  // 把电脑里的图片拖进网页
  var dropHi = null;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
  function dropTarget(t) {
    if (t && t.nodeType !== 1) t = t.parentElement;
    if (!t) return null;
    if (imgEditable(t)) return t;
    var g = t.closest("[data-ax-gal]");
    return g || null;
  }
  function onDragOver(e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    var tg = dropTarget(e.target);
    if (dropHi !== tg) {
      if (dropHi) dropHi.classList.remove("ax-dropimg", "ax-dropzone");
      dropHi = tg;
      if (tg) tg.classList.add(tg.tagName === "IMG" ? "ax-dropimg" : "ax-dropzone");
    }
  }
  function onDragLeave(e) {
    if (dropHi && e.target === dropHi) { dropHi.classList.remove("ax-dropimg", "ax-dropzone"); dropHi = null; }
  }
  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (dropHi) { dropHi.classList.remove("ax-dropimg", "ax-dropzone"); dropHi = null; }
    var files = [].filter.call(e.dataTransfer.files, isImg);
    if (!files.length) return toast("拖进来的不是图片", true);
    if (!S.edit) setEdit(true);
    var tg = dropTarget(e.target);
    if (tg && tg.tagName === "IMG") {
      replaceImage(tg, files[0]);
      var g = tg.closest("[data-ax-gal]");
      if (files.length > 1 && g) appendImages(g, files.slice(1));
    } else if (tg) appendImages(tg, files);
    else {
      var blk = e.target.nodeType === 1 && e.target.closest("[data-ax-block]");
      if (blk) setCurBlock(blk);
      openAdd(files);
    }
  }
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });

  /* ---------------- 板块工具条 ---------------- */
  function siblingBlock(el, dir) {
    var n = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (n && !n.hasAttribute("data-ax-block")) n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
    return n;
  }
  function blockAction(act, blk) {
    if (!blk) return;
    finishEdit();
    setCurBlock(blk);
    var src = srcDoc(), id = blk.getAttribute("data-axk"), s = byId(src, id);
    if (!s) return;
    if (act === "drag") return toast("按住「⠿ 拖动」不放，上下拖到想要的位置再松手");
    if (act === "up" || act === "down") {
      var sib = siblingBlock(blk, act === "up" ? -1 : 1);
      if (!sib) return toast(act === "up" ? "已经在最上面了" : "已经在最下面了");
      beginChange();
      var ss = byId(src, sib.getAttribute("data-axk"));
      if (act === "up") ss.parentNode.insertBefore(s, ss); else ss.parentNode.insertBefore(s, ss.nextSibling);
      endChange({ rerender: true, focus: id });
    } else if (act === "swap") {
      beginChange();
      if (s.classList.contains("detail-module")) {
        var left = s.classList.contains("detail-module--media-left");
        s.classList.toggle("detail-module--media-left", !left);
        s.classList.toggle("detail-module--media-right", left);
      } else {
        var kids = [].filter.call(s.children, function (c) { return c.matches(".axb-media, .axb-text"); });
        if (kids.length === 2) s.insertBefore(kids[1], kids[0]);
      }
      endChange({ rerender: true, focus: id });
    } else if (act === "addimg") {
      var g = blk.matches("[data-ax-gal]") ? blk : blk.querySelector("[data-ax-gal]");
      if (g) pickFiles(true, function (fs) { appendImages(g, fs); });
    } else if (act === "addafter") {
      S.insertAfter = id; openAdd();
    } else if (act === "del") {
      if (!confirm("确定删除这个板块吗？\n（删错了可以点「撤销」恢复）")) return;
      beginChange(); s.remove(); S.lastBlock = null;
      endChange({ rerender: true });
      toast("板块已删除（点「撤销」可以恢复）");
    }
  }

  /* ---------------- 新增板块 ---------------- */
  function openAdd(files) {
    if (!S.cur) return;
    finishEdit();
    if (!S.edit) setEdit(true);
    S.modalImgs = []; S.modalTpl = null; S.modalFiles = files || null;
    $("axModalTitle").textContent = files ? "用这 " + files.length + " 张图新增板块：选一个样式" : "新增板块：选一个样式";
    $("axTpls").hidden = false; $("axDrop").hidden = true;
    $("axModal").hidden = false;
  }
  function closeAdd() { $("axModal").hidden = true; S.insertAfter = null; }
  function buildTpls() {
    $("axTpls").innerHTML = TEMPLATES.map(function (t) {
      return '<div class="tpl" data-tpl="' + t.id + '"><div class="pic">' + t.pic + "</div><b>" + t.name + "</b><small>" + t.desc + "</small></div>";
    }).join("");
    $("axTpls").addEventListener("click", function (e) {
      var c = e.target.closest(".tpl"); if (!c) return;
      chooseTpl(TEMPLATES.filter(function (t) { return t.id === c.getAttribute("data-tpl"); })[0]);
    });
  }
  function chooseTpl(t) {
    S.modalTpl = t;
    if (!t.imgs) { insertBlocks(t, []); return; }
    $("axTpls").hidden = true; $("axDrop").hidden = false;
    $("axModalTitle").textContent = "「" + t.name + "」：把图片放进来";
    renderDropList();
    if (S.modalFiles) { var fs = S.modalFiles; S.modalFiles = null; addModalFiles(fs); }
  }
  function addModalFiles(fs) {
    $("axDropOk").disabled = true; $("axDropOk").textContent = "正在压缩…";
    prepAll(fs).then(function (ims) { S.modalImgs = S.modalImgs.concat(ims); renderDropList(); });
  }
  function renderDropList() {
    $("axDropList").innerHTML = S.modalImgs.map(function (im) { return '<img src="' + im.url + '" alt="">'; }).join("");
    var ok = $("axDropOk"); ok.disabled = !S.modalImgs.length;
    var t = S.modalTpl;
    var n = S.modalImgs.length;
    ok.textContent = !n ? "放进页面" : (t && /split|full/.test(t.id) && n > 1 ? "放进页面（会做成 " + n + " 个板块）" : "放进页面（" + n + " 张图）");
  }
  function insertBlocks(t, ims) {
    var src = srcDoc();
    var html = [];
    var cap = '<figcaption></figcaption>';
    function im(u) { return '<img src="' + u.url + '" alt="" loading="lazy">'; }
    if (t.id === "split-l" || t.id === "split-r") {
      ims.forEach(function (u, i) {
        var mediaFirst = (t.id === "split-l") === (i % 2 === 0);
        var media = '<figure class="axb-media">' + im(u) + "</figure>";
        var text = '<div class="axb-text"><h2></h2><p></p></div>';
        html.push('<section class="axb axb-split" id="blk-' + rid() + '">' + (mediaFirst ? media + text : text + media) + "</section>");
      });
    } else if (t.id === "full") {
      ims.forEach(function (u) { html.push('<section class="axb axb-full" id="blk-' + rid() + '"><figure class="axb-media">' + im(u) + cap + "</figure></section>"); });
    } else if (t.id === "grid2" || t.id === "grid3") {
      html.push('<section class="axb axb-grid" id="blk-' + rid() + '"><h2></h2><div class="axb-items axb-cols-' + (t.id === "grid2" ? 2 : 3) + '">' +
        ims.map(function (u) { return '<figure class="axb-item">' + im(u) + cap + "</figure>"; }).join("") + "</div></section>");
    } else {
      html.push('<section class="axb axb-textonly" id="blk-' + rid() + '"><h2></h2><p></p></section>');
    }
    beginChange();
    var tmp = src.createElement("div"); tmp.innerHTML = html.join("");
    var nodes = [].slice.call(tmp.children);
    var anchorId = S.insertAfter || S.lastBlock, anchor = anchorId && byId(src, anchorId), ref = null, parent = null;
    if (anchor && anchor.parentElement && (anchor.parentElement.matches("main, .detail-modules"))) { parent = anchor.parentElement; ref = anchor.nextSibling; }
    else {
      parent = src.querySelector(".detail-modules");
      if (!parent) { parent = src.querySelector("main") || src.body; var ft = parent.querySelector(":scope > footer"); ref = ft || null; }
    }
    nodes.forEach(function (n) {
      assignIds(n);
      parent.insertBefore(src.createTextNode("\n    "), ref);
      parent.insertBefore(n, ref);
    });
    var focus = nodes[0].getAttribute("data-axk");
    S.lastBlock = nodes[nodes.length - 1].getAttribute("data-axk");
    closeAdd();
    endChange({ rerender: true, focus: focus });
    toast("新板块已放好：点里面的文字可以填写；鼠标移到板块上，右上角可以拖动位置。", false, 6000);
  }
  (function setupDrop() {
    var zone = $("axDrop").querySelector(".drop-inner");
    zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("over"); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); zone.classList.remove("over");
      var fs = [].filter.call(e.dataTransfer.files || [], isImg);
      if (!fs.length) return toast("拖进来的不是图片", true);
      addModalFiles(fs);
    });
    $("axDropPick").onclick = function () { pickFiles(true, addModalFiles); };
    $("axDropBack").onclick = function () { $("axTpls").hidden = false; $("axDrop").hidden = true; $("axModalTitle").textContent = "新增板块：选一个样式"; };
    $("axDropOk").onclick = function () { if (S.modalImgs.length) insertBlocks(S.modalTpl, S.modalImgs); };
    $("axModalClose").onclick = closeAdd;
  })();

  /* ---------------- 本页图片面板 ---------------- */
  function galLabel(g) {
    if (g.matches(".gallery-grid")) return "图库";
    if (g.matches(".gallery2")) return "并排图";
    if (g.matches(".bw-thumbs")) return "小图组";
    if (g.matches(".axb-items")) return "多图板块";
    return "图组";
  }
  function setPanel(on) {
    S.panel = on && S.edit;
    $("axPanel").hidden = !S.panel;
    document.body.classList.toggle("with-panel", S.panel);
    $("axImgs").classList.toggle("active", S.panel);
    refreshPanel();
  }
  function refreshPanel() {
    if (!S.panel || !S.ld) return;
    var body = $("axPanelBody"); body.innerHTML = "";
    var imgs = [].filter.call(S.ld.querySelectorAll("main img[data-axk]"), function (i) { return imgEditable(i); });
    var groups = [], map = {};
    imgs.forEach(function (img) {
      var g = img.closest("[data-ax-gal]"), key, label, item = img;
      if (g) {
        key = g.getAttribute("data-axk"); label = galLabel(g);
        item = [].filter.call(g.children, function (c) { return c.contains(img); })[0] || img;
      } else if (img.closest(".detail-hero")) { key = "hero"; label = "标题大图"; }
      else if (img.closest(".project-media")) { key = "cover"; label = "项目封面（双击卡片进入项目）"; }
      else { key = "body"; label = "正文配图"; }
      if (!map[key]) { map[key] = { key: key, label: label, gal: g, items: [] }; groups.push(map[key]); }
      map[key].items.push({ img: img, item: item });
    });
    if (!groups.length) body.innerHTML = '<p class="panel-tip">这一页没有图片。可以点「＋ 新增板块」加图。</p>';
    groups.forEach(function (gr) {
      var box = document.createElement("div"); box.className = "grp";
      box.innerHTML = '<div class="grp-h"><span>' + esc(gr.label) + " <small>" + gr.items.length + " 张</small></span></div>";
      if (gr.gal) {
        var add = document.createElement("button"); add.className = "btn"; add.textContent = "＋ 追加图片";
        add.onclick = function () { pickFiles(true, function (fs) { appendImages(gr.gal, fs); }); };
        box.firstChild.appendChild(add);
      }
      var list = document.createElement("div"); list.className = "thumbs";
      gr.items.forEach(function (it, i) {
        var th = document.createElement("div"); th.className = "th";
        th.setAttribute("data-item", it.item.getAttribute("data-axk"));
        th.innerHTML = (gr.gal ? '<span class="grab" title="按住上下拖动换顺序">⠿</span>' : "") +
          '<img alt=""><div class="acts"><button class="btn" data-a="rep">换图</button>' + (gr.gal ? '<button class="btn" data-a="del">删除</button>' : "") + "</div>";
        th.querySelector("img").src = it.img.currentSrc || it.img.src;
        th.querySelector("img").onclick = function () { it.img.scrollIntoView({ block: "center", behavior: "smooth" }); flash(it.img); };
        th.querySelector('[data-a="rep"]').onclick = function () { pickFiles(false, function (fs) { replaceImage(it.img, fs[0]); }); };
        var del = th.querySelector('[data-a="del"]');
        if (del) del.onclick = function () { if (confirm("删除这张图？（可以撤销）")) removeImageItem(it.item.getAttribute("data-axk")); };
        list.appendChild(th);
      });
      box.appendChild(list); body.appendChild(box);
      if (gr.gal && window.Sortable) {
        window.Sortable.create(list, {
          handle: ".grab", animation: 150,
          onStart: function () { beginChange(); },
          onEnd: function (e) {
            if (e.oldIndex === e.newIndex) { S.snap = null; return; }
            var src = srcDoc(), sg = byId(src, gr.gal.getAttribute("data-axk"));
            var s = byId(src, e.item.getAttribute("data-item"));
            var nx = e.item.nextElementSibling, sn = nx && byId(src, nx.getAttribute("data-item"));
            if (s && sg) {
              var ws = s.previousSibling && s.previousSibling.nodeType === 3 && !s.previousSibling.textContent.trim() ? s.previousSibling : null;
              if (sn && sn.parentNode === sg) {
                var ref = sn.previousSibling && sn.previousSibling.nodeType === 3 && !sn.previousSibling.textContent.trim() ? sn.previousSibling : sn;
                if (ws) sg.insertBefore(ws, ref);
                sg.insertBefore(s, sn);
              } else {
                var last = [].filter.call(sg.children, function (c) { return c !== s; }).pop();
                if (ws) sg.insertBefore(ws, last ? last.nextSibling : null);
                sg.insertBefore(s, ws ? ws.nextSibling : (last ? last.nextSibling : null));
              }
            }
            endChange({ rerender: true, focus: e.item.getAttribute("data-item") });
          }
        });
      }
    });
  }

  /* ---------------- 保存 ---------------- */
  function blobToB64(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(",")[1]); };
      fr.onerror = rej; fr.readAsDataURL(b);
    });
  }
  function commitFiles(files, message, retry) {
    var headSha, entries = [];
    return gh(R + "/git/ref/heads/" + encodeURIComponent(BRANCH)).then(function (j) {
      headSha = j.object.sha;
      return gh(R + "/git/commits/" + headSha);
    }).then(function (c) {
      var baseTree = c.tree.sha, p = Promise.resolve();
      files.forEach(function (f) {
        p = p.then(function () {
          return (f.text !== undefined ? Promise.resolve({ content: f.text, encoding: "utf-8" }) :
            blobToB64(f.blob).then(function (b) { return { content: b, encoding: "base64" }; }))
            .then(function (body) { return gh(R + "/git/blobs", { method: "POST", body: body }); })
            .then(function (b) {
              entries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
              entries.push({ path: "public/" + f.path, mode: "100644", type: "blob", sha: b.sha });
            });
        });
      });
      return p.then(function () { return gh(R + "/git/trees", { method: "POST", body: { base_tree: baseTree, tree: entries } }); });
    }).then(function (tree) {
      return gh(R + "/git/commits", { method: "POST", body: { message: message, tree: tree.sha, parents: [headSha] } });
    }).then(function (cm) {
      return gh(R + "/git/refs/heads/" + encodeURIComponent(BRANCH), { method: "PATCH", body: { sha: cm.sha, force: false } }).then(function () { return cm.sha; });
    }).catch(function (e) {
      if (!retry && (e.status === 409 || e.status === 422)) return commitFiles(files, message, true);
      throw e;
    });
  }
  var saving = false;
  function save() {
    if (saving) return;
    finishEdit();
    var any = Object.keys(S.pages).some(function (p) { return S.pages[p].dirty; });
    if (!any) return toast("没有需要保存的修改");
    saving = true;
    busy("正在保存…（图片多的话要等一会儿）");
    var stamp, list, used = {};
    syncWorks().then(function () {
      stamp = new Date().toISOString();
      list = Object.keys(S.pages).filter(function (p) { return S.pages[p].dirty; });
      var files = [];
      list.forEach(function (p) {
        var html = cleanHtml(S.pages[p].doc, stamp).replace(/blob:[^"'\s)<>]+/g, function (m) {
          var b = S.blobs[m]; if (!b) return m; used[m] = b; return b.path;
        });
        if (/["'(]blob:/.test(html)) throw new Error("有图片没处理好，请把那张图重新换一次");
        files.push({ path: p, text: html });
      });
      Object.keys(used).forEach(function (u) { files.push({ path: used[u].path, blob: used[u].blob }); });
      var n = Object.keys(used).length;
      var msg = "网站编辑：" + list.map(pageName).join("、") + (n ? "（新图 " + n + " 张）" : "");
      return commitFiles(files, msg);
    }).then(function (sha) {
      saving = false; busy();
      S.head = sha; S.headAt = Date.now();
      Object.keys(used).forEach(function (u) { S.uploaded[used[u].path] = u; });
      list.forEach(function (p) {
        var pg = S.pages[p]; pg.orig = cleanHtml(pg.doc, null); pg.base = serialize(pg.doc); pg.origWorks = worksOf(pg.doc); pg.dirty = false;
      });
      updateUI();
      if (BRANCH !== "main") { setStatus("已保存到测试分支 " + BRANCH + "（不会上线）", "ok"); toast("已保存 ✓（测试分支，不会上线）"); return; }
      toast("已保存 ✓ 大约 1 分钟后网站上就能看到", false, 6000);
      setStatus("已保存，正在上线…", "ok");
      pollLive(list[0], stamp);
    }).catch(function (e) {
      saving = false; busy();
      toast("保存没成功：" + e.message + "。改动还在，可以再点一次「保存」。", true, 9000);
      if (e.status === 401) { localStorage.removeItem(TOKEN_KEY); showLogin("登录已过期，请重新登录（改动还在，登录后再保存）。"); }
      updateUI();
    });
  }
  var liveTimer = null;
  function pollLive(path, stamp) {
    clearInterval(liveTimer);
    var n = 0;
    liveTimer = setInterval(function () {
      n++;
      fetch("/" + path + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (tx) {
        if (tx.indexOf(stamp) >= 0) {
          clearInterval(liveTimer); liveTimer = null;
          setStatus("已上线 ✓", "ok");
          toast("网站已更新 ✓ 现在打开网站就能看到新内容", false, 6000);
        }
      }).catch(function () {});
      if (n > 45) { clearInterval(liveTimer); liveTimer = null; setStatus("已保存；上线比平时慢，过几分钟刷新网站看看", "ok"); }
    }, 6000);
  }

  /* ---------------- 顶部按钮 / 状态 ---------------- */
  var statusMsg = null;
  function setStatus(msg, cls) { statusMsg = msg ? { msg: msg, cls: cls || "" } : null; updateUI(); }
  function updateUI() {
    var dirty = Object.keys(S.pages).filter(function (p) { return S.pages[p].dirty; });
    var st = $("axStatus");
    if (dirty.length) {
      st.textContent = dirty.length + " 页未保存";
      st.title = "还没保存的页面：" + dirty.map(pageName).join("、");
      st.className = "status dirty";
    } else if (statusMsg) { st.textContent = statusMsg.msg; st.className = "status " + statusMsg.cls; }
    else { st.textContent = "已全部保存"; st.className = "status"; }
    if (!dirty.length) st.title = "";
    if (dirty.length) statusMsg = null;
    var pg = curPg();
    $("axUndo").disabled = !pg || !pg.undo.length;
    $("axRedo").disabled = !pg || !pg.redo.length;
    $("axDiscard").disabled = !dirty.length;
    $("axSave").textContent = dirty.length ? "保存（" + dirty.length + "）" : "保存";
    fillSelect();
  }
  function setEdit(on) {
    S.edit = on;
    if (!on) { finishEdit(); setPanel(false); }
    var b = $("axEditToggle"); b.classList.toggle("on", on); b.textContent = on ? "编辑模式：开" : "编辑模式：关";
    document.body.classList.toggle("editing", on);
    $("axHint").textContent = "点文字直接改 · 点图片换图（或把图片拖到图上）· 双击项目卡片进入项目 · 鼠标移到板块上，右上角可拖动/删除";
    if (S.ld) {
      S.ld.documentElement.classList.toggle("ax-on", on);
      if (!on && hoverEl) hoverEl.classList.remove("ax-hover");
      S.sortables.forEach(function (s) { try { s.option("disabled", !on); } catch (e) {} });
      if (on && S.cur && /^al-/.test(S.cur)) setPanel(true);
    }
  }
  $("axEditToggle").onclick = function () { setEdit(!S.edit); };
  $("axAdd").onclick = function () { S.insertAfter = null; openAdd(); };
  $("axImgs").onclick = function () { if (!S.edit) setEdit(true); setPanel(!S.panel); };
  $("axPanelClose").onclick = function () { setPanel(false); };
  $("axUndo").onclick = undo;
  $("axRedo").onclick = redo;
  $("axSave").onclick = save;
  $("axMobile").onclick = function () { var on = $("axStage").classList.toggle("mobile"); this.classList.toggle("active", on); this.textContent = on ? "🖥 电脑效果" : "📱 手机效果"; };
  $("axPage").onchange = function () { openPage(this.value); };
  $("axDiscard").onclick = function () {
    if (!confirm("确定把还没保存的修改全部丢掉吗？")) return;
    finishEdit();
    Object.keys(S.pages).forEach(function (p) {
      var pg = S.pages[p]; if (!pg.dirty) return;
      pg.doc = parse(pg.base); pg.undo = []; pg.redo = []; pg.dirty = false;
    });
    rerender(); toast("已放弃未保存的修改");
  };
  $("axHelp").onclick = function () { $("axHelpBox").hidden = false; };
  $("axHelpBox").addEventListener("click", function (e) { if (e.target === this || e.target.hasAttribute("data-close")) this.hidden = true; });
  $("axLogout").onclick = function () {
    var dirty = Object.keys(S.pages).some(function (p) { return S.pages[p].dirty; });
    if (dirty && !confirm("还有改动没保存，退出就没了。确定退出吗？")) return;
    localStorage.removeItem(TOKEN_KEY); S.pages = {}; location.hash = ""; location.reload();
  };
  $("axLoginBtn").onclick = startLogin;
  window.addEventListener("beforeunload", function (e) {
    if (Object.keys(S.pages).some(function (p) { return S.pages[p].dirty; })) { e.preventDefault(); e.returnValue = ""; }
  });

  buildTpls();
  setEdit(false);
  S.token = localStorage.getItem(TOKEN_KEY);
  if (S.token) afterLogin(); else showLogin();
  if (BRANCH !== "main") document.title = "【测试分支 " + BRANCH + "】" + document.title;
  window.__axEditor = S; // 方便自测
})();

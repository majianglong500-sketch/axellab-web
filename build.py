#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scan content/ and generate project pages + update lists."""
from __future__ import annotations
import re, shutil
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
ASSETS_OUT = ROOT / "assets" / "projects"
PUBLIC = ROOT / "public"  # Cloudflare / wrangler deploy root (no .git, no content/)

# Legacy projects already live as static HTML (not content-driven)
LEGACY = [
    {
        "id": "AL_2026_001",
        "slug": "al-2026-001",
        "title_cn": "20天全案落地",
        "title_en": "20-Day Full Delivery",
        "summary_cn": "中国移动旗舰店，从 Rhino 模型到加工与现场落地。",
        "summary_en": "China Mobile flagship store — from Rhino model to fabrication and on-site completion.",
        "cover": "assets/al001-hero.jpg",
        "url": "al-2026-001.html",
        "order": 10,
        "featured": True,
    },
    {
        "id": "AL_2026_002",
        "slug": "al-2026-002",
        "title_cn": "堡垒式公共标识",
        "title_en": "Fortress-Like Public Signage",
        "summary_cn": "户外标识形态、加工与现场安装记录。",
        "summary_en": "Outdoor signage form, fabrication and installation record.",
        "cover": "assets/al002-hero.jpg",
        "url": "al-2026-002.html",
        "order": 20,
        "featured": True,
    },
    {
        "id": "AL_2026_003",
        "slug": "al-2026-003",
        "title_cn": "照片雕刻实验",
        "title_en": "Photo Engraving Study",
        "summary_cn": "图像转浮雕的 CNC 雕刻与材料实验。",
        "summary_en": "Image-to-relief CNC engraving and material experiment.",
        "cover": "assets/al003-hero.jpg",
        "url": "al-2026-003.html",
        "order": 30,
        "featured": True,
    },
]

NAV = '''  <header class="nav">
    <div class="nav-inner">
      <a class="logo" href="index.html"><span class="brace">AL</span> AXEL LAB</a>
      <nav class="nav-links">
        <a class="active" href="projects.html"><span class="cn">项目</span><span class="en">Work</span></a>
        <a href="built-works.html"><span class="cn">落地案例</span><span class="en">Built Works</span></a>
        <a href="labnotes.html"><span class="cn">实验笔记</span><span class="en">Lab Notes</span></a>
        <a href="about.html"><span class="cn">关于</span><span class="en">About</span></a>
        <button class="lang-btn">EN</button>
      </nav>
    </div>
  </header>'''

FOOT_SCRIPTS = """  <div class=\"lightbox\" id=\"lb\"><span class=\"close\" id=\"lbClose\">CLOSE ✕</span><img id=\"lbImg\" alt=\"\"></div>
  <script src=\"main.js\"></script>
  <script>
    (function(){
      var lb=document.getElementById('lb'),li=document.getElementById('lbImg');
      if(lb){
        document.querySelectorAll('.gallery-grid img,.detail-hero img,.gallery2 img,.detail-module__media img').forEach(function(i){
          i.style.cursor='zoom-in';
          i.onclick=function(){li.src=i.src;lb.classList.add('open');};
        });
        document.getElementById('lbClose').onclick=function(){lb.classList.remove('open');};
        lb.onclick=function(e){if(e.target===lb)lb.classList.remove('open');};
      }
      var toc=document.getElementById('detailToc');
      if(toc){
        var links=[].slice.call(toc.querySelectorAll('a[href^=\"#\"]'));
        var map={};
        links.forEach(function(a){
          var id=a.getAttribute('href').slice(1);
          var el=document.getElementById(id);
          if(el) map[id]={el:el,a:a};
        });
        var ids=Object.keys(map);
        if(ids.length && 'IntersectionObserver' in window){
          var io=new IntersectionObserver(function(entries){
            entries.forEach(function(en){
              if(en.isIntersecting){
                links.forEach(function(a){a.classList.remove('is-active');});
                var hit=map[en.target.id];
                if(hit) hit.a.classList.add('is-active');
              }
            });
          },{rootMargin:'-30% 0px -55% 0px',threshold:0});
          ids.forEach(function(id){io.observe(map[id].el);});
        }
      }
      var reveal=document.querySelectorAll('.detail-module,.metric-chip,.gallery-grid figure,.detail-hero');
      if(reveal.length && 'IntersectionObserver' in window){
        var rio=new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if(en.isIntersecting){en.target.classList.add('is-in');rio.unobserve(en.target);}
          });
        },{rootMargin:'0px 0px -8% 0px',threshold:0.08});
        reveal.forEach(function(el){el.classList.add('will-in');rio.observe(el);});
      } else {
        reveal.forEach(function(el){el.classList.add('is-in');});
      }
    })();
  </script>
</body>
</html>
"""



def meta_line(text: str, key: str) -> str:
    m = re.search(rf"^-\s*{re.escape(key)}:\s*(.+)$", text, re.M)
    return m.group(1).strip() if m else ""


def section_body(text: str, heading: str) -> str:
    pat = rf"^##\s+{re.escape(heading)}\s*\n(.*?)(?=^##\s+|\Z)"
    m = re.search(pat, text, re.M | re.S)
    return m.group(1).strip() if m else ""


def split_frontmatter(text: str) -> tuple[dict | None, str]:
    """Return (yaml_data, body) if file starts with --- frontmatter, else (None, text)."""
    if not text.lstrip().startswith("---"):
        return None, text
    # strip optional BOM / leading whitespace
    raw = text.lstrip("\ufeff").lstrip()
    parts = raw.split("---", 2)
    # parts[0] == '', parts[1] == yaml, parts[2] == rest
    if len(parts) < 3:
        return None, text
    if yaml is None:
        raise SystemExit(
            "文案.md 使用了 YAML frontmatter，需要 PyYAML。\n"
            "  pip install -r requirements.txt\n"
            "或: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
        )
    data = yaml.safe_load(parts[1]) or {}
    if not isinstance(data, dict):
        return None, text
    return data, parts[2]


def parse_project_from_yaml(folder: Path, data: dict) -> dict | None:
    online = data.get("online", True)
    if isinstance(online, str):
        online = online in ("是", "yes", "Yes", "true", "True", "1")
    if online is False:
        print(f"  skip offline: {folder.name}")
        return None

    slug = str(data.get("slug") or folder.name)
    pid = str(data.get("id") or slug.upper().replace("-", "_"))
    cover = str(data.get("cover") or "cover.jpg")
    try:
        order = int(data.get("order", 100))
    except (TypeError, ValueError):
        order = 100

    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    modules = []
    for m in data.get("modules") or []:
        if not isinstance(m, dict):
            continue
        modules.append(
            {
                "title_cn": str(m.get("title_cn") or ""),
                "title_en": str(m.get("title_en") or m.get("title_cn") or ""),
                "cn": str(m.get("cn") or ""),
                "en": str(m.get("en") or ""),
            }
        )

    gallery = []
    for g in data.get("gallery") or []:
        if not isinstance(g, dict) or not g.get("file"):
            continue
        por = g.get("portrait", False)
        if isinstance(por, str):
            por = por in ("是", "yes", "Yes", "true", "True", "1")
        gallery.append(
            {
                "file": str(g["file"]).strip(),
                "caption_cn": str(g.get("caption_cn") or ""),
                "caption_en": str(g.get("caption_en") or ""),
                "portrait": bool(por),
            }
        )

    video = None
    v = data.get("video")
    if isinstance(v, dict) and v.get("file"):
        video = {
            "file": str(v["file"]).strip(),
            "poster": str(v.get("poster") or cover).strip(),
            "title_cn": str(v.get("title_cn") or "短片"),
            "title_en": str(v.get("title_en") or "Short film"),
        }

    metrics = []
    for m in data.get("metrics") or []:
        if isinstance(m, dict) and m.get("value") is not None:
            metrics.append(
                {
                    "value": str(m["value"]),
                    "label_cn": str(m.get("label_cn") or ""),
                    "label_en": str(m.get("label_en") or m.get("label_cn") or ""),
                }
            )

    related = []
    for r in data.get("related") or []:
        s = str(r).strip()
        if s:
            related.append(s)

    title_cn = str(data.get("title_cn") or folder.name)
    title_en = str(data.get("title_en") or data.get("summary_en") or title_cn)

    return {
        "folder": folder,
        "id": pid,
        "slug": slug,
        "title_cn": title_cn,
        "title_en": title_en,
        "title_en_page": None,
        "cat_cn": str(data.get("cat_cn") or ""),
        "cat_en": str(data.get("cat_en") or ""),
        "tags": list(tags),
        "summary_cn": str(data.get("summary_cn") or ""),
        "summary_en": str(data.get("summary_en") or ""),
        "cover": cover,
        "order": order,
        "lead_cn": str(data.get("lead_cn") or ""),
        "lead_en": str(data.get("lead_en") or ""),
        "modules": modules,
        "gallery": gallery,
        "video": video,
        "metrics": metrics,
        "related": related,
        "url": f"{slug}.html",
        "cover_web": f"assets/projects/{slug}/{cover}",
    }


def parse_project(folder: Path) -> dict | None:
    md_path = folder / "文案.md"
    if not md_path.exists():
        return None
    text = md_path.read_text(encoding="utf-8")
    fm, _body = split_frontmatter(text)
    if fm is not None:
        return parse_project_from_yaml(folder, fm)

    # --- legacy Chinese section format (怎么换图改字.md) ---
    title_m = re.search(r"^#\s+(.+)$", text, re.M)
    title_cn = title_m.group(1).strip() if title_m else folder.name

    meta = section_body(text, "元信息")
    online = meta_line(meta, "上线")
    if online and online not in ("是", "yes", "Yes", "true", "True", "1"):
        print(f"  skip offline: {folder.name}")
        return None

    slug = meta_line(meta, "slug") or folder.name
    pid = meta_line(meta, "id") or slug.upper().replace("-", "_")
    cat_cn = meta_line(meta, "分类中文")
    cat_en = meta_line(meta, "分类英文")
    tags = [t.strip() for t in meta_line(meta, "标签").split(",") if t.strip()]
    summary_cn = meta_line(meta, "列表摘要中文")
    summary_en = meta_line(meta, "列表摘要英文")
    cover = meta_line(meta, "封面图") or "cover.jpg"
    order_s = meta_line(meta, "排序") or "100"
    try:
        order = int(order_s)
    except ValueError:
        order = 100

    lead = section_body(text, "导语")
    lead_cn = lead_en = ""
    mcn = re.search(r"###\s*中文\s*\n(.*?)(?=###|\Z)", lead, re.S)
    men = re.search(r"###\s*英文\s*\n(.*?)(?=###|\Z)", lead, re.S)
    if mcn:
        lead_cn = mcn.group(1).strip()
    if men:
        lead_en = men.group(1).strip()

    modules = []
    mod_sec = section_body(text, "模块")
    for m in re.finditer(
        r"###\s+(.+?)\s*\n\*\*中文:\*\*\s*(.*?)\n\*\*英文:\*\*\s*(.*?)(?=\n###|\Z)",
        mod_sec,
        re.S,
    ):
        title_raw = m.group(1).strip()
        if "|" in title_raw:
            tcn, ten = [x.strip() for x in title_raw.split("|", 1)]
        else:
            tcn, ten = title_raw, title_raw
        modules.append(
            {
                "title_cn": tcn,
                "title_en": ten,
                "cn": m.group(2).strip(),
                "en": m.group(3).strip(),
            }
        )

    gallery = []
    gal_sec = section_body(text, "图库")
    for block in re.split(r"(?=\n?- file:)", "\n" + gal_sec):
        fm = re.search(r"file:\s*(\S+)", block)
        if not fm:
            continue
        ccn = re.search(r"caption_cn:\s*(.+)", block)
        cen = re.search(r"caption_en:\s*(.+)", block)
        por = re.search(r"portrait:\s*(.+)", block)
        portrait = False
        if por:
            portrait = por.group(1).strip() in ("是", "yes", "Yes", "true", "True", "1")
        gallery.append(
            {
                "file": fm.group(1).strip(),
                "caption_cn": ccn.group(1).strip() if ccn else "",
                "caption_en": cen.group(1).strip() if cen else "",
                "portrait": portrait,
            }
        )

    video = None
    vid_sec = section_body(text, "视频")
    if vid_sec.strip():
        vf = re.search(r"file:\s*(\S+)", vid_sec)
        if vf:
            poster = re.search(r"poster:\s*(\S+)", vid_sec)
            tcn = re.search(r"title_cn:\s*(.+)", vid_sec)
            ten = re.search(r"title_en:\s*(.+)", vid_sec)
            video = {
                "file": vf.group(1).strip(),
                "poster": poster.group(1).strip() if poster else cover,
                "title_cn": tcn.group(1).strip() if tcn else "短片",
                "title_en": ten.group(1).strip() if ten else "Short film",
            }

    metrics = []
    met_sec = section_body(text, "指标")
    for line in met_sec.splitlines():
        line = line.strip().lstrip("-").strip()
        if not line or line.startswith("#") or line.startswith("<!--"):
            continue
        parts = [x.strip() for x in line.split("|")]
        if len(parts) >= 3:
            metrics.append({"value": parts[0], "label_cn": parts[1], "label_en": parts[2]})
        elif len(parts) == 2:
            metrics.append({"value": parts[0], "label_cn": parts[1], "label_en": parts[1]})

    related = []
    rel_sec = section_body(text, "相关项目")
    for line in rel_sec.splitlines():
        line = line.strip().lstrip("-").strip()
        if line and not line.startswith("#"):
            related.append(line)

    return {
        "folder": folder,
        "id": pid,
        "slug": slug,
        "title_cn": title_cn,
        "title_en": summary_en and title_cn,  # placeholder; set below from EN title if needed
        "title_en_page": None,
        "cat_cn": cat_cn,
        "cat_en": cat_en,
        "tags": tags,
        "summary_cn": summary_cn,
        "summary_en": summary_en,
        "cover": cover,
        "order": order,
        "lead_cn": lead_cn,
        "lead_en": lead_en,
        "modules": modules,
        "gallery": gallery,
        "video": video,
        "metrics": metrics,
        "related": related,
        "url": f"{slug}.html",
        "cover_web": f"assets/projects/{slug}/{cover}",
    }


# Fix title_en: try to read from first line after # or from a dedicated field — use English from lead heading pattern
# We'll set title_en from a convention: look for "英文标题" in meta, else derive from summary
def refine_title_en(p: dict, text: str) -> None:
    m = re.search(r"^-\s*标题英文:\s*(.+)$", text, re.M)
    if m:
        p["title_en"] = m.group(1).strip()
        return
    # Heuristic known titles
    known = {
        "第九师校园文化建设": "Campus Culture, Ninth Division",
        "商业形象空间": "Commercial Brand Space",
        "医药企业形象空间": "Commercial Brand Space",  # legacy title fallback
    }
    p["title_en"] = known.get(p["title_cn"], p["summary_en"] or p["title_cn"])


def copy_assets(p: dict) -> None:
    src = p["folder"] / "images"
    dst = ASSETS_OUT / p["slug"]
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        print(f"  WARN no images/: {p['folder'].name}")
        return
    for f in src.iterdir():
        if f.is_file() and f.name != "把图放这里.txt":
            shutil.copy2(f, dst / f.name)


def render_detail(p: dict, by_slug: dict) -> str:
    tags_html = "".join(f'<span class="tag">{t}</span>' for t in p["tags"])

    # Metric chips (optional)
    metrics_html = ""
    if p.get("metrics"):
        chips = []
        for m in p["metrics"]:
            chips.append(
                "      <div class=\"metric-chip\">\n"
                f"        <span class=\"metric-chip__value\">{m['value']}</span>\n"
                f"        <span class=\"metric-chip__label\"><span class=\"cn\">{m['label_cn']}</span>"
                f"<span class=\"en\">{m['label_en']}</span></span>\n"
                "      </div>"
            )
        metrics_html = "\n    <div class=\"metric-chips\">\n" + "\n".join(chips) + "\n    </div>"

    gallery = p["gallery"]
    modules_html = []
    toc_items = []
    for i, mod in enumerate(p["modules"], 1):
        mid = f"mod-{i:02d}"
        toc_items.append(
            f'      <a href="#{mid}" data-n="{i:02d}">'
            f'<span class="toc-n">{i:02d}</span>'
            f'<span class="toc-label"><span class="cn">{mod["title_cn"]}</span>'
            f'<span class="en">{mod["title_en"]}</span></span></a>'
        )
        alt = "media-right" if i % 2 == 1 else "media-left"
        g = gallery[i - 1] if i - 1 < len(gallery) else None
        if g:
            src = f'assets/projects/{p["slug"]}/{g["file"]}'
            por = " portrait" if g["portrait"] else ""
            media_html = (
                f'      <div class="detail-module__media{por}">\n'
                f'        <img src="{src}" alt="{g["caption_cn"]}" loading="lazy">\n'
                f'        <figcaption><span class="cn">{g["caption_cn"]}</span>'
                f'<span class="en">{g["caption_en"]}</span></figcaption>\n'
                f"      </div>"
            )
        else:
            media_html = (
                '      <div class="detail-module__media detail-module__media--empty"'
                ' aria-hidden="true"></div>'
            )
        modules_html.append(
            f'    <section class="detail-module detail-module--{alt}" id="{mid}">\n'
            f'      <div class="detail-module__text">\n'
            f'        <h2><span class="mod-n">{i:02d}</span> '
            f'<span class="cn">{mod["title_cn"]}</span>'
            f'<span class="en">{mod["title_en"]}</span></h2>\n'
            f'        <p><span class="cn">{mod["cn"]}</span>'
            f'<span class="en">{mod["en"]}</span></p>\n'
            f"      </div>\n"
            f"{media_html}\n"
            f"    </section>"
        )

    if gallery:
        toc_items.append(
            '      <a href="#gallery" data-n="GAL"><span class="toc-n">GAL</span>'
            '<span class="toc-label"><span class="cn">图库</span>'
            '<span class="en">Gallery</span></span></a>'
        )
    if p.get("video"):
        toc_items.append(
            '      <a href="#film" data-n="FILM"><span class="toc-n">FILM</span>'
            '<span class="toc-label"><span class="cn">短片</span>'
            '<span class="en">Film</span></span></a>'
        )

    toc_html = ""
    if toc_items:
        toc_html = (
            '    <aside class="detail-toc" id="detailToc" aria-label="Sections">\n'
            + "\n".join(toc_items)
            + "\n    </aside>\n"
        )

    gal_html = []
    for g in gallery:
        cls = ' class="portrait"' if g["portrait"] else ""
        src = f'assets/projects/{p["slug"]}/{g["file"]}'
        gal_html.append(
            f'      <figure{cls}><img src="{src}" alt="{g["caption_cn"]}" loading="lazy">\n'
            f'        <figcaption><span class="cn">{g["caption_cn"]}</span>'
            f'<span class="en">{g["caption_en"]}</span></figcaption></figure>'
        )

    video_html = ""
    if p["video"]:
        v = p["video"]
        poster = f'assets/projects/{p["slug"]}/{v["poster"]}'
        src = f'assets/projects/{p["slug"]}/{v["file"]}'
        video_html = (
            f'    <div class="sub-head" id="film"><span class="kicker">FILM</span>'
            f'<h2><span class="cn">{v["title_cn"]}</span>'
            f'<span class="en">{v["title_en"]}</span></h2></div>\n'
            f'    <div class="video-block"><video controls playsinline preload="metadata" '
            f'poster="{poster}" src="{src}"></video></div>\n'
        )

    related_html = ""
    if p["related"]:
        links = []
        for slug in p["related"]:
            other = by_slug.get(slug)
            if not other:
                for L in LEGACY:
                    if L["slug"] == slug:
                        other = L
                        break
            if other:
                title = other.get("title_cn", slug)
                url = other.get("url", f"{slug}.html")
                links.append(f'<a class="btn btn-ghost" href="{url}">{title} →</a>')
        if links:
            related_html = (
                '    <div class="detail-related">\n'
                '      <h2><span class="cn">相关项目</span><span class="en">Related</span></h2>\n'
                f'      <div class="detail-related__links">{"".join(links)}</div>\n'
                "    </div>\n"
            )

    cover_src = p["cover_web"]
    gallery_section = ""
    if gal_html:
        gallery_section = (
            '    <div class="sub-head" id="gallery"><span class="kicker">GALLERY</span>'
            '<h2><span class="cn">图库</span><span class="en">Gallery</span></h2></div>\n'
            '    <div class="gallery-grid gallery-masonry">\n'
            + "\n".join(gal_html)
            + "\n    </div>\n"
        )

    return f"""<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{p["title_cn"]} — AXEL LAB</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body class="lang-cn">
{NAV}
  <main class="page detail-page">
    <section class="detail-intro">
      <div class="eyebrow">{p["id"]} / <span class="cn">{p["cat_cn"]}</span><span class="en">{p["cat_en"]}</span></div>
      <h1 class="page-title"><span class="cn">{p["title_cn"]}</span><span class="en">{p["title_en"]}</span></h1>
      <p class="hero-copy"><span class="cn">{p["lead_cn"]}</span><span class="en">{p["lead_en"]}</span></p>
      <div class="tag-row">{tags_html}</div>{metrics_html}
    </section>

    <figure class="detail-hero"><img src="{cover_src}" alt="{p["title_cn"]}"></figure>

    <div class="detail-body">
{toc_html}      <div class="detail-modules">
{chr(10).join(modules_html)}
      </div>
    </div>

{gallery_section}{video_html}{related_html}
    <footer>
      <div><span class="cn">© 2026 AXEL LAB</span><span class="en">© 2026 AXEL LAB</span></div>
      <div><a href="projects.html"><span class="cn">← 返回项目</span><span class="en">← Back to Work</span></a></div>
    </footer>
  </main>
{FOOT_SCRIPTS}
"""



def project_card(p: dict) -> str:
    return f'''          <a class="project" href="{p["url"]}">
            <div class="project-media"><img src="{p.get("cover_web", p.get("cover"))}" alt=""></div>
            <div class="project-title">
              <div><h3><span class="cn">{p["title_cn"]}</span><span class="en">{p["title_en"]}</span></h3>
                <p><span class="cn">{p["summary_cn"]}</span><span class="en">{p["summary_en"]}</span></p></div>
              <span class="meta">{p["id"]}</span>
            </div>
          </a>'''


def render_works_block(all_projects: list[dict]) -> str:
    """First project large left; rest stacked right; if >3, extra grid below."""
    if not all_projects:
        return '<div class="works"></div>'
    first, rest = all_projects[0], all_projects[1:]
    # normalize cover key
    for p in all_projects:
        if "cover_web" not in p and "cover" in p:
            p["cover_web"] = p["cover"]

    stack = rest[:2]
    extra = rest[2:]
    stack_html = "\n".join(project_card(p) for p in stack)
    html = f'''      <div class="works">
{project_card(first)}
        <div class="project-stack">
{stack_html}
        </div>
      </div>'''
    if extra:
        html += f'''
      <div class="works-extra">
{chr(10).join(project_card(p) for p in extra)}
      </div>'''
    return html


def patch_works_in_file(path: Path, works_html: str) -> None:
    """Replace the works (+ optional works-extra) block inside its parent section.

    Match from <div class="works"> through any leftover markup until the next
    </section>, so a previously broken patch cannot leave orphan cards.
    """
    text = path.read_text(encoding="utf-8")
    pat = re.compile(
        r'^[ \t]*<div class="works">.*?(?=</section>)',
        re.S | re.M,
    )
    new_text, n = pat.subn(works_html.rstrip() + "\n    ", text, count=1)
    if n == 0:
        raise SystemExit(f"Could not find works block in {path.name}")
    path.write_text(new_text, encoding="utf-8")
    print(f"  patched {path.name}")


def write_data_js(content_projects: list[dict]) -> None:
    # Keep simple; append content projects to AXEL_DATA style
    lines = ["const AXEL_DATA = {", "  projects: ["]
    for L in LEGACY:
        lines.append(
            f'''    {{
      id: "{L["id"]}",
      title: {{ cn: "{L["title_cn"]}", en: "{L["title_en"]}" }},
      intro: {{ cn: "{L["summary_cn"]}", en: "{L["summary_en"]}" }},
      heroImage: "{L["cover"]}",
      url: "{L["url"]}"
    }},'''
        )
    for p in content_projects:
        lines.append(
            f'''    {{
      id: "{p["id"]}",
      title: {{ cn: "{p["title_cn"]}", en: "{p["title_en"]}" }},
      intro: {{ cn: "{p["summary_cn"]}", en: "{p["summary_en"]}" }},
      heroImage: "{p["cover_web"]}",
      url: "{p["url"]}"
    }},'''
        )
    lines.append("  ],")
    lines.append("  builtWorks: []")
    lines.append("};")
    (ROOT / "data.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  wrote data.js")



def assemble_public() -> None:
    """Copy only public site files into public/ for Cloudflare / wrangler.

    Excludes .git, content/ sources, build scripts, and docs so large pack files
    and source images are never uploaded as Workers assets.
    """
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    PUBLIC.mkdir(parents=True)

    for html in sorted(ROOT.glob("*.html")):
        shutil.copy2(html, PUBLIC / html.name)

    for name in ("styles.css", "main.js", "data.js"):
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, PUBLIC / name)

    assets = ROOT / "assets"
    if assets.exists():
        shutil.copytree(assets, PUBLIC / "assets", dirs_exist_ok=True)

    # Belt-and-suspenders if someone later nests unexpected files under dist/
    (PUBLIC / ".assetsignore").write_text(
        "\n".join(
            [
                "# Never upload VCS or tooling if they appear under public/",
                ".git",
                "**/.git/**",
                "node_modules",
                "**/.DS_Store",
                "",
            ]
        ),
        encoding="utf-8",
    )
    # Quick size sanity: flag any file >= 25 MiB (Workers asset limit)
    limit = 25 * 1024 * 1024
    oversized = [p for p in PUBLIC.rglob("*") if p.is_file() and p.stat().st_size >= limit]
    if oversized:
        for p in oversized:
            print(f"  WARN oversized (>=25MiB): {p.relative_to(PUBLIC)} ({p.stat().st_size} bytes)")
    # Decap CMS admin UI (source lives at repo admin/, served at /admin/)
    admin_src = ROOT / "admin"
    if admin_src.exists():
        shutil.copytree(admin_src, PUBLIC / "admin", dirs_exist_ok=True)
        print("  copied admin/ → public/admin/")

    # AXEL 报价软件版本清单（几 KB，供客户端检查更新）
    axel_src = ROOT / "axel"
    if axel_src.exists():
        shutil.copytree(axel_src, PUBLIC / "axel", dirs_exist_ok=True)
        print("  copied axel/ → public/axel/")

    n_files = sum(1 for p in PUBLIC.rglob("*") if p.is_file())
    print(f"  assembled public/ ({n_files} files)")


def main() -> None:
    print("Building AXEL LAB site from content/ …")
    if not CONTENT.exists():
        raise SystemExit("content/ missing")

    content_projects = []
    for folder in sorted(CONTENT.iterdir()):
        if not folder.is_dir():
            continue
        if folder.name.startswith("_") or folder.name.startswith("."):
            continue
        text = (folder / "文案.md").read_text(encoding="utf-8") if (folder / "文案.md").exists() else ""
        p = parse_project(folder)
        if not p:
            continue
        fm, _ = split_frontmatter(text)
        if fm is None:
            refine_title_en(p, text)
        content_projects.append(p)
        print(f"  found {p['id']} / {p['slug']} — {p['title_cn']}")

    content_projects.sort(key=lambda x: x["order"])

    by_slug = {p["slug"]: p for p in content_projects}
    for L in LEGACY:
        by_slug.setdefault(L["slug"], L)

    for p in content_projects:
        copy_assets(p)
        html = render_detail(p, by_slug)
        out = ROOT / f"{p['slug']}.html"
        out.write_text(html, encoding="utf-8")
        print(f"  wrote {out.name}")

    # Merge for listing: legacy + content, by order
    listing = []
    for L in LEGACY:
        L = dict(L)
        L["cover_web"] = L["cover"]
        listing.append(L)
    listing.extend(content_projects)
    listing.sort(key=lambda x: x["order"])

    works = render_works_block(listing)
    patch_works_in_file(ROOT / "projects.html", works)
    patch_works_in_file(ROOT / "index.html", works)
    write_data_js(content_projects)
    assemble_public()
    print("Done.")


if __name__ == "__main__":
    main()

// AXEL LAB Main Scripts
(function(){
  // 1. Language Toggle
  const KEY = 'axellab-lang';
  function setLang(l) {
    document.body.classList.remove('lang-en', 'lang-cn');
    document.body.classList.add('lang-' + l);
    try { localStorage.setItem(KEY, l); } catch(e) {}
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.textContent = l === 'cn' ? 'EN' : '中文';
    });
    document.documentElement.lang = l === 'cn' ? 'zh' : 'en';
  }

  let saved = 'cn';
  try { saved = localStorage.getItem(KEY) || 'cn'; } catch(e) {}

  document.addEventListener('DOMContentLoaded', () => {
    setLang(saved);
    document.querySelectorAll('.lang-btn').forEach(b => {
      b.addEventListener('click', () => {
        setLang(document.body.classList.contains('lang-cn') ? 'en' : 'cn');
      });
    });

    // 2. Lightbox / Image Zoom (Simple implementation)
    const images = document.querySelectorAll('.bw-primary img, .bw-thumbs img, .detail-fig img, .gallery2 img');
    images.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        
        const fullImg = document.createElement('img');
        fullImg.src = img.src;
        fullImg.style.cssText = 'max-width:95%;max-height:95%;object-fit:contain;border:2px solid #fff;';
        
        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);
        
        overlay.onclick = () => document.body.removeChild(overlay);
      });
    });

    // 3. Mobile Menu Toggle
    const menuBtn = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    if (menuBtn && navLinks) {
      menuBtn.addEventListener('click', () => {
        navLinks.classList.toggle('open');
      });
    }
  });
})();

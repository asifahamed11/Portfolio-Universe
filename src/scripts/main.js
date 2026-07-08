import Lenis from 'lenis';
import { auth } from '../lib/firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { fetchGlobalLikes, fetchUserBookmarks, urlToKey, toggleLikeInFirestore, incrementPortfolioView } from '../lib/dbUtils.js';

// --- PREMIUM GLASS TOAST ---
window.showToast = (message, icon = 'check') => {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/20 text-white shadow-[0_8px_30px_rgba(0,0,0,0.4)] transform translate-y-10 opacity-0 transition-all duration-500 ease-out pointer-events-auto';
  
  const icons = {
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    heart: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#f43f5e" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`
  };

  toast.innerHTML = `
    <div class="shrink-0 bg-white/5 p-1.5 rounded-full border border-white/10 shadow-inner">
      ${icons[icon] || icons.check}
    </div>
    <p class="text-sm font-semibold tracking-wide drop-shadow-md pr-2"></p>
  `;
  toast.querySelector('p').textContent = message;
  
  container.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });
  
  // Animate out and remove
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
    setTimeout(() => toast.remove(), 500);
  }, 3000);
};

document.addEventListener('DOMContentLoaded', async () => {
  // Dynamically load the massive JSON in the background to avoid blocking main thread
  const portfoliosModule = await import('../data/portfolios.json');
  const portfoliosData = portfoliosModule.default || portfoliosModule;

  // Expose for inline scripts
  window.toggleLikeInFirestore = toggleLikeInFirestore;

  window.incrementPortfolioView = (url) => {
    const viewedKey = 'pu_viewed_' + url;
    if (sessionStorage.getItem(viewedKey)) return;
    sessionStorage.setItem(viewedKey, '1');
    incrementPortfolioView(url);
  };

  window.toggleBookmark = function(button, url) {
    const userJSON = localStorage.getItem('pu_user');
    if (!userJSON) {
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    const user = JSON.parse(userJSON);
    const storageKey = `pu_bookmarks_${user.uid}`;
    const icon = button.querySelector('.heart-icon');
    const countEl = button.querySelector('.like-count');
    let currentLikes = parseInt(countEl.textContent) || 0;
    let bookmarks = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const index = bookmarks.indexOf(url);
    const isLiking = index === -1;

    if (isLiking) {
      bookmarks.push(url);
      icon.setAttribute('fill', 'currentColor');
      icon.classList.add('text-red-500');
      button.classList.add('border-red-500/30', 'bg-red-500/10', 'text-red-400');
      
      // Trigger smart animation
      icon.classList.remove('heart-animated', 'heart-unlike-animated');
      void icon.offsetWidth; // Trigger reflow
      icon.classList.add('heart-animated');
      
      // Trigger spark particles
      if (window.triggerSpark) window.triggerSpark(button);
      
      // Play sound and show toast
      if (window.playPopSound) window.playPopSound(1.0);
      if (window.showToast) window.showToast('Added to your likes!', 'heart');
      
      // Haptic feedback for mobile devices
      if (navigator.vibrate) navigator.vibrate(50);
      
      countEl.textContent = currentLikes + 1;
    } else {
      bookmarks.splice(index, 1);
      icon.setAttribute('fill', 'none');
      icon.classList.remove('text-red-500', 'heart-animated');
      
      // Trigger reverse animation
      icon.classList.remove('heart-unlike-animated');
      void icon.offsetWidth; // Trigger reflow
      icon.classList.add('heart-unlike-animated');
      
      button.classList.remove('border-red-500/30', 'bg-red-500/10', 'text-red-400');
      countEl.textContent = Math.max(0, currentLikes - 1);
      
      // Play sound and show toast
      if (window.playPopSound) window.playPopSound(1.0);
      if (window.showToast) window.showToast('Removed from your likes.', 'check');
    }
    localStorage.setItem(storageKey, JSON.stringify(bookmarks));
    if (window.toggleLikeInFirestore) window.toggleLikeInFirestore(user.uid, url, isLiking, bookmarks);
  };

  const initBookmarks = (elements = null) => {
    const userJSON = localStorage.getItem('pu_user');
    const user = userJSON ? JSON.parse(userJSON) : null;
    const storageKey = user ? `pu_bookmarks_${user.uid}` : 'pu_bookmarks_guest';
    const bookmarks = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    const btns = elements ? elements.flatMap(el => Array.from(el.querySelectorAll('.bookmark-btn'))) : document.querySelectorAll('.bookmark-btn');
    
    btns.forEach(btn => {
      const url = btn.dataset.url;
      const icon = btn.querySelector('.heart-icon');
      if (bookmarks.includes(url)) {
        icon.setAttribute('fill', 'currentColor');
        icon.classList.add('text-red-500');
        btn.classList.add('border-red-500/30', 'bg-red-500/10', 'text-red-400');
      } else {
        icon.setAttribute('fill', 'none');
        icon.classList.remove('text-red-500');
        btn.classList.remove('border-red-500/30', 'bg-red-500/10', 'text-red-400');
      }
    });
  };
  initBookmarks();

  window.addEventListener('auth-changed', () => {
    initBookmarks();
    if (currentFilter === 'likes') {
      applyFilters();
    }
  });

  // ---- SMOOTH SCROLL (LENIS) ----
  const lenis = new Lenis({
    autoRaf: true,
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  });

  // ---- NAVBAR HIDE ON SCROLL ----
  const topNavBar = document.getElementById('topNavBar');
  if (lenis) {
    lenis.on('scroll', (e) => {
      if (!topNavBar) return;
      if (e.direction === 1 && e.scroll > 50) {
        topNavBar.style.top = '-100px';
      } else if (e.direction === -1 || e.scroll <= 50) {
        topNavBar.style.top = '16px'; 
      }
    });
  } else {
    let lastScrollTop = 0;
    window.addEventListener('scroll', () => {
      if (!topNavBar) return;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      if (scrollTop > lastScrollTop && scrollTop > 50) {
        topNavBar.style.top = '-100px';
      } else {
        topNavBar.style.top = '16px';
      }
      lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
    }, { passive: true });
  }

  // ---- AUTH LOGIC (FIREBASE) ----
  const loginBtn = document.getElementById('loginBtn');
  const userProfile = document.getElementById('userProfile');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const logoutBtn = document.getElementById('logoutBtn');

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      loginBtn.classList.add('hidden');
      userProfile.classList.remove('hidden');
      userProfile.classList.add('flex');
      userAvatar.src = user.photoURL || `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="%239CA3AF" viewBox="0 0 24 24"><path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm9 11v-1a7 7 0 0 0-7-7h-4a7 7 0 0 0-7 7v1h2v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1z"/></svg>`;
      userName.textContent = user.displayName || "User";
      
      const safeUser = {
        name: user.displayName,
        avatar: user.photoURL,
        uid: user.uid,
      };
      localStorage.setItem('pu_user', JSON.stringify(safeUser));

      const serverBookmarks = await fetchUserBookmarks(user.uid);
      localStorage.setItem(`pu_bookmarks_${user.uid}`, JSON.stringify(serverBookmarks));

      window.dispatchEvent(new Event('auth-changed'));
    } else {
      loginBtn.classList.remove('hidden');
      userProfile.classList.add('hidden');
      userProfile.classList.remove('flex');
      localStorage.removeItem('pu_user');
      window.dispatchEvent(new Event('auth-changed'));
    }
  });

  logoutBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error", error);
    }
  });

  // ---- FETCH GLOBAL LIKES ----
  let cachedGlobalLikes = {};
  const applyGlobalLikesToVisible = (elements = null) => {
    const btns = elements ? elements.flatMap(el => Array.from(el.querySelectorAll('.bookmark-btn'))) : document.querySelectorAll('.bookmark-btn');
    btns.forEach(btn => {
      const url = btn.dataset.url;
      const key = urlToKey(url);
      const serverLikes = cachedGlobalLikes[key];
      
      if (serverLikes !== undefined) {
        const countEl = btn.querySelector('.like-count');
        if (countEl) {
          countEl.textContent = serverLikes;
        }
      }
    });
  };

  fetchGlobalLikes().then(globalLikes => {
    cachedGlobalLikes = globalLikes;
    applyGlobalLikesToVisible();
    
    // Dynamically sort by likes
    allPortfolios.forEach(p => {
      p.baseLikes = cachedGlobalLikes[urlToKey(p.url)] || 0;
    });
    allPortfolios.sort((a, b) => b.baseLikes - a.baseLikes);
    
    debouncedApplyFilters();
  });

  // ---- FILTER, SEARCH & PAGINATION LOGIC ----
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const emptyState = document.getElementById('emptyState');
  const searchInputDesk = document.getElementById('searchInputDesk');
  const searchInputMob = document.getElementById('searchInputMob');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  const gridContainer = document.getElementById('portfolioGrid');
  const activeIndicator = document.getElementById('activeIndicator');
  let indicatorTimeout;

  const moveIndicator = (btn) => {
    if (!activeIndicator || !btn) return;
    clearTimeout(indicatorTimeout);
    
    const targetX = btn.offsetLeft;
    const targetY = btn.offsetTop;
    const targetWidth = btn.offsetWidth;
    
    const currentX = activeIndicator.dataset.x ? parseFloat(activeIndicator.dataset.x) : targetX;
    const currentWidth = activeIndicator.dataset.w ? parseFloat(activeIndicator.dataset.w) : targetWidth;
    
    activeIndicator.style.height = `${btn.offsetHeight}px`;
    activeIndicator.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.1)';
    activeIndicator.style.width = `${targetWidth}px`;
    activeIndicator.style.transform = `translate(${targetX}px, ${targetY}px)`;
    activeIndicator.dataset.x = targetX;
    activeIndicator.dataset.w = targetWidth;
  };

  window.addEventListener('resize', () => {
    const activeBtn = document.querySelector('.filter-btn.active');
    if (activeBtn) moveIndicator(activeBtn);
  });

  setTimeout(() => {
    const activeBtn = document.querySelector('.filter-btn.active');
    if (activeBtn) moveIndicator(activeBtn);
  }, 100);

  const allPortfolios = portfoliosData.map((p, i) => ({ ...p, baseLikes: 0, index: i }));
  let filteredItems = [...allPortfolios];

  let currentFilter = 'all';
  let searchQuery = '';
  let visibleCount = 40;
  const ITEMS_PER_PAGE = 20;

  // Set up an IntersectionObserver for all card wrappers to virtualize them when they scroll out of view
  const virtualizationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const w = entry.target;
      const child = w.firstElementChild;
      if (!child) return;
      if (entry.isIntersecting) {
        if (w.hasAttribute('data-virtualized')) {
          w.removeAttribute('data-virtualized');
          w.style.minHeight = '';
          child.style.display = '';
        }
      } else {
        // Measure height if possible to prevent layout shifts
        const rect = w.getBoundingClientRect();
        if (rect.height > 100) {
          w.style.minHeight = `${rect.height}px`;
        } else if (!w.style.minHeight) {
          w.style.minHeight = '350px';
        }
        w.setAttribute('data-virtualized', 'true');
        child.style.display = 'none';
      }
    });
  }, {
    rootMargin: '600px 0px 600px 0px',
  });

  const itemElements = new Map();
  document.querySelectorAll('.portfolio-wrapper').forEach(w => {
    itemElements.set(w.dataset.url, w);
    virtualizationObserver.observe(w);
  });

  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => 
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  };

  const BORDER_GLOW_STYLE = '--card-bg:#120F17; --edge-sensitivity:30; --border-radius:28px; --glow-padding:40px; --cone-spread:25; --fill-opacity:0.5; --glow-color:hsl(40deg 80% 80% / 100%); --glow-color-60:hsl(40deg 80% 80% / 60%); --glow-color-50:hsl(40deg 80% 80% / 50%); --glow-color-40:hsl(40deg 80% 80% / 40%); --glow-color-30:hsl(40deg 80% 80% / 30%); --glow-color-20:hsl(40deg 80% 80% / 20%); --glow-color-10:hsl(40deg 80% 80% / 10%); --gradient-one:radial-gradient(at 80% 55%, #c084fc 0px, transparent 50%); --gradient-two:radial-gradient(at 69% 34%, #f472b6 0px, transparent 50%); --gradient-three:radial-gradient(at 8% 6%, #38bdf8 0px, transparent 50%); --gradient-four:radial-gradient(at 41% 38%, #c084fc 0px, transparent 50%); --gradient-five:radial-gradient(at 86% 85%, #f472b6 0px, transparent 50%); --gradient-six:radial-gradient(at 82% 18%, #38bdf8 0px, transparent 50%); --gradient-seven:radial-gradient(at 51% 4%, #f472b6 0px, transparent 50%); --gradient-base:linear-gradient(#c084fc 0 100%);';

  const updateDynamicGlow = (card, clientX, clientY) => {
    const rect = card.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    const dx = (clientX - rect.left) - halfW;
    const dy = (clientY - rect.top) - halfH;
    let kx = Infinity;
    let ky = Infinity;
    if (dx !== 0) kx = halfW / Math.abs(dx);
    if (dy !== 0) ky = halfH / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let angle = 0;
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
    }
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', angle.toFixed(3) + 'deg');
  };
  
  if (gridContainer) {
    gridContainer.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('.border-glow-card[data-glow="dynamic"]');
      if (card) updateDynamicGlow(card, e.clientX, e.clientY);
    }, { passive: true });
  }

  const createCardHTML = (portfolio, index) => {
    const name = escapeHtml(portfolio.name);
    const url = escapeHtml(portfolio.url);
    const rawUrl = portfolio.url; 
    const screenshot = escapeHtml(portfolio.screenshot || `https://api.microlink.io/?url=${encodeURIComponent(rawUrl)}&screenshot=true&meta=false&embed=screenshot.url`);
    const summary = escapeHtml(portfolio.summary || '');
    const role = escapeHtml(portfolio.role || '');
    const tech_stack = Array.isArray(portfolio.tech_stack) ? portfolio.tech_stack : [];
    const available_for_hire = portfolio.available_for_hire || false;
    const base_likes = portfolio.baseLikes || 0;
    const views = portfolio.views || 0;

    let hireHTML = '';
    if (available_for_hire) {
      hireHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 backdrop-blur-xl border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest shadow-xl">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"></span>
          Hire Me
        </span>
      `;
    }

    let techHTML = '';
    if (tech_stack.length > 0) {
      const mainTech = tech_stack.slice(0, 3).map(tech => `
        <span class="px-3 py-1.5 rounded-full bg-blue-500/[0.03] text-blue-200/50 text-[10px] font-bold tracking-widest uppercase border border-blue-500/10 shadow-sm transition-colors duration-300 group-hover:border-blue-500/20 group-hover:bg-blue-500/[0.08] group-hover:text-blue-200/80">
          ${escapeHtml(tech)}
        </span>
      `).join('');
      
      let extraTech = '';
      if (tech_stack.length > 3) {
        extraTech = `
          <span class="px-3 py-1.5 rounded-full bg-white/[0.02] text-white/30 text-[10px] font-bold tracking-widest uppercase border border-white/[0.04] shadow-sm">
            +${tech_stack.length - 3}
          </span>
        `;
      }
      
      techHTML = `
        <div class="flex flex-wrap gap-2 mt-6">
          ${mainTech}
          ${extraTech}
        </div>
      `;
    }

    let roleHTML = '';
    if (role) {
      roleHTML = `
        <div class="inline-flex items-center gap-2 px-2.5 py-1 mt-1 rounded-md bg-white/[0.03] border border-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm w-fit group-hover:bg-white/[0.06] group-hover:border-white/[0.1] transition-all duration-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span class="text-[12px] font-medium text-gray-300 group-hover:text-white transition-colors duration-300">
            ${role}
          </span>
        </div>
      `;
    }

    let tooltipHTML = '';
    if (summary) {
      tooltipHTML = `
        <div class="absolute bottom-[calc(100%+16px)] -right-4 w-[280px] sm:w-[320px] z-[100] pointer-events-none flex flex-col items-end">
          <div class="relative w-full p-0 rounded-2xl bg-white/[0.06] opacity-0 group-hover:opacity-100 -translate-y-4 group-hover:translate-y-0 transition-all duration-500 ease-out overflow-hidden" style="box-shadow: 0 15px 35px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 1px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05); -webkit-backdrop-filter: blur(16px) saturate(180%) brightness(1.1); backdrop-filter: blur(16px) saturate(180%) brightness(1.1);">
            <div class="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-[150%] skew-x-[-45deg] group-hover:translate-x-[50%] transition-transform duration-[1500ms] ease-out pointer-events-none"></div>
            <div class="relative text-white/95 text-[13px] leading-relaxed p-4 rounded-2xl font-medium shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
              <div class="flex items-start gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white/60 shrink-0 mt-0.5"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                <span class="drop-shadow-md">${summary}</span>
              </div>
            </div>
          </div>
          <div class="absolute -bottom-[5.5px] right-10 w-3 h-3 bg-white/[0.06] opacity-0 group-hover:opacity-100 -translate-y-4 group-hover:translate-y-0 transition-all duration-500 ease-out transform rotate-45 z-[-1] pointer-events-none" style="box-shadow: inset -1px -1px 1px rgba(0,0,0,0.4), 1px 1px 0 rgba(255,255,255,0.05); -webkit-backdrop-filter: blur(16px) saturate(180%) brightness(1.1); backdrop-filter: blur(16px) saturate(180%) brightness(1.1);"></div>
        </div>
      `;
    }

    return `
      <div class="portfolio-wrapper hidden" data-index="${index}" data-name="${name.toLowerCase()}" data-url="${rawUrl}" data-role="${(portfolio.role || '').toLowerCase()}" data-tech="${tech_stack.join(',').toLowerCase()}" data-hire="${available_for_hire ? 'true' : 'false'}">
        <div class="group relative flex flex-col h-full transform-gpu z-10 transition-transform duration-500 ease-out hover:-translate-y-1.5 active:scale-[0.98] active:translate-y-0 [backface-visibility:hidden]">
          <div class="border-glow-card h-full w-full" data-glow="dynamic" style="${BORDER_GLOW_STYLE}">
            <span class="edge-light"></span>
            <div class="border-glow-inner">
          <a href="${rawUrl}" target="_blank" rel="noopener noreferrer" class="relative flex flex-col rounded-[28px] h-full outline-none" onclick="if(window.incrementPortfolioView) window.incrementPortfolioView('${rawUrl}')">
            <div class="relative aspect-[16/10] w-full overflow-hidden rounded-t-[28px] bg-black [transform:translateZ(0)]">
              <img src="${screenshot}" alt="Screenshot of ${name}'s portfolio" loading="lazy" class="w-full h-full object-cover object-top opacity-75 grayscale-[30%] group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-[1.04] transition-all duration-700 ease-out transform-gpu [backface-visibility:hidden]" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1517694712202-14dd9538aa97?q=80&w=600&auto=format&fit=crop';" />
              <div class="absolute inset-0 z-20 w-[150%] -translate-x-[150%] skew-x-[-25deg] bg-gradient-to-r from-transparent via-white/[0.12] to-transparent group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out pointer-events-none"></div>
              <div class="absolute inset-0 z-10 pointer-events-none ring-1 ring-inset ring-white/[0.08] rounded-t-[28px]"></div>
              <div class="absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-transparent to-black/70 opacity-90 pointer-events-none transition-opacity duration-500 group-hover:opacity-60"></div>
              <div class="absolute inset-0 z-10 bg-gradient-to-t from-[#0B0F19] via-[#0B0F19]/40 to-transparent opacity-95 pointer-events-none"></div>
              <div class="absolute top-4 left-4 z-20 flex flex-wrap gap-2 pointer-events-none">
                ${hireHTML}
              </div>
              <button class="bookmark-btn absolute top-4 right-4 z-30 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/50 backdrop-blur-xl border border-white/[0.1] text-white/70 hover:text-rose-400 hover:bg-rose-500/15 hover:border-rose-500/40 hover:shadow-[0_0_20px_rgba(244,63,94,0.3)] transition-all duration-300 group/btn" data-url="${rawUrl}" aria-label="Bookmark and Like" onclick="event.preventDefault(); window.toggleBookmark(this, this.dataset.url)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="heart-icon transition-transform duration-300 group-hover/btn:scale-110 active:scale-90"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                <span class="text-xs font-bold tracking-wide like-count">${base_likes}</span>
              </button>
            </div>
            <div class="relative z-10 p-6 flex flex-col flex-grow rounded-b-[28px] bg-gradient-to-b from-[#0B0F19] to-[#06080D]">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2 overflow-hidden pr-2">
                  <h3 class="text-[1.1rem] font-extrabold text-white/95 tracking-tight line-clamp-1 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-blue-400 group-hover:to-cyan-300 transition-all duration-300">${name}</h3>
                  <div class="flex items-center gap-1.5 text-gray-500 group-hover:text-gray-400 transition-colors shrink-0" title="${views} views">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span class="text-xs font-semibold tracking-wide">${views}</span>
                  </div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white/0 group-hover:text-cyan-400 transition-all transform -translate-x-2 translate-y-2 group-hover:translate-x-0 group-hover:translate-y-0 duration-300 shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </div>
              ${roleHTML}
              <div class="flex-grow"></div>
              ${techHTML}
            </div>
          </a>
            </div>
          </div>
          ${tooltipHTML}
        </div>
      </div>
    `;
  };

  let currentlyVisible = new Set(itemElements.keys());
  
  // Virtualization distance
  const VIRTUAL_RENDER_BUFFER = 40; // Only keep DOM nodes for items within this buffer from view

  const renderGrid = () => {
    // Determine the visible range
    const itemsToShow = filteredItems.slice(0, visibleCount);
    
    // For DOM virtualization, we only want to render the last N items and the visible items
    // Since this is a simple "load more" approach, the user sees 0 to visibleCount
    // A true virtualizer would determine scroll position. But since we use DOM addition,
    // we can optimize by setting non-visible wrappers to contain-intrinsic-size or hiding them 
    // if they are far above. For simplicity and robustness, we will hide elements that are 
    // more than VIRTUAL_RENDER_BUFFER items away from the bottom of the visible list if they are scrolling down.
    // However, to keep it simple and safe for Astro, we will keep them in DOM but use CSS content-visibility:
    
    const itemsToShowSet = new Set(itemsToShow.map(p => p.url));
    
    for (const url of currentlyVisible) {
      if (!itemsToShowSet.has(url)) {
        const w = itemElements.get(url);
        if (w) w.classList.add('hidden');
      }
    }
    
    const newElements = [];
    for (let i = 0; i < itemsToShow.length; i++) {
      const p = itemsToShow[i];
      let w = itemElements.get(p.url);
      
      if (!w) {
        const template = document.createElement('template');
        template.innerHTML = createCardHTML(p, p.index).trim();
        w = template.content.firstChild;
        itemElements.set(p.url, w);
        newElements.push(w);
        virtualizationObserver.observe(w);
      }
      
      if (w.style.order !== String(i)) {
        w.style.order = i;
      }
      if (!w.parentElement) {
        gridContainer.appendChild(w);
      }
      
      w.classList.remove('hidden');
      

    }
    
    currentlyVisible = itemsToShowSet;
    
    if (newElements.length > 0) {
      initBookmarks(newElements);
      if (typeof applyGlobalLikesToVisible !== 'undefined') {
        applyGlobalLikesToVisible(newElements);
      }
    }

    if (filteredItems.length === 0) {
      emptyState.classList.remove('hidden');
      loadMoreContainer.style.display = 'none';
    } else {
      emptyState.classList.add('hidden');
      if (filteredItems.length > visibleCount) {
        loadMoreContainer.style.display = 'flex';
      } else {
        loadMoreContainer.style.display = 'none';
      }
    }
  };

  const applyFilters = (_showSkeletons = true) => {
    const userJSON = localStorage.getItem('pu_user');
    const user = userJSON ? JSON.parse(userJSON) : null;
    const bookmarks = user ? JSON.parse(localStorage.getItem(`pu_bookmarks_${user.uid}`) || '[]') : [];

    filteredItems = allPortfolios.filter(portfolio => {
      const name = portfolio.name.toLowerCase();
      const role = (portfolio.role || '').toLowerCase();
      const tech = (portfolio.tech_stack || []).join(',').toLowerCase();
      const hire = portfolio.available_for_hire === true;
      
      const matchesSearch = searchQuery === '' || 
                            name.includes(searchQuery) || 
                            role.includes(searchQuery) || 
                            tech.includes(searchQuery);

      let matchesFilter = true;
      if (currentFilter !== 'all' && currentFilter !== 'most_viewed') {
        if (currentFilter === 'hire') {
          matchesFilter = hire;
        } else if (currentFilter === 'likes') {
          matchesFilter = bookmarks.includes(portfolio.url);
        } else {
          const normalizedRole = role.replace(/[\s-]/g, '');
          if (currentFilter === 'designer') {
            matchesFilter = role.includes('design') || role.includes('ui') || role.includes('creative');
          } else if (currentFilter === 'fullstack') {
            matchesFilter = normalizedRole.includes('fullstack');
          } else if (currentFilter === 'frontend') {
            matchesFilter = normalizedRole.includes('frontend');
          } else if (currentFilter === 'backend') {
            matchesFilter = normalizedRole.includes('backend');
          } else {
            matchesFilter = role.includes(currentFilter);
          }
        }
      }

      return matchesSearch && matchesFilter;
    });

    if (currentFilter === 'most_viewed') {
      filteredItems.sort((a, b) => (b.views || 0) - (a.views || 0));
    } else {
      filteredItems.sort((a, b) => b.baseLikes - a.baseLikes);
    }

    if (_showSkeletons) {
      renderSkeletonsThenGrid();
    } else {
      renderGrid();
    }
  };

  const createSkeletonHTML = (index) => {
    return `
      <div class="portfolio-wrapper skeleton-card" style="order: ${index}">
        <div class="relative flex flex-col bg-[#0B0F19] border border-white/[0.06] rounded-2xl h-full z-10 overflow-hidden">
          <div class="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent z-20"></div>
          <div class="relative aspect-[16/10] w-full bg-white/[0.03]"></div>
          <div class="p-6 flex flex-col flex-grow rounded-b-2xl bg-gradient-to-b from-[#0B0F19] to-[#06080D]">
            <div class="h-6 bg-white/[0.05] rounded-md w-3/4 mb-3"></div>
            <div class="h-5 bg-white/[0.03] rounded-md w-1/3 mb-6"></div>
            <div class="flex-grow"></div>
            <div class="flex gap-2">
              <div class="h-6 bg-white/[0.04] rounded-full w-16"></div>
              <div class="h-6 bg-white/[0.04] rounded-full w-20"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  let skeletonTimeout;
  const renderSkeletonsThenGrid = () => {
    clearTimeout(skeletonTimeout);
    
    // Hide all current items
    for (const url of currentlyVisible) {
      const w = itemElements.get(url);
      if (w) w.classList.add('hidden');
    }
    currentlyVisible.clear();
    
    // Remove old skeletons if any
    document.querySelectorAll('.skeleton-card').forEach(el => el.remove());
    
    // If no items, skip skeletons and just renderGrid (which shows empty state)
    if (filteredItems.length === 0) {
      renderGrid();
      return;
    }

    // Add new skeletons
    const skeletonCount = Math.min(filteredItems.length, visibleCount) || 6;
    let skeletonHTML = '';
    for(let i=0; i<skeletonCount; i++){
       skeletonHTML += createSkeletonHTML(i);
    }
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = skeletonHTML;
    const skeletons = Array.from(tempDiv.children);
    skeletons.forEach(s => gridContainer.appendChild(s));
    
    emptyState.classList.add('hidden');
    loadMoreContainer.style.display = 'none';

    skeletonTimeout = setTimeout(() => {
      skeletons.forEach(s => s.remove());
      renderGrid();
    }, 400);
  };

  let filterTimeout;
  const debouncedApplyFilters = () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      applyFilters(false);
    }, 250);
  };

  const handleSearch = (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    if (e.target === searchInputDesk && searchInputMob) searchInputMob.value = e.target.value;
    if (e.target === searchInputMob && searchInputDesk) searchInputDesk.value = e.target.value;
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      visibleCount = ITEMS_PER_PAGE;
      applyFilters(false);
    }, 250);
  };

  searchInputDesk?.addEventListener('input', handleSearch);
  searchInputMob?.addEventListener('input', handleSearch);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.filter === 'likes' && !localStorage.getItem('pu_user')) {
        if (window.openLoginModal) window.openLoginModal();
        return;
      }

      filterBtns.forEach(b => {
        b.classList.remove('active');
        const f = b.dataset.filter;
        if (f !== 'hire' && f !== 'likes') {
          b.classList.add('text-gray-400');
        }
      });

      if (btn.dataset.filter !== 'hire' && btn.dataset.filter !== 'likes') {
        btn.classList.remove('text-gray-400');
      }
      btn.classList.add('active');
      
      moveIndicator(btn);

      currentFilter = btn.dataset.filter;
      visibleCount = ITEMS_PER_PAGE;
      applyFilters();
    });
  });

  clearFiltersBtn?.addEventListener('click', () => {
    searchQuery = '';
    if (searchInputDesk) searchInputDesk.value = '';
    if (searchInputMob) searchInputMob.value = '';
    
    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
    if (allBtn) allBtn.click();
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && filteredItems.length > visibleCount) {
        setTimeout(() => {
          visibleCount += ITEMS_PER_PAGE;
          renderGrid();
        }, 300);
      }
    }, {
      rootMargin: '150px',
    });

    if (loadMoreContainer) {
      observer.observe(loadMoreContainer);
    }
  } else {
    visibleCount = allPortfolios.length;
    renderGrid();
  }

  applyFilters();
});

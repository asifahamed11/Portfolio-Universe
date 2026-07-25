import Lenis from 'lenis';
import { auth } from '../lib/firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  fetchUserBookmarks,
  toggleBookmarkInFirestore,
} from '../lib/dbUtils.js';
import {
  normalizePortfolioCollection,
  toSafeHttpsUrl,
} from '../lib/portfolio.js';
import portfolioDataUrl from '../data/portfolios.json?url';

// --- PREMIUM GLASS TOAST ---
window.showToast = (message, icon = 'check') => {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/20 text-white shadow-[0_8px_30px_rgba(0,0,0,0.4)] transform translate-y-10 opacity-0 transition-all duration-500 ease-out pointer-events-auto';
  
  const iconElement = document.createElement('span');
  iconElement.className = 'shrink-0 bg-white/5 px-2 py-1 rounded-full border border-white/10 shadow-inner font-bold';
  iconElement.textContent = icon === 'heart' ? '♥' : icon === 'error' ? '!' : '✓';
  iconElement.style.color = icon === 'heart' ? '#f43f5e' : icon === 'error' ? '#fb7185' : '#34d399';

  const messageElement = document.createElement('p');
  messageElement.className = 'text-sm font-semibold tracking-wide drop-shadow-md pr-2';
  messageElement.textContent = String(message);

  toast.append(iconElement, messageElement);
  
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
  // Keep the large dataset out of the JavaScript bundle and fail gracefully.
  let portfoliosData = [];
  try {
    const response = await fetch(portfolioDataUrl, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`Portfolio data request failed (${response.status}).`);
    }
    portfoliosData = normalizePortfolioCollection(await response.json());
  } catch (error) {
    console.error('Failed to load portfolio data:', error);
    window.showToast?.('Some portfolio filters are temporarily unavailable.', 'error');
  }

  const setBookmarkButtonState = (button, isSaved) => {
    const icon = button.querySelector('.heart-icon');
    icon?.setAttribute('fill', isSaved ? 'currentColor' : 'none');
    icon?.classList.toggle('text-red-500', isSaved);
    button.classList.toggle('border-red-500/30', isSaved);
    button.classList.toggle('bg-red-500/10', isSaved);
    button.classList.toggle('text-red-400', isSaved);
    button.setAttribute('aria-pressed', String(isSaved));
  };

  window.toggleBookmark = async function(button, url) {
    const user = auth.currentUser;
    const safeUrl = toSafeHttpsUrl(url);
    if (!user) {
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    if (!safeUrl || button.disabled) return;

    const storageKey = `pu_bookmarks_${user.uid}`;
    const icon = button.querySelector('.heart-icon');
    let bookmarks = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const previousBookmarks = [...bookmarks];
    const index = bookmarks.indexOf(safeUrl);
    const isSaving = index === -1;

    if (isSaving) {
      bookmarks.push(safeUrl);
      icon.classList.remove('heart-animated', 'heart-unlike-animated');
      void icon.offsetWidth;
      icon.classList.add('heart-animated');
      if (window.triggerSpark) window.triggerSpark(button);
      if (navigator.vibrate) navigator.vibrate(50);
    } else {
      bookmarks.splice(index, 1);
      icon.classList.remove('text-red-500', 'heart-animated');
      icon.classList.remove('heart-unlike-animated');
      void icon.offsetWidth;
      icon.classList.add('heart-unlike-animated');
    }

    setBookmarkButtonState(button, isSaving);
    localStorage.setItem(storageKey, JSON.stringify(bookmarks));
    button.disabled = true;

    try {
      const confirmedBookmarks = await toggleBookmarkInFirestore(
        user.uid,
        safeUrl,
        isSaving,
      );
      localStorage.setItem(storageKey, JSON.stringify(confirmedBookmarks));
      setBookmarkButtonState(button, confirmedBookmarks.includes(safeUrl));
      if (window.playPopSound) window.playPopSound(1.0);
      if (window.showToast) {
        window.showToast(
          isSaving ? 'Saved to your bookmarks.' : 'Removed from your bookmarks.',
          isSaving ? 'heart' : 'check',
        );
      }
    } catch (error) {
      console.error('Failed to update bookmark:', error);
      localStorage.setItem(storageKey, JSON.stringify(previousBookmarks));
      setBookmarkButtonState(button, previousBookmarks.includes(safeUrl));
      if (window.showToast) {
        window.showToast('The bookmark could not be saved. Please try again.', 'error');
      }
    } finally {
      button.disabled = false;
    }
  };

  const initBookmarks = (elements = null) => {
    const userJSON = localStorage.getItem('pu_user');
    const user = userJSON ? JSON.parse(userJSON) : null;
    const storageKey = user ? `pu_bookmarks_${user.uid}` : 'pu_bookmarks_guest';
    const bookmarks = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    const btns = elements ? elements.flatMap(el => Array.from(el.querySelectorAll('.bookmark-btn'))) : document.querySelectorAll('.bookmark-btn');
    
    btns.forEach(btn => {
      const url = btn.dataset.url;
      setBookmarkButtonState(btn, bookmarks.includes(url));
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
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lenis = prefersReducedMotion
    ? null
    : new Lenis({
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

  document.getElementById('homeBtn')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  });
  document.querySelectorAll('[data-action="open-submit"]').forEach((button) => {
    button.addEventListener('click', () => window.openSubmitModal?.());
  });
  document.querySelectorAll('[data-action="open-login"]').forEach((button) => {
    button.addEventListener('click', () => window.openLoginModal?.());
  });

  gridContainer?.addEventListener('click', (event) => {
    const button = event.target.closest?.('.bookmark-btn');
    if (!button || !gridContainer.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    window.toggleBookmark(button, button.dataset.url);
  });

  gridContainer?.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!image.classList?.contains('portfolio-image') || image.dataset.fallbackApplied) {
        return;
      }
      image.dataset.fallbackApplied = 'true';
      image.src =
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?q=80&w=600&auto=format&fit=crop';
    },
    true,
  );

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

  const allPortfolios = portfoliosData.map((portfolio, index) => ({
    ...portfolio,
    index,
  }));
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

      const wrapper = e.target.closest?.('.portfolio-card-wrapper');
      const tooltip = wrapper?.querySelector('.card-tooltip');
      if (!wrapper || !tooltip || !tooltip.classList.contains('lg:flex')) return;

      const rect = wrapper.getBoundingClientRect();
      const tooltipWidth = tooltip.offsetWidth || 320;
      const tooltipHeight = tooltip.offsetHeight || 100;
      const offsetX =
        e.clientX + 20 + tooltipWidth > window.innerWidth
          ? -tooltipWidth - 20
          : 20;
      const offsetY =
        e.clientY + 20 + tooltipHeight > window.innerHeight
          ? -tooltipHeight - 20
          : 20;
      tooltip.style.transform = `translate3d(${e.clientX - rect.left + offsetX}px, ${e.clientY - rect.top + offsetY}px, 0)`;
    }, { passive: true });
  }

  const cardTemplateSource = document.querySelector('.portfolio-wrapper');
  const mainTechClass =
    'portfolio-tech px-3 py-1.5 rounded-full bg-blue-500/[0.06] text-blue-200/80 text-[10px] font-bold tracking-widest uppercase border border-blue-500/20 shadow-sm transition-colors duration-300 group-hover:border-blue-500/40 group-hover:bg-blue-500/[0.12] group-hover:text-blue-100';
  const extraTechClass =
    'portfolio-tech-extra px-3 py-1.5 rounded-full bg-white/[0.04] text-white/60 text-[10px] font-bold tracking-widest uppercase border border-white/[0.08] shadow-sm';

  const createCardElement = (portfolio, index) => {
    if (!cardTemplateSource) return null;

    const wrapper = cardTemplateSource.cloneNode(true);
    wrapper.classList.add('hidden');
    wrapper.removeAttribute('style');
    wrapper.dataset.index = String(index);
    wrapper.dataset.name = portfolio.name.toLowerCase();
    wrapper.dataset.url = portfolio.url;
    wrapper.dataset.role = portfolio.role.toLowerCase();
    wrapper.dataset.tech = portfolio.tech_stack.join(',').toLowerCase();
    wrapper.dataset.hire = String(portfolio.available_for_hire);

    wrapper.querySelectorAll(
      '[data-cursor-bound-card], [data-cursor-bound-btn], [data-cursor-bound-like]',
    ).forEach((element) => {
      delete element.dataset.cursorBoundCard;
      delete element.dataset.cursorBoundBtn;
      delete element.dataset.cursorBoundLike;
    });

    const link = wrapper.querySelector('.portfolio-link');
    link.href = portfolio.url;

    const image = wrapper.querySelector('.portfolio-image');
    image.src =
      portfolio.screenshot ||
      `https://api.microlink.io/?url=${encodeURIComponent(portfolio.url)}&screenshot=true&meta=false&embed=screenshot.url`;
    image.alt = `Screenshot of ${portfolio.name}'s portfolio`;
    delete image.dataset.fallbackApplied;

    const bookmark = wrapper.querySelector('.bookmark-btn');
    bookmark.dataset.url = portfolio.url;
    bookmark.setAttribute(
      'aria-label',
      `Save ${portfolio.name} to bookmarks`,
    );
    bookmark.setAttribute('aria-pressed', 'false');
    bookmark.disabled = false;

    wrapper.querySelector('[data-field="name"]').textContent = portfolio.name;
    wrapper.querySelector('[data-field="views"]').textContent = String(
      portfolio.views,
    );
    wrapper.querySelector('[data-field="views-container"]').title =
      `${portfolio.views} views`;

    const hire = wrapper.querySelector('[data-field="hire"]');
    hire.hidden = !portfolio.available_for_hire;

    const roleContainer = wrapper.querySelector('[data-field="role-container"]');
    roleContainer.hidden = !portfolio.role;
    wrapper.querySelector('[data-field="role"]').textContent = portfolio.role;

    const mobileSummary = wrapper.querySelector('[data-field="mobile-summary"]');
    mobileSummary.hidden = !portfolio.summary;
    mobileSummary.textContent = portfolio.summary;

    const techStack = wrapper.querySelector('[data-field="tech-stack"]');
    techStack.replaceChildren();
    portfolio.tech_stack.slice(0, 3).forEach((technology) => {
      const badge = document.createElement('span');
      badge.className = mainTechClass;
      badge.textContent = technology;
      techStack.appendChild(badge);
    });
    if (portfolio.tech_stack.length > 3) {
      const extraBadge = document.createElement('span');
      extraBadge.className = extraTechClass;
      extraBadge.textContent = `+${portfolio.tech_stack.length - 3}`;
      techStack.appendChild(extraBadge);
    }
    techStack.hidden = portfolio.tech_stack.length === 0;

    const tooltip = wrapper.querySelector('[data-field="tooltip"]');
    tooltip.hidden = !portfolio.summary;
    tooltip.classList.toggle('lg:flex', Boolean(portfolio.summary));
    tooltip.style.transform = '';
    wrapper.querySelector('[data-field="tooltip-summary"]').textContent =
      portfolio.summary;

    return wrapper;
  };

  let currentlyVisible = new Set(itemElements.keys());

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
        w = createCardElement(p, p.index);
        if (!w) continue;
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
      filteredItems.sort((a, b) => a.index - b.index);
    }

    if (_showSkeletons) {
      renderSkeletonsThenGrid();
    } else {
      renderGrid();
    }
  };

  const createSkeleton = (index) => {
    const element = (tag, className) => {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    };

    const wrapper = element('div', 'portfolio-wrapper skeleton-card');
    wrapper.style.order = String(index);
    const card = element(
      'div',
      'relative flex flex-col bg-[#0B0F19] border border-white/[0.06] rounded-2xl h-full z-10 overflow-hidden',
    );
    const shimmer = element(
      'div',
      'absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent z-20',
    );
    const image = element(
      'div',
      'relative aspect-[16/10] w-full bg-white/[0.03]',
    );
    const content = element(
      'div',
      'p-6 flex flex-col flex-grow rounded-b-2xl bg-gradient-to-b from-[#0B0F19] to-[#06080D]',
    );
    content.append(
      element('div', 'h-6 bg-white/[0.05] rounded-md w-3/4 mb-3'),
      element('div', 'h-5 bg-white/[0.03] rounded-md w-1/3 mb-6'),
      element('div', 'flex-grow'),
    );
    const tags = element('div', 'flex gap-2');
    tags.append(
      element('div', 'h-6 bg-white/[0.04] rounded-full w-16'),
      element('div', 'h-6 bg-white/[0.04] rounded-full w-20'),
    );
    content.appendChild(tags);
    card.append(shimmer, image, content);
    wrapper.appendChild(card);
    return wrapper;
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
    const skeletons = Array.from(
      { length: skeletonCount },
      (_, index) => createSkeleton(index),
    );
    gridContainer.append(...skeletons);
    
    emptyState.classList.add('hidden');
    loadMoreContainer.style.display = 'none';

    skeletonTimeout = setTimeout(() => {
      skeletons.forEach(s => s.remove());
      renderGrid();
    }, 400);
  };

  let filterTimeout;
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

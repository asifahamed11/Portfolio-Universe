import re
import sys

with open("src/pages/index.astro", "r", encoding="utf-8") as f:
    content = f.read()

# The clean tail code to restore:
clean_tail = """    const createSkeletonHTML = (index) => {
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
      loadMoreContainer.classList.add('hidden');

      skeletonTimeout = setTimeout(() => {
        skeletons.forEach(s => s.remove());
        renderGrid();
      }, 400);
    };

    let filterTimeout;
    const debouncedApplyFilters = () => {
      clearTimeout(filterTimeout);
      filterTimeout = setTimeout(() => {
        visibleCount = ITEMS_PER_PAGE;
        applyFilters();
      }, 250);
    };

    const handleSearch = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      if (e.target === searchInputDesk && searchInputMob) searchInputMob.value = e.target.value;
      if (e.target === searchInputMob && searchInputDesk) searchInputDesk.value = e.target.value;
      debouncedApplyFilters();
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
</script>

<script>
  // UI Sound Engine using Web Audio API
  let audioCtx;
  const initAudio = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  };

  // Dynamic Deep Bubble Sound
  window.playPopSound = (volumeScale = 1.0) => {
    initAudio();
    if(!audioCtx) return;
    const t = audioCtx.currentTime;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    
    const peakVol = 0.3 * volumeScale;
    const endVol = 0.01 * volumeScale;
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peakVol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(endVol, t + 0.15);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(t);
    osc.stop(t + 0.15);
  };

  // Global click listener for context-aware dynamic volume sounds
  document.addEventListener('click', (e) => {
    initAudio();
    
    const target = e.target;
    
    // 1. Filter Buttons (Loud)
    if (target.closest('.filter-btn')) {
      if (window.playPopSound) window.playPopSound(1.0);
      return;
    }
    
    // 2. Like Buttons / Bookmarks (Extra Loud)
    if (target.closest('button svg path[d*="M19"]') || target.closest('button[class*="heart"]')) {
      if (window.playPopSound) window.playPopSound(1.5);
      return;
    }
    
    // 3. Navbar/Header Buttons (Medium)
    if (target.closest('nav button') || target.closest('nav a') || target.closest('#clearFiltersBtn')) {
      if (window.playPopSound) window.playPopSound(0.7);
      return;
    }
    
    // 4. Portfolio Cards / Links (Soft)
    if (target.closest('a') || target.closest('.portfolio-wrapper')) {
      if (window.playPopSound) window.playPopSound(0.4);
      return;
    }
  });
</script>
</body>
</html>"""

# find index
idx = content.find("    const createSkeletonHTML = (index) => {")
if idx != -1:
    content = content[:idx] + clean_tail
    with open("src/pages/index.astro", "w", encoding="utf-8") as f:
        f.write(content)
    print("Fixed!")
else:
    print("Error: Marker not found")

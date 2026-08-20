const MOBILE_MENU_QUERY = '(max-width: 39.999rem)';
const VIEWPORT_GUTTER = 12;
const PANEL_GAP = 10;

const isElement = (value) => value instanceof HTMLElement;

const createOptionButton = (option, index, panelId) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `${panelId}-option-${index}`;
  button.className = 'discovery-menu__option';
  button.dataset.menuOption = '';
  button.dataset.value = option.value;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;

  const number = document.createElement('span');
  number.className = 'discovery-menu__option-index';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1).padStart(2, '0');

  const copy = document.createElement('span');
  copy.className = 'discovery-menu__option-copy';

  const label = document.createElement('span');
  label.className = 'discovery-menu__option-label';
  label.textContent = option.textContent?.trim() || option.value;

  const description = document.createElement('span');
  description.className = 'discovery-menu__option-description';
  description.textContent = option.dataset.description || '';

  const check = document.createElement('span');
  check.className = 'discovery-menu__option-check';
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '✓';

  copy.append(label, description);
  button.append(number, copy, check);
  return button;
};

export const enhanceDiscoveryMenus = (root = document) => {
  const menuElements = Array.from(root.querySelectorAll('[data-discovery-menu]'));
  const controls = [];
  const mobileQuery = window.matchMedia(MOBILE_MENU_QUERY);
  let placementFrame = 0;

  const isControlOpen = (control) => {
    if (control.usesPopover) return control.panel.matches(':popover-open');
    return control.panel.dataset.fallbackOpen === 'true';
  };

  const syncBodyState = () => {
    document.body.classList.toggle(
      'discovery-filter-open',
      controls.some(isControlOpen),
    );
  };

  const syncSelection = (control) => {
    const selectedIndex = Math.max(control.select.selectedIndex, 0);
    const selectedOption = control.select.options[selectedIndex];
    if (!selectedOption) return;

    control.value.textContent = selectedOption.textContent?.trim() || selectedOption.value;
    control.trigger.setAttribute('aria-label', `${control.select.getAttribute('aria-label') || 'Select'}: ${control.value.textContent}`);
    control.options.forEach((option, index) => {
      const selected = index === selectedIndex;
      option.setAttribute('aria-selected', String(selected));
      option.tabIndex = selected ? 0 : -1;
      if (!isControlOpen(control)) delete option.dataset.active;
    });
  };

  const positionPanel = (control) => {
    if (!isControlOpen(control)) return;
    const { panel, trigger } = control;
    const mobile = mobileQuery.matches;
    panel.dataset.mobile = String(mobile);
    panel.style.removeProperty('inset');
    panel.style.removeProperty('left');
    panel.style.removeProperty('right');
    panel.style.removeProperty('top');
    panel.style.removeProperty('bottom');
    panel.style.removeProperty('width');
    panel.style.removeProperty('max-height');

    if (mobile) {
      panel.dataset.placement = 'bottom-sheet';
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const idealWidth = control.select.id === 'roleFilterSelect' ? 304 : 272;
    const panelWidth = Math.min(
      Math.max(triggerRect.width, idealWidth),
      window.innerWidth - VIEWPORT_GUTTER * 2,
    );
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${Math.max(180, window.innerHeight - VIEWPORT_GUTTER * 2)}px`;

    const measuredHeight = Math.min(
      panel.getBoundingClientRect().height || panel.scrollHeight,
      window.innerHeight - VIEWPORT_GUTTER * 2,
    );
    const spaceBelow = window.innerHeight - triggerRect.bottom - PANEL_GAP - VIEWPORT_GUTTER;
    const spaceAbove = triggerRect.top - PANEL_GAP - VIEWPORT_GUTTER;
    const openAbove = spaceBelow < Math.min(measuredHeight, 260) && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(VIEWPORT_GUTTER, triggerRect.top - measuredHeight - PANEL_GAP)
      : Math.min(
          window.innerHeight - measuredHeight - VIEWPORT_GUTTER,
          triggerRect.bottom + PANEL_GAP,
        );
    const left = Math.min(
      window.innerWidth - panelWidth - VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, triggerRect.left),
    );

    panel.dataset.placement = openAbove ? 'top' : 'bottom';
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(VIEWPORT_GUTTER, top)}px`;
  };

  const schedulePlacement = () => {
    if (placementFrame) return;
    placementFrame = window.requestAnimationFrame(() => {
      placementFrame = 0;
      controls.forEach(positionPanel);
    });
  };

  const setOpenState = (control, open) => {
    control.menu.dataset.open = String(open);
    control.trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      schedulePlacement();
      window.requestAnimationFrame(() => {
        document.dispatchEvent(new Event('customcursor:promote'));
      });
    } else {
      control.options.forEach(option => delete option.dataset.active);
    }
    syncBodyState();
  };

  const closeControl = (control, { restoreFocus = false } = {}) => {
    if (!isControlOpen(control)) return;
    if (control.usesPopover) {
      control.panel.hidePopover();
    } else {
      delete control.panel.dataset.fallbackOpen;
      setOpenState(control, false);
      window.setTimeout(() => {
        if (!isControlOpen(control)) control.panel.hidden = true;
      }, 180);
    }
    if (restoreFocus) control.trigger.focus({ preventScroll: true });
  };

  const closeAll = (except = null) => {
    controls.forEach(control => {
      if (control !== except) closeControl(control);
    });
  };

  const focusOption = (control, index) => {
    if (control.options.length === 0) return;
    const normalizedIndex = (index + control.options.length) % control.options.length;
    control.options.forEach((option, optionIndex) => {
      if (optionIndex === normalizedIndex) option.dataset.active = 'true';
      else delete option.dataset.active;
    });
    control.activeIndex = normalizedIndex;
    control.options[normalizedIndex].focus({ preventScroll: true });
    control.options[normalizedIndex].scrollIntoView({ block: 'nearest' });
  };

  const openControl = (control, { focus = 'selected' } = {}) => {
    closeAll(control);
    if (!isControlOpen(control)) {
      control.panel.dataset.mobile = String(mobileQuery.matches);
      if (control.usesPopover) {
        control.panel.showPopover();
      } else {
        control.panel.hidden = false;
        window.requestAnimationFrame(() => {
          control.panel.dataset.fallbackOpen = 'true';
          setOpenState(control, true);
          positionPanel(control);
        });
      }
    }

    positionPanel(control);
    if (focus !== 'none') {
      window.requestAnimationFrame(() => {
        const selectedIndex = Math.max(control.select.selectedIndex, 0);
        focusOption(
          control,
          focus === 'last' ? control.options.length - 1 : selectedIndex,
        );
      });
    }
  };

  const commitOption = (control, optionButton) => {
    const nextValue = optionButton.dataset.value;
    if (typeof nextValue !== 'string') return;
    control.select.value = nextValue;
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    syncSelection(control);
    closeControl(control, { restoreFocus: true });
  };

  for (const menu of menuElements) {
    if (!(menu instanceof HTMLElement) || menu.dataset.enhanced === 'true') continue;
    const select = menu.querySelector('select');
    const trigger = menu.querySelector('[data-menu-trigger]');
    const value = menu.querySelector('[data-menu-value]');
    const panel = menu.querySelector('[data-menu-panel]');
    const optionsContainer = menu.querySelector('[data-menu-options]');
    if (
      !(select instanceof HTMLSelectElement)
      || !(trigger instanceof HTMLButtonElement)
      || !isElement(value)
      || !isElement(panel)
      || !isElement(optionsContainer)
    ) continue;

    const usesPopover = typeof panel.showPopover === 'function';
    const options = Array.from(select.options).map((option, index) =>
      createOptionButton(option, index, panel.id || `${select.id}-menu`)
    );
    optionsContainer.replaceChildren(...options);

    const control = {
      menu,
      select,
      trigger,
      value,
      panel,
      options,
      usesPopover,
      activeIndex: Math.max(select.selectedIndex, 0),
      typeahead: '',
      typeaheadTimer: 0,
    };
    controls.push(control);
    menu.dataset.enhanced = 'true';
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    if (usesPopover) panel.hidden = false;
    syncSelection(control);

    if (usesPopover) {
      panel.addEventListener('toggle', event => {
        const open = event.newState === 'open';
        setOpenState(control, open);
        if (open) positionPanel(control);
      });
    }

    trigger.addEventListener('click', () => {
      if (usesPopover) return;
      if (isControlOpen(control)) closeControl(control);
      else openControl(control, { focus: 'none' });
    });

    trigger.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openControl(control, {
        focus: event.key === 'ArrowUp' ? 'last' : 'selected',
      });
    });

    options.forEach((option, index) => {
      option.addEventListener('click', () => commitOption(control, option));
      option.addEventListener('focus', () => {
        control.activeIndex = index;
        options.forEach((candidate, candidateIndex) => {
          if (candidateIndex === index) candidate.dataset.active = 'true';
          else delete candidate.dataset.active;
        });
      });
    });

    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeControl(control, { restoreFocus: true });
        return;
      }
      if (event.key === 'Tab') {
        closeControl(control);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(control, control.activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusOption(control, event.key === 'Home' ? 0 : options.length - 1);
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('[data-menu-option]')) {
        event.preventDefault();
        commitOption(control, document.activeElement);
        return;
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;

      window.clearTimeout(control.typeaheadTimer);
      control.typeahead += event.key.toLocaleLowerCase();
      control.typeaheadTimer = window.setTimeout(() => {
        control.typeahead = '';
      }, 550);
      const start = (control.activeIndex + 1) % options.length;
      for (let offset = 0; offset < options.length; offset += 1) {
        const index = (start + offset) % options.length;
        const label = select.options[index]?.textContent?.trim().toLocaleLowerCase() || '';
        if (label.startsWith(control.typeahead)) {
          focusOption(control, index);
          break;
        }
      }
    });

    select.addEventListener('change', () => syncSelection(control));
  }

  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Node)) return;
    for (const control of controls) {
      if (
        !control.usesPopover
        && isControlOpen(control)
        && !control.menu.contains(event.target)
        && !control.panel.contains(event.target)
      ) closeControl(control);
    }
  }, { passive: true });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openMenuControl = controls.find(isControlOpen);
    if (!openMenuControl) return;
    event.preventDefault();
    closeControl(openMenuControl, { restoreFocus: true });
  });

  window.addEventListener('resize', schedulePlacement, { passive: true });
  window.addEventListener('scroll', schedulePlacement, { passive: true });
  window.visualViewport?.addEventListener('resize', schedulePlacement, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedulePlacement, { passive: true });
  mobileQuery.addEventListener('change', schedulePlacement);

  return {
    closeAll: () => closeAll(),
    syncAll: () => controls.forEach(syncSelection),
  };
};

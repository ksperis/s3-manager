(function () {
  const carouselSelector = "[data-docs-carousel]";
  const themedShotSelector = "[data-docs-themed-shot]";
  const themedShotVariantSelector = "[data-docs-shot-variant]";
  const screenshotTriggerSelector = ".docs-screenshot-trigger";
  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  const collections = new Set();
  let themeObserver = null;

  const lightbox = {
    root: null,
    dialog: null,
    title: null,
    image: null,
    caption: null,
    counter: null,
    footer: null,
    thumbnails: null,
    closeButton: null,
    previousButton: null,
    nextButton: null,
    thumbButtons: [],
    currentCollection: null,
    returnFocusTo: null,
    bodyOverflow: "",
    htmlOverflow: "",
  };

  function createButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function createIconButton(label, className, symbol) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);

    const icon = document.createElement("span");
    icon.className = "docs-screenshot-lightbox__nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = symbol;
    button.appendChild(icon);

    return button;
  }

  function createCollection(title, options) {
    const collection = {
      title,
      slides: [],
      thumbButtons: [],
      currentIndex: 0,
      hideChromeWhenSingle: Boolean(options && options.hideChromeWhenSingle),
      render: () => {},
      refresh: () => {},
    };
    collections.add(collection);
    return collection;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resolveUrl(value) {
    if (!value) return "";

    try {
      return new URL(value, window.location.href).href;
    } catch (_error) {
      return value;
    }
  }

  function getActiveThemeVariant() {
    return document.documentElement?.dataset.mdColorScheme === "slate" ? "dark" : "light";
  }

  function isThemedShot(element) {
    return element instanceof HTMLElement && element.matches(themedShotSelector);
  }

  function getThemedShotVariantImage(shot, variant) {
    if (!isThemedShot(shot)) return null;
    const image = shot.querySelector(`${themedShotVariantSelector}[data-docs-shot-variant="${variant}"]`);
    return image instanceof HTMLImageElement ? image : null;
  }

  function getActiveMediaElement(element) {
    if (isThemedShot(element)) {
      return (
        getThemedShotVariantImage(element, getActiveThemeVariant())
        || getThemedShotVariantImage(element, "light")
        || getThemedShotVariantImage(element, "dark")
      );
    }
    return element instanceof HTMLImageElement ? element : null;
  }

  function resolveMediaUrl(element) {
    const image = getActiveMediaElement(element);
    if (!(image instanceof HTMLImageElement)) return "";
    return resolveUrl(image.currentSrc || image.getAttribute("src") || "");
  }

  function resolveMediaPath(element) {
    const url = resolveMediaUrl(element);
    if (!url) return "";

    try {
      return new URL(url).pathname;
    } catch (_error) {
      return url;
    }
  }

  function resolveMediaAlt(element, fallback) {
    const image = getActiveMediaElement(element);
    if (image && image.getAttribute("alt")) {
      return image.getAttribute("alt") || fallback || "";
    }
    return fallback || "";
  }

  function updateThumbPreview(thumb, sourceUrl) {
    if (!(thumb instanceof HTMLElement)) return;
    const thumbImage = thumb.querySelector("img");
    if (thumbImage instanceof HTMLImageElement) {
      thumbImage.src = sourceUrl;
    }
  }

  function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.hidden) return false;
      if (element.getAttribute("aria-hidden") === "true") return false;
      if (element.tabIndex < 0) return false;
      return element.offsetParent !== null || element === document.activeElement;
    });
  }

  function trapFocus(container, event) {
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== "function") return;

    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }
  }

  function isLightboxOpen() {
    return Boolean(lightbox.root && !lightbox.root.hidden);
  }

  function shouldHideChrome(collection) {
    return Boolean(collection && collection.hideChromeWhenSingle && collection.slides.length <= 1);
  }

  function buildLightbox() {
    if (lightbox.root) return lightbox;

    const root = document.createElement("div");
    root.className = "docs-screenshot-lightbox";
    root.hidden = true;

    const dialog = document.createElement("div");
    dialog.className = "docs-screenshot-lightbox__dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;

    const titleId = "docs-screenshot-lightbox-title";
    dialog.setAttribute("aria-labelledby", titleId);

    const title = document.createElement("h2");
    title.className = "docs-screenshot-lightbox__title";
    title.id = titleId;

    const counter = document.createElement("div");
    counter.className = "docs-screenshot-lightbox__counter";
    counter.setAttribute("aria-live", "polite");

    const closeButton = createButton("Close", "docs-screenshot-lightbox__close");
    closeButton.setAttribute("aria-label", "Close fullscreen screenshot viewer");

    const figure = document.createElement("figure");
    figure.className = "docs-screenshot-lightbox__figure";

    const media = document.createElement("div");
    media.className = "docs-screenshot-lightbox__media";

    const topbar = document.createElement("div");
    topbar.className = "docs-screenshot-lightbox__topbar";

    const meta = document.createElement("div");
    meta.className = "docs-screenshot-lightbox__meta";
    meta.append(title, counter);

    topbar.append(meta, closeButton);

    const previousButton = createIconButton(
      "Show previous screenshot",
      "docs-screenshot-lightbox__nav docs-screenshot-lightbox__nav--prev",
      "‹"
    );
    const nextButton = createIconButton(
      "Show next screenshot",
      "docs-screenshot-lightbox__nav docs-screenshot-lightbox__nav--next",
      "›"
    );

    const image = document.createElement("img");
    image.className = "docs-screenshot-lightbox__image";
    image.decoding = "async";

    const captionWrap = document.createElement("div");
    captionWrap.className = "docs-screenshot-lightbox__caption-wrap";

    const caption = document.createElement("div");
    caption.className = "docs-screenshot-lightbox__caption";

    captionWrap.appendChild(caption);
    media.append(image, previousButton, nextButton, topbar, captionWrap);

    figure.appendChild(media);

    const footer = document.createElement("div");
    footer.className = "docs-screenshot-lightbox__footer";

    const thumbnails = document.createElement("div");
    thumbnails.className = "docs-screenshot-lightbox__thumbnails";

    footer.appendChild(thumbnails);
    dialog.append(figure, footer);
    root.appendChild(dialog);
    document.body.appendChild(root);

    root.addEventListener("click", (event) => {
      if (event.target === root) {
        closeLightbox();
      }
    });

    closeButton.addEventListener("click", () => {
      closeLightbox();
    });

    previousButton.addEventListener("click", () => {
      navigateLightbox(-1);
    });

    nextButton.addEventListener("click", () => {
      navigateLightbox(1);
    });

    lightbox.root = root;
    lightbox.dialog = dialog;
    lightbox.title = title;
    lightbox.image = image;
    lightbox.caption = caption;
    lightbox.counter = counter;
    lightbox.footer = footer;
    lightbox.thumbnails = thumbnails;
    lightbox.closeButton = closeButton;
    lightbox.previousButton = previousButton;
    lightbox.nextButton = nextButton;

    return lightbox;
  }

  function rebuildLightboxThumbnails(collection) {
    const state = buildLightbox();

    state.thumbButtons = collection.slides.map((slide, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "docs-screenshot-lightbox__thumb";
      thumb.setAttribute("aria-label", `Show slide ${index + 1}: ${slide.thumbLabel}`);

      const thumbImage = document.createElement("img");
      thumbImage.src = slide.getSrc();
      thumbImage.alt = "";
      thumbImage.loading = "lazy";
      thumb.appendChild(thumbImage);

      const thumbLabel = document.createElement("span");
      thumbLabel.className = "docs-screenshot-lightbox__thumb-label";
      thumbLabel.textContent = slide.thumbLabel;
      thumb.appendChild(thumbLabel);

      thumb.addEventListener("click", () => {
        collection.render(index);
      });

      return thumb;
    });

    state.thumbnails.replaceChildren(...state.thumbButtons);
  }

  function updateLightbox() {
    if (!isLightboxOpen() || !lightbox.currentCollection) return;

    const collection = lightbox.currentCollection;
    const slide = collection.slides[collection.currentIndex];
    if (!slide) return;

    const hideChrome = shouldHideChrome(collection);

    lightbox.root.classList.toggle("is-simple", hideChrome);
    lightbox.title.textContent = collection.title;
    lightbox.image.src = slide.getSrc();
    lightbox.image.alt = slide.getAlt();
    lightbox.caption.innerHTML = slide.captionHTML;
    lightbox.counter.textContent = `${collection.currentIndex + 1} / ${collection.slides.length}`;

    lightbox.previousButton.disabled = collection.currentIndex === 0;
    lightbox.nextButton.disabled = collection.currentIndex === collection.slides.length - 1;
    lightbox.counter.hidden = hideChrome;
    lightbox.previousButton.hidden = hideChrome;
    lightbox.nextButton.hidden = hideChrome;
    lightbox.footer.hidden = hideChrome;

    lightbox.thumbButtons.forEach((thumb, thumbIndex) => {
      const active = thumbIndex === collection.currentIndex;
      thumb.classList.toggle("is-active", active);
      thumb.setAttribute("aria-current", active ? "true" : "false");
      updateThumbPreview(thumb, collection.slides[thumbIndex].getSrc());
      if (!hideChrome && active) {
        thumb.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }

  function openLightbox(collection, triggerElement) {
    const state = buildLightbox();
    const sourceElement = triggerElement instanceof HTMLElement ? triggerElement : document.activeElement;
    const shouldRebuild = state.currentCollection !== collection;

    state.currentCollection = collection;
    state.returnFocusTo = sourceElement instanceof HTMLElement ? sourceElement : null;

    if (shouldRebuild) {
      rebuildLightboxThumbnails(collection);
    }

    state.bodyOverflow = document.body.style.overflow;
    state.htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    state.root.hidden = false;
    state.root.classList.add("is-open");
    updateLightbox();

    document.removeEventListener("keydown", handleLightboxKeyDown);
    document.addEventListener("keydown", handleLightboxKeyDown);

    requestAnimationFrame(() => {
      focusElement(state.closeButton);
    });
  }

  function closeLightbox(options) {
    if (!lightbox.root || lightbox.root.hidden) return;

    const restoreFocus = !options || options.restoreFocus !== false;
    const returnFocusTo = lightbox.returnFocusTo;

    lightbox.root.hidden = true;
    lightbox.root.classList.remove("is-open", "is-simple");
    lightbox.currentCollection = null;
    lightbox.returnFocusTo = null;

    document.body.style.overflow = lightbox.bodyOverflow;
    document.documentElement.style.overflow = lightbox.htmlOverflow;
    document.removeEventListener("keydown", handleLightboxKeyDown);

    if (restoreFocus && returnFocusTo) {
      requestAnimationFrame(() => {
        focusElement(returnFocusTo);
      });
    }
  }

  function navigateLightbox(delta) {
    const collection = lightbox.currentCollection;
    if (!collection) return;

    const nextIndex = collection.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= collection.slides.length) return;
    collection.render(nextIndex);
  }

  function handleLightboxKeyDown(event) {
    if (!isLightboxOpen() || !lightbox.dialog) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateLightbox(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateLightbox(1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      lightbox.currentCollection?.render(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const collection = lightbox.currentCollection;
      if (!collection) return;
      collection.render(collection.slides.length - 1);
      return;
    }

    trapFocus(lightbox.dialog, event);
  }

  function createMediaTrigger(media, label, variantClass) {
    if (!(media instanceof HTMLElement) || !media.parentNode) return null;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = `docs-screenshot-trigger ${variantClass}`;
    trigger.setAttribute("aria-label", `Open screenshot in fullscreen: ${label}`);

    const hint = document.createElement("span");
    hint.className = "docs-screenshot-trigger__hint";
    hint.textContent = "Fullscreen";

    media.parentNode.insertBefore(trigger, media);
    trigger.append(media, hint);

    return trigger;
  }

  function enhanceCarousel(root) {
    if (!root || root.dataset.carouselInitialized === "true") return;

    const figures = Array.from(root.querySelectorAll(":scope > figure"));
    if (figures.length === 0) return;

    root.dataset.carouselInitialized = "true";
    root.classList.add("is-enhanced");

    const collection = createCollection(root.dataset.carouselTitle || "Screenshot carousel", {
      hideChromeWhenSingle: false,
    });

    const controls = document.createElement("div");
    controls.className = "docs-screenshot-carousel__controls";

    const nav = document.createElement("div");
    nav.className = "docs-screenshot-carousel__nav";

    const previousButton = createButton("Previous", "docs-screenshot-carousel__button");
    previousButton.setAttribute("aria-label", `Show previous slide in ${collection.title}`);
    const nextButton = createButton("Next", "docs-screenshot-carousel__button");
    nextButton.setAttribute("aria-label", `Show next slide in ${collection.title}`);

    const counter = document.createElement("div");
    counter.className = "docs-screenshot-carousel__counter";
    counter.setAttribute("aria-live", "polite");

    nav.append(previousButton, nextButton);
    controls.append(nav, counter);

    const viewport = document.createElement("div");
    viewport.className = "docs-screenshot-carousel__viewport";

    const thumbnails = document.createElement("div");
    thumbnails.className = "docs-screenshot-carousel__thumbnails";

    collection.thumbButtons = figures.map((figure, index) => {
      figure.classList.add("docs-screenshot-carousel__slide");

      const media = figure.querySelector(`${themedShotSelector}, img`);
      const caption = figure.querySelector("figcaption");
      const label = figure.dataset.thumbLabel || resolveMediaAlt(media) || `Slide ${index + 1}`;
      const trigger = media ? createMediaTrigger(media, label, "docs-screenshot-trigger--carousel") : null;

      collection.slides.push({
        figure,
        trigger,
        media,
        getSrc: () => resolveMediaUrl(media),
        getAlt: () => resolveMediaAlt(media, label),
        captionHTML: caption?.innerHTML || escapeHtml(label),
        thumbLabel: label,
      });

      if (trigger) {
        trigger.addEventListener("click", () => {
          collection.render(index);
          openLightbox(collection, trigger);
        });
      }

      viewport.appendChild(figure);

      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "docs-screenshot-carousel__thumb";
      thumb.setAttribute("aria-label", `Show slide ${index + 1}: ${label}`);

      if (media) {
        const thumbImage = document.createElement("img");
        thumbImage.src = resolveMediaUrl(media);
        thumbImage.alt = "";
        thumbImage.loading = "lazy";
        thumb.appendChild(thumbImage);
      }

      const thumbLabel = document.createElement("span");
      thumbLabel.className = "docs-screenshot-carousel__thumb-label";
      thumbLabel.textContent = label;
      thumb.appendChild(thumbLabel);

      thumb.addEventListener("click", () => {
        collection.render(index);
      });

      thumbnails.appendChild(thumb);
      return thumb;
    });

    root.replaceChildren(controls, viewport, thumbnails);

    collection.render = (index) => {
      collection.currentIndex = index;

      collection.slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        slide.figure.hidden = !active;
        slide.figure.setAttribute("aria-hidden", active ? "false" : "true");
        if (slide.trigger) {
          slide.trigger.tabIndex = active ? 0 : -1;
        }
      });

      collection.thumbButtons.forEach((thumb, thumbIndex) => {
        const active = thumbIndex === index;
        thumb.classList.toggle("is-active", active);
        thumb.setAttribute("aria-current", active ? "true" : "false");
      });

      previousButton.disabled = index === 0;
      nextButton.disabled = index === collection.slides.length - 1;
      counter.textContent = `${index + 1} / ${collection.slides.length}`;

      collection.refresh();

      if (lightbox.currentCollection === collection && isLightboxOpen()) {
        updateLightbox();
      }
    };

    collection.refresh = () => {
      collection.thumbButtons.forEach((thumb, thumbIndex) => {
        updateThumbPreview(thumb, collection.slides[thumbIndex].getSrc());
      });
    };

    previousButton.addEventListener("click", () => {
      if (collection.currentIndex > 0) {
        collection.render(collection.currentIndex - 1);
      }
    });

    nextButton.addEventListener("click", () => {
      if (collection.currentIndex < collection.slides.length - 1) {
        collection.render(collection.currentIndex + 1);
      }
    });

    collection.render(0);
  }

  function getContentRoot() {
    return document.querySelector("article.md-content__inner") || document.querySelector(".md-content__inner");
  }

  function getPageTitle(contentRoot) {
    const heading = contentRoot?.querySelector("h1");
    if (heading && heading.textContent) {
      return heading.textContent.trim();
    }

    const title = document.title.replace(/\s*-\s*s3-manager Documentation\s*$/u, "").trim();
    return title || "Documentation screenshot";
  }

  function isEligibleStandaloneMedia(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.dataset.docsScreenshotEnhanced === "true") return false;
    if (element.closest(carouselSelector)) return false;
    if (element.closest(screenshotTriggerSelector)) return false;
    if (element.closest("a, button")) return false;
    if (!isThemedShot(element) && element.closest(themedShotSelector)) return false;

    const path = resolveMediaPath(element);
    return path.includes("/assets/screenshots/") || path.includes("assets/screenshots/");
  }

  function enhanceStandaloneScreenshots() {
    const contentRoot = getContentRoot();
    if (!contentRoot) return;

    const mediaNodes = Array.from(contentRoot.querySelectorAll(`${themedShotSelector}, img`)).filter(isEligibleStandaloneMedia);
    if (mediaNodes.length === 0) return;

    const collection = createCollection(getPageTitle(contentRoot), {
      hideChromeWhenSingle: true,
    });

    mediaNodes.forEach((media, index) => {
      media.dataset.docsScreenshotEnhanced = "true";

      const label = resolveMediaAlt(media, `Screenshot ${index + 1}`).trim() || `Screenshot ${index + 1}`;
      const trigger = createMediaTrigger(media, label, "docs-screenshot-trigger--standalone");

      collection.slides.push({
        trigger,
        media,
        getSrc: () => resolveMediaUrl(media),
        getAlt: () => resolveMediaAlt(media, label),
        captionHTML: escapeHtml(label),
        thumbLabel: label,
      });

      trigger.addEventListener("click", () => {
        collection.render(index);
        openLightbox(collection, trigger);
      });
    });

    collection.render = (index) => {
      collection.currentIndex = index;

      collection.slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        if (slide.trigger) {
          slide.trigger.classList.toggle("is-active", active);
          slide.trigger.setAttribute("aria-current", active ? "true" : "false");
        }
      });

      if (lightbox.currentCollection === collection && isLightboxOpen()) {
        updateLightbox();
      }
    };

    collection.refresh = () => {
      if (lightbox.currentCollection === collection && isLightboxOpen()) {
        updateLightbox();
      }
    };

    collection.render(0);
  }

  function refreshCollections() {
    collections.forEach((collection) => {
      if (typeof collection.refresh === "function") {
        collection.refresh();
      }
    });
  }

  function observeThemeChanges() {
    if (themeObserver || !document.documentElement) return;

    themeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-md-color-scheme")) {
        refreshCollections();
      }
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-md-color-scheme"],
    });
  }

  function initScreenshotViewer() {
    collections.clear();
    closeLightbox({ restoreFocus: false });
    document.querySelectorAll(carouselSelector).forEach((root) => enhanceCarousel(root));
    enhanceStandaloneScreenshots();
    observeThemeChanges();
    refreshCollections();
  }

  if (typeof document$ !== "undefined" && document$ && typeof document$.subscribe === "function") {
    document$.subscribe(initScreenshotViewer);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScreenshotViewer, { once: true });
  } else {
    initScreenshotViewer();
  }
})();

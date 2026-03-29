(function () {
  const selector = "[data-docs-carousel]";

  function createButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function enhanceCarousel(root) {
    if (!root || root.dataset.carouselInitialized === "true") return;

    const figures = Array.from(root.querySelectorAll(":scope > figure"));
    if (figures.length === 0) return;

    root.dataset.carouselInitialized = "true";
    root.classList.add("is-enhanced");

    const carouselTitle = root.dataset.carouselTitle || "Screenshot carousel";
    const currentIndex = { value: 0 };

    const controls = document.createElement("div");
    controls.className = "docs-screenshot-carousel__controls";

    const nav = document.createElement("div");
    nav.className = "docs-screenshot-carousel__nav";

    const previousButton = createButton("Previous", "docs-screenshot-carousel__button");
    previousButton.setAttribute("aria-label", `Show previous slide in ${carouselTitle}`);
    const nextButton = createButton("Next", "docs-screenshot-carousel__button");
    nextButton.setAttribute("aria-label", `Show next slide in ${carouselTitle}`);

    const counter = document.createElement("div");
    counter.className = "docs-screenshot-carousel__counter";
    counter.setAttribute("aria-live", "polite");

    nav.append(previousButton, nextButton);
    controls.append(nav, counter);

    const viewport = document.createElement("div");
    viewport.className = "docs-screenshot-carousel__viewport";

    const thumbnails = document.createElement("div");
    thumbnails.className = "docs-screenshot-carousel__thumbnails";

    const thumbButtons = figures.map((figure, index) => {
      figure.classList.add("docs-screenshot-carousel__slide");
      viewport.appendChild(figure);

      const image = figure.querySelector("img");
      const label = figure.dataset.thumbLabel || image?.getAttribute("alt") || `Slide ${index + 1}`;

      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "docs-screenshot-carousel__thumb";
      thumb.setAttribute("aria-label", `Show slide ${index + 1}: ${label}`);

      if (image) {
        const thumbImage = document.createElement("img");
        thumbImage.src = image.getAttribute("src") || "";
        thumbImage.alt = "";
        thumbImage.loading = "lazy";
        thumb.appendChild(thumbImage);
      }

      const thumbLabel = document.createElement("span");
      thumbLabel.className = "docs-screenshot-carousel__thumb-label";
      thumbLabel.textContent = label;
      thumb.appendChild(thumbLabel);

      thumb.addEventListener("click", () => {
        render(index);
      });

      thumbnails.appendChild(thumb);
      return thumb;
    });

    root.replaceChildren(controls, viewport, thumbnails);

    function render(index) {
      currentIndex.value = index;

      figures.forEach((figure, figureIndex) => {
        const active = figureIndex === index;
        figure.hidden = !active;
        figure.setAttribute("aria-hidden", active ? "false" : "true");
      });

      thumbButtons.forEach((thumb, thumbIndex) => {
        const active = thumbIndex === index;
        thumb.classList.toggle("is-active", active);
        thumb.setAttribute("aria-current", active ? "true" : "false");
      });

      previousButton.disabled = index === 0;
      nextButton.disabled = index === figures.length - 1;
      counter.textContent = `${index + 1} / ${figures.length}`;
    }

    previousButton.addEventListener("click", () => {
      if (currentIndex.value > 0) {
        render(currentIndex.value - 1);
      }
    });

    nextButton.addEventListener("click", () => {
      if (currentIndex.value < figures.length - 1) {
        render(currentIndex.value + 1);
      }
    });

    render(0);
  }

  function initCarousels() {
    document.querySelectorAll(selector).forEach((root) => enhanceCarousel(root));
  }

  if (typeof document$ !== "undefined" && document$ && typeof document$.subscribe === "function") {
    document$.subscribe(initCarousels);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarousels, { once: true });
  } else {
    initCarousels();
  }
})();

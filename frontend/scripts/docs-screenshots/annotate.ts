import type { Page } from "@playwright/test";
import type { AnnotationSide, AnnotationTarget } from "./types";

type ResolvedAnnotation = {
  label: string;
  side: AnnotationSide;
  offsetX: number;
  offsetY: number;
  target: { x: number; y: number; width: number; height: number };
};

const OVERLAY_ID = "doc-screenshot-overlay";

function defaultSide(side?: AnnotationSide): AnnotationSide {
  return side ?? "top";
}

export async function applyAnnotations(page: Page, targets: AnnotationTarget[]): Promise<void> {
  const resolved: ResolvedAnnotation[] = [];

  for (const target of targets) {
    const candidates = page.locator(target.selector);
    const count = await candidates.count();
    let visibleLocator: ReturnType<typeof candidates.nth> | null = null;

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible()) {
        visibleLocator = candidate;
        break;
      }
    }

    if (!visibleLocator) {
      throw new Error(`Unable to resolve visible annotation target: ${target.selector}`);
    }

    const box = await visibleLocator.boundingBox();
    if (!box) {
      throw new Error(`Unable to resolve annotation target: ${target.selector}`);
    }
    resolved.push({
      label: target.label,
      side: defaultSide(target.side),
      offsetX: target.offsetX ?? 0,
      offsetY: target.offsetY ?? 0,
      target: box,
    });
  }

  await page.evaluate(
    ({ overlayId, annotations }) => {
      const existing = document.getElementById(overlayId);
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = overlayId;
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483647";

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(window.innerWidth));
      svg.setAttribute("height", String(window.innerHeight));
      svg.style.position = "absolute";
      svg.style.inset = "0";

      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

      annotations.forEach((annotation, index) => {
        const { x, y, width, height } = annotation.target;
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        let labelX = centerX;
        let labelY = y - 58;
        let anchorX = centerX;
        let anchorY = y;

        if (annotation.side === "right") {
          labelX = x + width + 92;
          labelY = centerY;
          anchorX = x + width;
          anchorY = centerY;
        } else if (annotation.side === "left") {
          labelX = x - 92;
          labelY = centerY;
          anchorX = x;
          anchorY = centerY;
        } else if (annotation.side === "bottom") {
          labelX = centerX;
          labelY = y + height + 62;
          anchorX = centerX;
          anchorY = y + height;
        }

        labelX += annotation.offsetX;
        labelY += annotation.offsetY;

        labelX = clamp(labelX, 24, window.innerWidth - 24);
        labelY = clamp(labelY, 24, window.innerHeight - 24);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(anchorX));
        line.setAttribute("y1", String(anchorY));
        line.setAttribute("x2", String(labelX));
        line.setAttribute("y2", String(labelY));
        line.setAttribute("stroke", "#38bdf8");
        line.setAttribute("stroke-width", "3");
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", String(anchorX));
        dot.setAttribute("cy", String(anchorY));
        dot.setAttribute("r", "5");
        dot.setAttribute("fill", "#38bdf8");
        svg.appendChild(dot);

        const labelWrap = document.createElement("div");
        labelWrap.style.position = "absolute";
        labelWrap.style.left = `${labelX}px`;
        labelWrap.style.top = `${labelY}px`;
        labelWrap.style.transform = "translate(-50%, -50%)";
        labelWrap.style.display = "inline-flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
        labelWrap.style.background = "rgba(2, 6, 23, 0.92)";
        labelWrap.style.border = "2px solid #38bdf8";
        labelWrap.style.borderRadius = "999px";
        labelWrap.style.padding = "6px 12px";
        labelWrap.style.color = "#e2e8f0";
        labelWrap.style.fontFamily = "Inter, ui-sans-serif, system-ui";
        labelWrap.style.fontSize = "14px";
        labelWrap.style.fontWeight = "600";
        labelWrap.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.35)";

        const badge = document.createElement("span");
        badge.textContent = String(index + 1);
        badge.style.display = "inline-flex";
        badge.style.alignItems = "center";
        badge.style.justifyContent = "center";
        badge.style.width = "22px";
        badge.style.height = "22px";
        badge.style.borderRadius = "999px";
        badge.style.background = "#38bdf8";
        badge.style.color = "#0f172a";
        badge.style.fontSize = "12px";
        badge.style.fontWeight = "700";

        const text = document.createElement("span");
        text.textContent = annotation.label;

        labelWrap.appendChild(badge);
        labelWrap.appendChild(text);
        overlay.appendChild(labelWrap);
      });

      overlay.appendChild(svg);
      document.body.appendChild(overlay);
    },
    { overlayId: OVERLAY_ID, annotations: resolved }
  );
}

export async function clearAnnotations(page: Page): Promise<void> {
  await page.evaluate((overlayId) => {
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();
  }, OVERLAY_ID);
}

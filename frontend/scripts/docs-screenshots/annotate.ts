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
      document.body.appendChild(overlay);

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(window.innerWidth));
      svg.setAttribute("height", String(window.innerHeight));
      svg.style.position = "absolute";
      svg.style.inset = "0";
      overlay.appendChild(svg);

      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const viewportPadding = 24;
      const topViewportPadding = 8;
      const lineInset = 10;
      const topLabelGap = 18;
      const topEdgeHorizontalNudge = 96;
      const topTargetClearance = 16;

      const createLabelWrap = (label: string, index: number) => {
        const labelWrap = document.createElement("div");
        labelWrap.style.position = "absolute";
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
        labelWrap.style.visibility = "hidden";

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
        text.textContent = label;

        labelWrap.appendChild(badge);
        labelWrap.appendChild(text);
        overlay.appendChild(labelWrap);
        return labelWrap;
      };

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

        const labelWrap = createLabelWrap(annotation.label, index);
        const labelRect = labelWrap.getBoundingClientRect();
        const halfWidth = labelRect.width / 2;
        const halfHeight = labelRect.height / 2;

        labelX = clamp(labelX, viewportPadding + halfWidth, window.innerWidth - viewportPadding - halfWidth);
        if (annotation.side === "top") {
          const preferredTopY = y - halfHeight - topLabelGap;
          const minimumTopY = topViewportPadding + halfHeight;
          labelY = preferredTopY;
          if (preferredTopY < minimumTopY) {
            labelY = minimumTopY;
            const roomOnRight = window.innerWidth - centerX - viewportPadding - halfWidth;
            const roomOnLeft = centerX - viewportPadding - halfWidth;
            const nudge = Math.max(topEdgeHorizontalNudge, halfWidth * 0.8);
            if (roomOnRight >= roomOnLeft && roomOnRight > 32) {
              labelX += Math.min(roomOnRight, nudge);
            } else if (roomOnLeft > 32) {
              labelX -= Math.min(roomOnLeft, nudge);
            }
            labelX = clamp(labelX, viewportPadding + halfWidth, window.innerWidth - viewportPadding - halfWidth);
          }
          const labelLeft = () => labelX - halfWidth;
          const labelRight = () => labelX + halfWidth;
          const labelBottom = () => labelY + halfHeight;
          const targetLeft = x;
          const targetRight = x + width;
          const targetTop = y;
          const targetBottom = y + height;
          const overlapsTarget =
            labelRight() > targetLeft &&
            labelLeft() < targetRight &&
            labelBottom() > targetTop - topTargetClearance;
          if (overlapsTarget) {
            const shiftRight = targetRight - labelLeft() + topTargetClearance;
            const shiftLeft = labelRight() - targetLeft + topTargetClearance;
            const maxRightShift = window.innerWidth - viewportPadding - halfWidth - labelX;
            const maxLeftShift = labelX - viewportPadding - halfWidth;
            if (maxRightShift >= maxLeftShift && maxRightShift > 0) {
              labelX += Math.min(maxRightShift, Math.max(shiftRight, topEdgeHorizontalNudge));
            } else if (maxLeftShift > 0) {
              labelX -= Math.min(maxLeftShift, Math.max(shiftLeft, topEdgeHorizontalNudge));
            }
            labelX = clamp(labelX, viewportPadding + halfWidth, window.innerWidth - viewportPadding - halfWidth);
          }
          labelY = clamp(labelY, minimumTopY, window.innerHeight - viewportPadding - halfHeight);
        } else {
          labelY = clamp(labelY, viewportPadding + halfHeight, window.innerHeight - viewportPadding - halfHeight);
        }

        let lineEndX = labelX;
        let lineEndY = labelY;

        if (annotation.side === "right") {
          lineEndX = labelX - halfWidth + lineInset;
        } else if (annotation.side === "left") {
          lineEndX = labelX + halfWidth - lineInset;
        } else if (annotation.side === "bottom") {
          lineEndY = labelY - halfHeight + lineInset;
        } else {
          lineEndY = labelY + halfHeight - lineInset;
        }

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(anchorX));
        line.setAttribute("y1", String(anchorY));
        line.setAttribute("x2", String(lineEndX));
        line.setAttribute("y2", String(lineEndY));
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

        labelWrap.style.left = `${labelX}px`;
        labelWrap.style.top = `${labelY}px`;
        labelWrap.style.visibility = "visible";
      });
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

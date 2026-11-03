// RV31 (Grok 20:05 IST 3 Nov): the v9 narration says at 2:24 "The same page
// works on a desktop, a tablet or a phone". scripts/responsive-check.ts opens
// the upload and verify pages from the local server in headless Edge or Chrome
// at a phone, a tablet and a desktop width, measures them with this file's
// expression, and writes the screenshots and results.json under evidence/.
// What "works" means here is only what is measured: no horizontal overflow,
// and each control a seller or a judge needs is rendered inside the width.

/** Phone, tablet and desktop widths (CSS px). */
export const RESPONSIVE_VIEWPORTS = [
  { label: "375", kind: "phone", width: 375, height: 812, scale: 2 },
  { label: "768", kind: "tablet", width: 768, height: 1024, scale: 2 },
  { label: "1280", kind: "desktop", width: 1280, height: 800, scale: 1 },
] as const;

/**
 * The pages and the controls each must show. The upload page's file input is
 * display:none inside #drop (the tap target that opens the picker), so #drop is
 * the photo input that must be visible.
 */
export const RESPONSIVE_PAGES = [
  { name: "upload", path: "/upload.html", ready: "#start", controls: { "photo picker": "#drop", "submit button": "#start" } },
  { name: "verify", path: "/verify.html", ready: "#check", controls: { "receipt file input": "#receipt-file", "image file input": "#image-file", "check button": "#check" } },
] as const;

export interface ControlBox {
  readonly found: boolean;
  readonly display: string;
  readonly visibility: string;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

export interface PageMeasure {
  readonly innerWidth: number;
  readonly scrollWidth: number;
  readonly controls: Readonly<Record<string, ControlBox>>;
}

/** A browser expression that returns a PageMeasure for the given controls. */
export function measureExpression(controls: Readonly<Record<string, string>>): string {
  return `(() => {
    const controls = {};
    for (const [name, sel] of Object.entries(${JSON.stringify(controls)})) {
      const el = document.querySelector(sel);
      if (!el) { controls[name] = { found: false, display: "", visibility: "", left: 0, right: 0, width: 0, height: 0 }; continue; }
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      controls[name] = { found: true, display: s.display, visibility: s.visibility, left: r.left, right: r.right, width: r.width, height: r.height };
    }
    return { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, controls };
  })()`;
}

/** Everything wrong with one measured page; empty means it passed. */
export function layoutProblems(m: PageMeasure): string[] {
  const out: string[] = [];
  if (m.scrollWidth > m.innerWidth) out.push(`horizontal overflow: scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`);
  for (const [name, c] of Object.entries(m.controls)) {
    if (!c.found) out.push(`${name}: not found`);
    else if (c.display === "none" || c.visibility === "hidden" || c.width <= 0 || c.height <= 0) out.push(`${name}: not rendered`);
    else if (c.left < 0 || c.right > m.innerWidth + 0.5) out.push(`${name}: outside the width (${Math.round(c.left)} to ${Math.round(c.right)} of ${m.innerWidth})`);
  }
  return out;
}

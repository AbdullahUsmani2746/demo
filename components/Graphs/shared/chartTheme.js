// components/Graphs/shared/chartTheme.js — colours for the dashboard charts
// (Chart.js draws on a canvas, so it cannot use the CSS tokens directly).
// Read from the theme variables in app/globals.css at draw time, so the
// charts follow light / dark mode: the primary (maroon; brighter in dark
// mode) first, then calm complementary hues that stay apart from each other.

const FALLBACK = {
  "--primary": [0, 100, 25],
  "--muted-foreground": [0, 0, 45],
  "--border": [0, 0, 85],
  "--background": [0, 0, 100],
}

// Series 2..n as [h, s, l] — muted, readable on white and on the dark card.
const HUES = [
  [192, 34, 40], // teal
  [38, 58, 44], // ochre
  [110, 22, 40], // sage
  [282, 22, 44], // plum
  [14, 52, 48], // terracotta
  [220, 20, 44], // slate
  [30, 28, 46], // tan
]

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")

function readVar(name) {
  if (typeof window === "undefined" || typeof document === "undefined") return FALLBACK[name]
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = raw.match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : FALLBACK[name]
}

const hsla = ([h, s, l], a = 1) => `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`

/** Colour of series i (0 = the theme primary); alpha for fills. */
export function series(i = 0, alpha = 1) {
  if (i % (HUES.length + 1) === 0) return hsla(readVar("--primary"), alpha)
  const [h, s, l] = HUES[(i % (HUES.length + 1)) - 1]
  return hsla([h, s, isDark() ? l + 18 : l], alpha)
}

/** A list of n series colours, e.g. for pie slices. */
export const seriesList = (n, alpha = 1) => Array.from({ length: n }, (_, i) => series(i, alpha))

/** Axis / legend text. */
export const chartText = () => hsla(readVar("--muted-foreground"))
/** Grid lines. */
export const chartGrid = () => hsla(readVar("--border"), 0.6)
/** The card colour — borders around points and slices. */
export const chartSurface = () => hsla(readVar("--background"))

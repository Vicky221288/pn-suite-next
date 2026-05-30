#!/usr/bin/env node
/**
 * WCAG 2.1 contrast checker for the Maroon Meridian token pairs (B0.6).
 * Verifies the pairs noted at the end of app/tokens.css. Exits non-zero if any
 * CRITICAL text pair falls below its threshold (AA body 4.5:1, large 3:1).
 * Badge tint pairs are reported as warnings (the token doc flags them to verify).
 */

function luminance(hex) {
  const c = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// [label, fg, bg, threshold, critical]
const PAIRS = [
  ['ink-900 on cream-100 (body)', '#1F1A17', '#FBF6EC', 4.5, true],
  ['ink-700 on cream-100 (secondary)', '#423B35', '#FBF6EC', 4.5, true],
  ['ink-500 on cream-100 (tertiary)', '#6B625A', '#FBF6EC', 4.5, true],
  ['cream-50 on maroon-500 (button text)', '#FFFDF8', '#8E2A2E', 4.5, true],
  ['maroon-500 on cream-100 (links/ghost)', '#8E2A2E', '#FBF6EC', 4.5, true],
  ['dark: text on dark-bg', '#F5EDE6', '#1A1413', 4.5, true],
  ['dark: secondary on dark-bg', '#C9BDB4', '#1A1413', 4.5, true],
  ['dark: text-on-brand on maroon-400', '#FFFFFF', '#B85457', 4.5, true],
  ['badge success (green-500 on green-100)', '#256840', '#DCEFE3', 4.5, false],
  ['badge warning (amber-500 on amber-100)', '#8A5912', '#F6E9CE', 4.5, false],
  ['badge danger (red-500 on red-100)', '#B5302B', '#F7DAD7', 4.5, false],
  ['badge info (blue-500 on blue-100)', '#2C5E8A', '#D9E6F1', 4.5, false],
];

let failures = 0;
let warnings = 0;
console.log('\n  Maroon Meridian — WCAG contrast check\n  ' + '-'.repeat(52));
for (const [label, fg, bg, threshold, critical] of PAIRS) {
  const r = ratio(fg, bg);
  const pass = r >= threshold;
  const mark = pass ? '✅' : critical ? '❌' : '⚠️ ';
  console.log(`  ${mark} ${r.toFixed(2).padStart(5)}:1  (need ${threshold})  ${label}`);
  if (!pass) {
    if (critical) failures++;
    else warnings++;
  }
}
console.log('  ' + '-'.repeat(52));
console.log(`  ${failures} critical failure(s), ${warnings} warning(s)\n`);
process.exit(failures > 0 ? 1 : 0);

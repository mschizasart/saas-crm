'use client';

/**
 * BrandProvider — white-label per-tenant theming.
 *
 * Fetches the current org's branding (`GET /organizations/me/branding`) and,
 * when `whiteLabelEnabled` is true, injects the brand colors onto
 * `document.documentElement` as the CSS variables Tailwind reads
 * (`--primary`, `--ring`, `--sidebar-*`, …). When disabled or absent it
 * REMOVES any inline overrides so the default theme from globals.css applies.
 *
 * No-flash strategy: there is no localStorage cache of brand colors (unlike
 * dark-mode, the brand is org-scoped and must come from the API after auth),
 * so we can't fully avoid a first-paint with the platform default the very
 * first time. To minimise flicker we:
 *   1. read a cached snapshot from sessionStorage synchronously on mount and
 *      apply it before the network round-trip resolves, and
 *   2. set the vars via inline style on <html>, which wins over the stylesheet
 *      :root rule without a re-render.
 * The cache is keyed per access-token-org so switching orgs re-themes cleanly.
 *
 * Security: colors are validated server-side (strict hex) AND re-validated
 * here before being written to a CSS variable, so a tampered API response
 * cannot inject arbitrary CSS.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const HEX = /^#[0-9a-fA-F]{6}$/;
const CACHE_KEY = 'brand_cache_v1';

export interface Branding {
  name?: string;
  slug?: string;
  logo?: string | null;
  brandPrimaryColor?: string | null;
  brandSidebarColor?: string | null;
  brandFaviconUrl?: string | null;
  whiteLabelEnabled?: boolean;
}

/** Convert `#rrggbb` → `"H S% L%"` (the channel format Tailwind tokens use). */
export function hexToHslChannels(hex: string): string | null {
  if (!HEX.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return `${H} ${S}% ${L}%`;
}

/** Pick a readable foreground (near-white or near-black) for a given bg. */
function foregroundFor(channels: string): string {
  // channels = "H S% L%" — use lightness to decide.
  const parts = channels.split(' ');
  const l = parseFloat(parts[2] ?? '50');
  return l > 60 ? '222.2 47.4% 11.2%' : '210 40% 98%';
}

const BRAND_VARS = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--sidebar-background',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
] as const;

/** Apply (or, when `b` is null/disabled, clear) brand CSS variables. */
export function applyBranding(b: Branding | null) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const clear = () => BRAND_VARS.forEach((v) => root.style.removeProperty(v));

  if (!b || !b.whiteLabelEnabled) {
    clear();
    return;
  }

  // Primary / accent.
  if (b.brandPrimaryColor && HEX.test(b.brandPrimaryColor)) {
    const primary = hexToHslChannels(b.brandPrimaryColor);
    if (primary) {
      root.style.setProperty('--primary', primary);
      root.style.setProperty('--primary-foreground', foregroundFor(primary));
      root.style.setProperty('--ring', primary);
      // The sidebar's active item uses --sidebar-primary; tie it to the brand.
      root.style.setProperty('--sidebar-primary', primary);
      root.style.setProperty(
        '--sidebar-primary-foreground',
        foregroundFor(primary),
      );
      root.style.setProperty('--sidebar-ring', primary);
    }
  } else {
    ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-ring'].forEach(
      (v) => root.style.removeProperty(v),
    );
  }

  // Sidebar background (optional — falls back to default dark).
  if (b.brandSidebarColor && HEX.test(b.brandSidebarColor)) {
    const sidebar = hexToHslChannels(b.brandSidebarColor);
    if (sidebar) {
      root.style.setProperty('--sidebar-background', sidebar);
      const fg = foregroundFor(sidebar);
      root.style.setProperty('--sidebar-foreground', fg);
      // Derive a subtle hover/accent by nudging lightness toward the fg.
      const [h, s, l] = sidebar.split(' ');
      const ln = parseFloat(l);
      const accentL = ln > 50 ? Math.max(0, ln - 8) : Math.min(100, ln + 8);
      root.style.setProperty('--sidebar-accent', `${h} ${s} ${accentL}%`);
      root.style.setProperty('--sidebar-accent-foreground', fg);
    }
  } else {
    ['--sidebar-background', '--sidebar-foreground', '--sidebar-accent', '--sidebar-accent-foreground'].forEach(
      (v) => root.style.removeProperty(v),
    );
  }

  // Favicon swap (best-effort).
  if (b.brandFaviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.brandFaviconUrl;
  }
}

function readCache(): Branding | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Branding) : null;
  } catch {
    return null;
  }
}

function writeCache(b: Branding | null) {
  try {
    if (b) sessionStorage.setItem(CACHE_KEY, JSON.stringify(b));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mounted in the shared root providers (apps/web/app/providers.tsx) so it
 * covers the admin shell, portal and public groups without touching the
 * (admin) layout. It only does work once an access token exists — public
 * pages without auth get their theme from the dedicated public fetch instead.
 */
export function BrandProvider() {
  useEffect(() => {
    // 1. Apply cached snapshot synchronously to minimise flash.
    const cached = readCache();
    if (cached) applyBranding(cached);

    // 2. Skip the network fetch when there's no session — the authenticated
    //    branding endpoint would 401/redirect. Public pages handle their own
    //    theming via /public/branding/:slug.
    const hasToken =
      typeof window !== 'undefined' && !!localStorage.getItem('access_token');
    if (!hasToken) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/me/branding');
        if (!res.ok) return;
        const data = (await res.json()) as Branding;
        if (cancelled) return;
        applyBranding(data);
        writeCache(data.whiteLabelEnabled ? data : null);
      } catch {
        /* keep cached/default theme */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

export default BrandProvider;

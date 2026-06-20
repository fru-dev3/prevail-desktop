// Favorites ("my list") shared across the Apps panel and the home sidebar. A
// single localStorage-backed set of app keys (the app's normalized name / id)
// that the user stars to pin an app to the home sidebar. It works identically
// for Direct, Composio, and Nango apps - the star is the one control that
// decides what shows on the home screen. Toggling a star anywhere notifies
// every listener so the sidebar and the Apps panel stay in sync live.
import { useEffect, useState } from "react";

const FAV_KEY = "prevail.apps.favorites";
const favListeners = new Set<() => void>();

// Normalize a name/id to a stable key so a starred catalog app and its
// later-installed self (and the same app across modes) collapse to one entry.
export const favKeyOf = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function readFavorites(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(key: string) {
  const s = readFavorites();
  if (s.has(key)) s.delete(key);
  else s.add(key);
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
  favListeners.forEach((l) => l());
}

export function useFavorites(): Set<string> {
  const [favs, setFavs] = useState<Set<string>>(readFavorites);
  useEffect(() => {
    const l = () => setFavs(readFavorites());
    favListeners.add(l);
    return () => { favListeners.delete(l); };
  }, []);
  return favs;
}

// True when any of the given keys is favorited. Callers pass an app's title-key
// and id-key so either match counts (an app may be keyed by either).
export function isFavorited(favs: Set<string>, ...keys: string[]): boolean {
  return keys.some((k) => favs.has(k));
}

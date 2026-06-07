export function mediaQueryMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

export function subscribeMediaQuery(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(query);
  const update = () => onChange(media.matches);
  update();
  return addMediaQueryChangeListener(media, update);
}

export function addMediaQueryChangeListener(media: MediaQueryList, listener: () => void): () => void {
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener?.("change", listener);
  }

  if (typeof media.addListener === "function") {
    media.addListener(listener);
    return () => media.removeListener?.(listener);
  }

  return () => undefined;
}

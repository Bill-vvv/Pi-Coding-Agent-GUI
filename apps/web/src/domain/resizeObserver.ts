export function observeElementResize(element: Element, callback: ResizeObserverCallback): () => void {
  const ResizeObserverCtor = globalThis.ResizeObserver;
  if (typeof ResizeObserverCtor === "undefined") return noop;

  const observer = new ResizeObserverCtor(callback);
  observer.observe(element);
  return () => observer.disconnect();
}

function noop(): void {
  // ResizeObserver is optional in older/mobile WebViews. Callers still perform
  // initial measurement and listen for scroll/window resize events.
}

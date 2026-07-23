// Tiny app-wide navigation bridge. App owns routing state; components anywhere (menus,
// modals) navigate by dispatching this event rather than threading a prop through every layer.

const EVENT = "finchpad:navigate";

export function navigateTo(path: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: path }));
}

export function onNavigate(handler: (path: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

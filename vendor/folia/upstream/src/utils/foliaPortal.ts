let portalRoot: HTMLElement | null = null;

export const setFoliaPortalRoot = (element: HTMLElement | null): void => { portalRoot = element; };
export const getFoliaPortalRoot = (): HTMLElement => portalRoot ?? document.body;
export const getFoliaActiveElement = (): Element | null => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
};

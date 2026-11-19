import { vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined') {
  let desktopMatches = true;
  const mediaListeners = new Map();

  const createMediaQueryList = (query) => {
    if (!mediaListeners.has(query)) {
      mediaListeners.set(query, new Set());
    }
    const listeners = mediaListeners.get(query);
    return {
      media: query,
      get matches() {
        if (String(query).includes('min-width: 768px')) {
          return desktopMatches;
        }
        return false;
      },
      onchange: null,
      addEventListener: vi.fn((event, cb) => {
        if (event === 'change' && typeof cb === 'function') {
          listeners.add(cb);
        }
      }),
      removeEventListener: vi.fn((event, cb) => {
        if (event === 'change') {
          listeners.delete(cb);
        }
      }),
      addListener: vi.fn((cb) => {
        if (typeof cb === 'function') listeners.add(cb);
      }),
      removeListener: vi.fn((cb) => {
        listeners.delete(cb);
      }),
      dispatchEvent: vi.fn(),
    };
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query) => createMediaQueryList(query)),
  });

  globalThis.__setViewportDesktop = (isDesktop) => {
    desktopMatches = Boolean(isDesktop);
    for (const [query, listeners] of mediaListeners.entries()) {
      if (String(query).includes('min-width: 768px')) {
        listeners.forEach((cb) => cb({ matches: desktopMatches, media: query }));
      }
    }
  };

  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:vecto-test-url');
  } else {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:vecto-test-url');
  }

  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  if (typeof HTMLCanvasElement !== 'undefined') {
    const mockCtx = {
      fillStyle: '#ffffff',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
    HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlobMock(cb, type) {
      if (typeof cb === 'function') {
        cb(new Blob(['mock-canvas-bytes'], { type: type || 'image/png' }));
      }
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,bW9ja1BuZw==');
  }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => globalThis.__vectoMockOnline ?? true,
  });

  window.scrollTo = vi.fn();
  window.open = vi.fn();
  window.print = vi.fn();
  window.confirm = vi.fn(() => true);
  window.prompt = vi.fn(() => '');
}

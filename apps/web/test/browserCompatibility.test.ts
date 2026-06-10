import assert from "node:assert/strict";
import test from "node:test";
import { addMediaQueryChangeListener, subscribeMediaQuery } from "../src/domain/mediaQuery";
import { createRequestId } from "../src/domain/requestId";
import { observeElementResize } from "../src/domain/resizeObserver";

test("createRequestId falls back when crypto.randomUUID is unavailable", () => {
  withCrypto(
    {
      randomUUID() {
        throw new Error("randomUUID unavailable");
      },
      getRandomValues(bytes: Uint8Array) {
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    },
    () => {
      assert.equal(createRequestId(), "00010203-0405-4607-8809-0a0b0c0d0e0f");
    },
  );
});

test("media query listener helper supports legacy addListener cleanup", () => {
  const calls: string[] = [];
  const media = {
    matches: true,
    addListener(listener: () => void) {
      calls.push("add");
      listener();
    },
    removeListener() {
      calls.push("remove");
    },
  } as unknown as MediaQueryList;

  const cleanup = addMediaQueryChangeListener(media, () => calls.push("change"));
  cleanup();

  assert.deepEqual(calls, ["add", "change", "remove"]);
});

test("subscribeMediaQuery reports initial state and returns a safe cleanup", () => {
  withWindowMatchMedia(
    () => ({
      matches: false,
      addListener() {},
      removeListener() {},
    }),
    () => {
      const values: boolean[] = [];
      const cleanup = subscribeMediaQuery("(max-width: 700px)", (matches) => values.push(matches));
      cleanup();
      assert.deepEqual(values, [false]);
    },
  );
});

test("observeElementResize is a no-op when ResizeObserver is unavailable", () => {
  withResizeObserver(undefined, () => {
    const cleanup = observeElementResize({} as Element, () => assert.fail("resize callback should not run without ResizeObserver"));
    assert.doesNotThrow(cleanup);
  });
});

test("observeElementResize observes and disconnects when ResizeObserver is available", () => {
  const calls: string[] = [];
  class MockResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(element: Element) {
      calls.push(element === mockElement ? "observe" : "observe-other");
      this.callback([], this as unknown as ResizeObserver);
    }
    disconnect() {
      calls.push("disconnect");
    }
  }
  const mockElement = {} as Element;

  withResizeObserver(MockResizeObserver as unknown as typeof ResizeObserver, () => {
    const cleanup = observeElementResize(mockElement, () => calls.push("callback"));
    cleanup();
  });

  assert.deepEqual(calls, ["observe", "callback", "disconnect"]);
});

type MockCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

function withCrypto(crypto: MockCrypto | undefined, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: crypto });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
}

function withWindowMatchMedia(matchMedia: (query: string) => Pick<MediaQueryList, "matches" | "addListener" | "removeListener">, run: () => void): void {
  const global = globalThis as unknown as { window?: unknown };
  const previousWindow = global.window;
  global.window = { matchMedia };
  try {
    run();
  } finally {
    global.window = previousWindow;
  }
}

function withResizeObserver(resizeObserver: typeof ResizeObserver | undefined, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  if (resizeObserver) Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: resizeObserver });
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
}

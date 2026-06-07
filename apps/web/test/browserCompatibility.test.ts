import assert from "node:assert/strict";
import test from "node:test";
import { addMediaQueryChangeListener, subscribeMediaQuery } from "../src/domain/mediaQuery";
import { createRequestId } from "../src/domain/requestId";

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

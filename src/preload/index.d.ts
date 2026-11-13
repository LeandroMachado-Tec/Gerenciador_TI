import type { ApiBridge } from "./index";

declare global {
  interface Window {
    api: ApiBridge;
  }
}

export {};

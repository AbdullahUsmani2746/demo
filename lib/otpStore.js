if (!globalThis.otpStore) {
  globalThis.otpStore = new Map();
}
export const otpStore = globalThis.otpStore;

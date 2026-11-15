"use client";
// Sign out and stop this phone / browser receiving the user's notifications.
// Every sign-out button uses this instead of next-auth's signOut directly, so
// a shared phone never shows the previous user's approvals.
import { signOut } from "next-auth/react";
import { disablePush } from "./client";

const FORGET_TIMEOUT_MS = 1500; // never hold up the sign-out on a slow network

export async function signOutAndForgetDevice(options) {
  await Promise.race([
    disablePush().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS)),
  ]);
  return signOut(options);
}

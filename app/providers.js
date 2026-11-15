"use client"
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"
import { useEffect } from "react"

export function SessionProvider({ children }) {
  useEffect(() => {
    const handleKeydown = (e) => {
      if (
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        e.target.tagName === "INPUT" &&
        e.target.type === "number"
      ) {
        e.preventDefault();
      }
    };

    const handleWheel = (e) => {
      if (
        e.target.tagName === "INPUT" &&
        e.target.type === "number" &&
        document.activeElement === e.target
      ) {
        e.target.blur();
      }
    };

    window.addEventListener("keydown", handleKeydown, { passive: false });
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
}
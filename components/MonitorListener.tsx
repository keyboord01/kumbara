"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitor";

/** Uncaught errors and rejected promises anywhere in the app reach the presenter's monitor (once per kind per page per tab). */
export function MonitorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError(event.error?.name ?? "Error", event.message, "window");
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | undefined;
      reportError(reason?.name ?? "UnhandledRejection", reason?.message ?? String(event.reason), "window");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

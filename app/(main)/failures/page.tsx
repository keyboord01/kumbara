import { Suspense } from "react";
import type { Metadata } from "next";
import { FailureGallery } from "@/components/FailureGallery";

export const metadata: Metadata = {
  title: "Failure states",
  robots: { index: false, follow: false },
};

/** Every failure screen with sample data: `/failures`, or `/failures?kind=relay_unreachable`. Not linked from the app. */
export default function FailuresPage() {
  return (
    <Suspense fallback={null}>
      <FailureGallery />
    </Suspense>
  );
}

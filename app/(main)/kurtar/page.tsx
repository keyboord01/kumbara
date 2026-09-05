"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecoverySetup } from "@sembol/passkey-react";
import { FailureScreen } from "@/components/FailureScreen";
import { classifyError, type Failure } from "@/lib/failures";
import { useLocale } from "@/lib/i18n";

/** Passkey lost: get back in with a backup passkey or recovery key (library flow). */
export default function RecoverPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t.recover.title}</h1>
        <Link href="/" className="text-sm text-teal hover:underline">
          {t.recover.back}
        </Link>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.recover.lead}</p>
      <p className="text-sm leading-relaxed text-ink-2">{t.failures.kinds.passkey_lost.body}</p>
      <section className="card p-5" aria-label={t.recover.title}>
        {done ? (
          <p className="text-sm font-semibold text-mint" role="status">
            {t.recover.done}
          </p>
        ) : (
          <RecoverySetup
            mode="recover"
            onRecovered={() => {
              setDone(true);
              router.push("/kumbara");
            }}
            onError={(err) => setFailure(classifyError(err, "passkey"))}
          />
        )}
      </section>
      {failure ? <FailureScreen failure={failure} compact primary={null} /> : null}
    </div>
  );
}

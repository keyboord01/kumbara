"use client";

import { useState } from "react";
import Link from "next/link";
import { EXPLORER_BASE, NETWORK_LABEL } from "@/lib/config";
import { RUNBOOK_SECTION, isPresenterState, type Failure } from "@/lib/failures";
import { useLocale, type FailureCopy } from "@/lib/i18n";

export interface FailureAction {
  label: string;
  onClick?: () => void;
  href?: string;
  busy?: boolean;
}

interface Props {
  failure: Failure;
  /** Primary action; `null` hides it; omitted → the kind's own label with `onRetry`. */
  primary?: FailureAction | null | undefined;
  onRetry?: (() => void) | undefined;
  secondary?: FailureAction | null | undefined;
  /** Smaller card for inline use inside a flow. */
  compact?: boolean;
  className?: string;
}

function fill(text: string, values: Record<string, string> | undefined): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function ActionButton({ action, primary }: { action: FailureAction; primary: boolean }) {
  const cls = `${primary ? "btn-primary" : "btn-secondary"} w-full`;
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} disabled={action.busy} className={cls}>
      {action.label}
    </button>
  );
}

/**
 * One screen per failure state: plain-language title and explanation (TR/EN),
 * a primary action, the raw detail behind an expander, the bridge account
 * when funds are visibly parked, and the runbook section for the presenter.
 */
export function FailureScreen({ failure, primary, onRetry, secondary, compact = false, className = "" }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const kinds = t.failures.kinds as Record<string, FailureCopy>;
  const copy: FailureCopy = kinds[failure.kind] ?? (t.failures.kinds.unknown as FailureCopy);
  const presenter = isPresenterState(failure.kind);
  const runbook = RUNBOOK_SECTION[failure.kind];
  const action: FailureAction | null =
    primary !== undefined
      ? primary
      : copy.action
        ? copy.href
          ? { label: copy.action, href: copy.href }
          : onRetry
            ? { label: copy.action, onClick: onRetry }
            : null
        : null;
  return (
    <section
      role="alert"
      aria-live="polite"
      data-testid="failure-screen"
      data-kind={failure.kind}
      className={`card border-danger/30 ${compact ? "p-4" : "p-5"} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="microlabel text-danger">{presenter ? t.failures.presenterLabel : t.failures.label}</p>
        <span className="microlabel">{NETWORK_LABEL}</span>
      </div>
      <h2 className={`${compact ? "text-lg" : "text-2xl"} mt-2 font-bold leading-tight tracking-tight text-ink`}>{copy.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{fill(copy.body, failure.values)}</p>

      {failure.landingAddress && (
        <div className="mt-3 rounded-xl bg-paper-2 p-3">
          <p className="microlabel">{t.failures.landingLabel}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink" data-testid="failure-landing">
            {failure.landingAddress}
          </p>
          <a href={`${EXPLORER_BASE}/account/${failure.landingAddress}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-teal hover:underline">
            stellar.expert · {NETWORK_LABEL} ↗
          </a>
          <p className="mt-2 text-xs text-ink-2">{t.failures.fundsSafe}</p>
        </div>
      )}

      {(action || secondary) && (
        <div className="mt-4 flex flex-col gap-2">
          {action && <ActionButton action={action} primary />}
          {secondary && <ActionButton action={secondary} primary={false} />}
        </div>
      )}

      {runbook && (
        <p className="mt-3 text-xs text-muted">
          {t.failures.runbookLabel} <span className="font-mono">docs/booth-runbook.md → “{runbook}”</span>
        </p>
      )}

      {failure.detail && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs text-muted underline-offset-2 hover:underline">
            {open ? t.failures.hideDetails : t.failures.details}
          </button>
          {open && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper-2 p-2 font-mono text-[11px] text-ink-2" data-testid="failure-detail">
              {failure.code ? `${failure.code}\n` : ""}
              {failure.detail}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

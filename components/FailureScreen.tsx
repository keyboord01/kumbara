"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const variant = primary ? "default" : "outline";
  const size = primary ? "xl" : "default";
  if (action.href) {
    return (
      <Button variant={variant} size={size} className="w-full" render={<Link href={action.href} />}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button variant={variant} size={size} className="w-full" onClick={action.onClick} disabled={action.busy} aria-busy={action.busy ? "true" : undefined}>
      {action.busy ? <Spinner data-icon="inline-start" /> : null}
      {action.label}
    </Button>
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
    <Card
      render={<section role="alert" aria-live="polite" />}
      size={compact ? "sm" : "default"}
      data-testid="failure-screen"
      data-kind={failure.kind}
      className={`border-destructive/30 ${className}`}
    >
      <CardHeader>
        <p className="microlabel text-destructive">{presenter ? t.failures.presenterLabel : t.failures.label}</p>
        <CardAction>
          <span className="microlabel">{NETWORK_LABEL}</span>
        </CardAction>
        <CardTitle className={`${compact ? "text-lg" : "text-2xl"} font-bold leading-tight tracking-tight`}>{copy.title}</CardTitle>
        <CardDescription className="leading-relaxed text-ink-2">{fill(copy.body, failure.values)}</CardDescription>
      </CardHeader>

      {failure.landingAddress || runbook || failure.detail ? (
        <CardContent className="flex flex-col gap-3">
          {failure.landingAddress ? (
            <div className="rounded-lg bg-muted p-3">
              <p className="microlabel">{t.failures.landingLabel}</p>
              <p className="mt-1 break-all font-mono text-xs text-foreground" data-testid="failure-landing">
                {failure.landingAddress}
              </p>
              <Button variant="link" size="xs" className="mt-2" render={<a href={`${EXPLORER_BASE}/account/${failure.landingAddress}`} target="_blank" rel="noreferrer" />}>
                stellar.expert · {NETWORK_LABEL}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
              <p className="mt-2 text-xs text-ink-2">{t.failures.fundsSafe}</p>
            </div>
          ) : null}

          {runbook ? (
            <p className="text-xs text-muted-foreground">
              {t.failures.runbookLabel} <span className="font-mono">docs/booth-runbook.md → “{runbook}”</span>
            </p>
          ) : null}

          {failure.detail ? (
            <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
              <CollapsibleTrigger render={<Button variant="link" size="xs" className="w-fit text-muted-foreground" />}>
                {open ? t.failures.hideDetails : t.failures.details}
                <ChevronDownIcon data-icon="inline-end" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-ink-2" data-testid="failure-detail">
                  {failure.code ? `${failure.code}\n` : ""}
                  {failure.detail}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      ) : null}

      {action || secondary ? (
        <CardFooter className="flex-col items-stretch gap-2">
          {action ? <ActionButton action={action} primary /> : null}
          {secondary ? <ActionButton action={secondary} primary={false} /> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

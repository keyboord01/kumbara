"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Failure } from "@/lib/failures";
import { useLocale } from "@/lib/i18n";
import { sendFeedback } from "@/lib/monitor";

/**
 * "Report a problem": a short optional note plus the anonymised context (browser family, OS, page, the failure on
 * screen if any). `instant` (failure screens) sends on the tap itself with the failure attached, no dialog.
 */
export function FeedbackButton({ failure = null, variant = "link", className = "", instant = false }: { failure?: Failure | null; variant?: "link" | "outline"; className?: string; instant?: boolean }) {
  const { t } = useLocale();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [sentOnce, setSentOnce] = useState(false);
  const send = async () => {
    setSending(true);
    const ok = await sendFeedback({ message, failure });
    setSending(false);
    if (ok) {
      setSentOnce(true);
      setOpen(false);
      setMessage("");
      toast({ title: t.feedback.sent, variant: "success", key: "feedback" });
    } else {
      toast({ title: t.feedback.failed, variant: "error", key: "feedback" });
    }
  };

  return (
    <>
      <Button variant={variant} size="sm" className={className} onClick={() => (instant ? void send() : setOpen(true))} disabled={sending || (instant && sentOnce)} data-testid={instant ? "feedback-instant" : "feedback-open"}>
        {instant && sending ? <Spinner data-icon="inline-start" /> : null}
        {instant && sentOnce ? t.feedback.sent : t.feedback.button}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.feedback.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.feedback.attached}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.feedback.placeholder} maxLength={500} rows={3} aria-label={t.feedback.title} data-testid="feedback-message" />
          <AlertDialogFooter>
            <AlertDialogCancel>{t.feedback.cancel}</AlertDialogCancel>
            <Button onClick={() => void send()} disabled={sending} data-testid="feedback-send">
              {sending ? <Spinner data-icon="inline-start" /> : null}
              {t.feedback.send}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

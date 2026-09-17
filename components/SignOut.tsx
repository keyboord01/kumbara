"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { LogOutIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/**
 * Ending the session on this device. Nothing is destroyed: the kumbara is a
 * contract on chain and the passkey opens it again, which is what the dialog
 * says, because "sign out" of a wallet reads as "lose my money" to most people.
 * It asks first, since a stray tap during a demo would drop the presenter's
 * screen mid-flow.
 */
export function SignOut({ variant = "full" }: { variant?: "full" | "icon" }) {
  const { t } = useLocale();
  const { isConnected, disconnect } = usePasskeyWallet();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!isConnected) return null;

  const run = async () => {
    setBusy(true);
    try {
      await disconnect();
      toast({ title: t.security.signOut.done, variant: "info", key: "signout" });
      setOpen(false);
      router.push("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          variant === "icon" ? (
            <Button variant="ghost" size="icon-sm" aria-label={t.security.signOut.action} data-testid="sign-out" className="text-muted-foreground" />
          ) : (
            <Button variant="outline" size="default" data-testid="sign-out" />
          )
        }
      >
        <LogOutIcon data-icon={variant === "icon" ? undefined : "inline-start"} />
        {variant === "icon" ? null : t.security.signOut.action}
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="sign-out-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.security.signOut.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.security.signOut.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="outline" />}>{t.security.signOut.cancel}</AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant="destructive" data-testid="sign-out-confirm" />}
            onClick={(event) => {
              event.preventDefault();
              void run();
            }}
            disabled={busy}
            aria-busy={busy ? "true" : undefined}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {t.security.signOut.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

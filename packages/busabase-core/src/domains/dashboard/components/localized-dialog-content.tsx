"use client";

import { DialogClose, DialogContent as KuiDialogContent } from "kui/dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { useCoreI18n } from "../../../i18n";

/**
 * A press on a toast is not a press "outside" the dialog. Copy feedback toasts
 * carry their own actions (the locator toast's example chips), and the toaster
 * lives outside every dialog, so without this a click on a toast would dismiss
 * the dialog the copy came from.
 */
const pressedToast = (event: { target: EventTarget | null }): boolean =>
  event.target instanceof Element && event.target.closest("[data-sonner-toaster]") !== null;

export function DialogContent({
  children,
  showCloseButton = true,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: ComponentProps<typeof KuiDialogContent>) {
  const messages = useCoreI18n();

  return (
    <KuiDialogContent
      {...props}
      onInteractOutside={(event) => {
        if (pressedToast(event)) event.preventDefault();
        onInteractOutside?.(event);
      }}
      onPointerDownOutside={(event) => {
        if (pressedToast(event)) event.preventDefault();
        onPointerDownOutside?.(event);
      }}
      showCloseButton={false}
    >
      {children}
      {showCloseButton ? (
        <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">{messages.common.close}</span>
        </DialogClose>
      ) : null}
    </KuiDialogContent>
  );
}

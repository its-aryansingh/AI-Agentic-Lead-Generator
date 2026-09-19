"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addManualLead, type AddManualLeadState } from "@/app/app/leads/actions";

const initialState: AddManualLeadState = { status: "idle" };

function AddLeadButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      className="mt-1 h-8 text-xs"
      disabled={pending}
    >
      {pending ? "Checking…" : "Add lead"}
    </Button>
  );
}

function ConfirmDuplicateButton() {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Button ref={ref} type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Yes, add anyway"}
    </Button>
  );
}

export function ManualLeadForm() {
  const [state, formAction] = useActionState(addManualLead, initialState);
  const values = state.values;

  return (
    <Card size="sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="size-4 text-primary" /> Add single lead
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          key={`${state.status}:${state.duplicatePhoneValue ?? ""}:${state.duplicateEmailValue ?? ""}`}
          action={formAction}
          className="flex flex-col gap-2.5"
        >
          <input
            type="hidden"
            name="duplicate_phone_confirmation"
            value={state.duplicatePhoneValue ?? ""}
          />
          <input
            type="hidden"
            name="duplicate_email_confirmation"
            value={state.duplicateEmailValue ?? ""}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              name="name"
              required
              maxLength={200}
              defaultValue={values?.name}
              placeholder="Full name *"
              className="h-8 text-xs"
            />
            <Input
              name="company"
              maxLength={200}
              defaultValue={values?.company}
              placeholder="Company"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              name="title"
              maxLength={200}
              defaultValue={values?.title}
              placeholder="Job title"
              className="h-8 text-xs"
            />
            <Input
              name="email"
              type="email"
              maxLength={320}
              defaultValue={values?.email}
              placeholder="Work email"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              name="phone"
              maxLength={40}
              defaultValue={values?.phone}
              placeholder="Phone (+country code)"
              className="h-8 text-xs"
            />
            <Input
              name="linkedin_url"
              type="url"
              maxLength={1000}
              defaultValue={values?.linkedin_url}
              placeholder="LinkedIn URL"
              className="h-8 text-xs"
            />
          </div>
          {state.status === "error" && (
            <p role="alert" className="text-xs text-destructive">
              {state.message}
            </p>
          )}
          <AddLeadButton />

          {state.status === "duplicate" && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="duplicate-lead-title"
              aria-describedby="duplicate-lead-description"
              className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
            >
              <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-xl">
                <h2 id="duplicate-lead-title" className="text-base font-semibold">
                  Possible duplicate lead
                </h2>
                <p id="duplicate-lead-description" className="text-sm text-muted-foreground">
                  {state.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  Adding it will create another lead row, but person-level call
                  limits and suppression safeguards still apply across both rows.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" render={<Link href="/app/leads" />}>
                    Cancel
                  </Button>
                  <ConfirmDuplicateButton />
                </div>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

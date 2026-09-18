"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function VerifyButton() {
  const { pending } = useFormStatus();

  return (
    <Button className="md:col-span-2" type="submit" disabled={pending}>
      {pending ? "Verifying with Bolna…" : "Verify and save"}
    </Button>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addExample,
  approveExample,
  deleteExample,
  saveContext,
} from "@/app/app/settings/context/actions";


// Every page under /app reads the session cookie, so none of them can
// be statically prerendered. Two earlier commits in this repo exist
// only to add this line to the other dashboard routes after the
// build crashed on them; these pages arrived from SalesEngAIMVP
// without it.
export const dynamic = "force-dynamic"

const fields = [
  ["product_summary", "Product/service summary"],
  ["ideal_customer_profile", "Ideal customer profile"],
  ["value_proposition", "Value proposition"],
  ["qualification_criteria", "Qualification criteria"],
  ["disqualification_criteria", "Disqualification criteria"],
  ["approved_claims", "Approved claims"],
  ["prohibited_topics", "Prohibited topics and promises"],
] as const;

export default async function ContextPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    example_added?: string;
    approved?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [contextResult, exampleResult, params] = await Promise.all([
    supabase
      .from("customer_contexts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("playbook_examples")
      .select(
        "id,example_type,title,content,redacted_content,outcome,is_approved",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    searchParams,
  ]);
  const context = contextResult.data;
  const examples = exampleResult.data;
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b">
        <h1 className="font-semibold">Customer context &amp; playbook</h1>
      </header>
      <section className="p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Approved business context</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={saveContext} className="flex flex-col gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    name="company_name"
                    defaultValue={String(context?.company_name ?? "")}
                    placeholder="Company name"
                  />
                  <Input
                    name="website_url"
                    type="url"
                    defaultValue={String(context?.website_url ?? "")}
                    placeholder="https://company.com"
                  />
                </div>
                {fields.map(([name, label]) => (
                  <label key={name} className="text-sm font-medium">
                    {label}
                    <Textarea
                      className="mt-1"
                      name={name}
                      rows={3}
                      defaultValue={String(context?.[name] ?? "")}
                    />
                  </label>
                ))}
                <Input
                  name="default_language"
                  defaultValue={String(context?.default_language ?? "English")}
                  placeholder="Default language"
                />
                <div className="flex gap-3 items-center">
                  <Button type="submit">Save context</Button>
                  {params.saved && (
                    <span className="text-xs text-muted-foreground">
                      Saved.
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Add successful example</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Use approved, redacted emails or call transcripts only.
              </p>
              <form action={addExample} className="flex flex-col gap-3">
                <select
                  name="example_type"
                  className="rounded-md border bg-card px-3 py-2 text-sm"
                >
                  <option value="call_transcript">
                    Successful call transcript
                  </option>
                  <option value="email">Successful email</option>
                </select>
                <Input name="title" required placeholder="Example title" />
                <Textarea
                  name="content"
                  required
                  rows={8}
                  placeholder="Redacted transcript or email"
                />
                <Input name="outcome" placeholder="Why it worked / outcome" />
                <div className="flex gap-3 items-center">
                  <Button type="submit">Add example</Button>
                  {params.example_added && (
                    <span className="text-xs text-muted-foreground">
                      Added.
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Playbook examples</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!examples?.length && (
                <p className="text-sm text-muted-foreground">
                  No examples yet.
                </p>
              )}
              {(examples ?? []).map((e) => (
                <div
                  key={String(e.id)}
                  className="border rounded-md p-3 text-sm flex flex-col gap-2"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{String(e.title)}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.example_type === "call_transcript"
                          ? "Call transcript"
                          : "Email"}{" "}
                        · {e.is_approved ? "Approved" : "Pending review"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {!e.is_approved && (
                        <form action={approveExample}>
                          <input type="hidden" name="id" value={String(e.id)} />
                          <Button size="xs" variant="outline">
                            Approve
                          </Button>
                        </form>
                      )}
                      <form action={deleteExample}>
                        <input type="hidden" name="id" value={String(e.id)} />
                        <Button size="xs" variant="ghost">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium select-none">
                      View content
                    </summary>
                    <div className="mt-2 p-2.5 bg-muted/40 rounded border text-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                      {String(e.redacted_content || e.content || "")}
                    </div>
                    {e.outcome ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Outcome:{" "}
                        </span>
                        {String(e.outcome)}
                      </p>
                    ) : null}
                  </details>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

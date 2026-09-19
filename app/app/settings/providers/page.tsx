import { redirect } from "next/navigation";
import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import {
  AI_MODELS,
  defaultAiModel,
  safeAiError,
  isKnownModel,
  type AiProvider,
  type AiPurpose,
} from "@/lib/ai-config-core";
import {
  resolveAiModel,
  recordAiUsage,
  deductCreditsForAiOp,
} from "@/lib/ai-config";
import { creditsForOperation, MODEL_CREDIT_COSTS } from "@/lib/credit-costs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sparkles,
  ArrowRight,
  Zap,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

async function savePreferences(formData: FormData) {
  "use server";
  const chatModel = String(formData.get("chat_model") ?? ""),
    researchModel = String(formData.get("research_model") ?? ""),
    writingModel = String(formData.get("writing_model") ?? ""),
    supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  if (![chatModel, researchModel, writingModel].every(isKnownModel)) {
    redirect("/app/settings/providers?error=invalid_model");
  }

  // Derive active_provider from the selected writing model
  const writingEntry = AI_MODELS.find((m) => m.id === writingModel);
  const activeProvider: AiProvider = writingEntry?.provider ?? "anthropic";

  await supabase.from("ai_preferences").upsert(
    {
      user_id: user.id,
      active_provider: activeProvider,
      chat_model: chatModel,
      research_model: researchModel,
      writing_model: writingModel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  redirect("/app/settings/providers?saved=1");
}

async function testAi() {
  "use server";
  const supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await resolveAiModel(user.id, "writing");
  if (!resolved) {
    redirect("/app/settings/providers?error=no_model_available");
  }

  const started = Date.now();
  try {
    await generateText({
      model: resolved.model,
      prompt: "Reply with exactly: SalesEngAI AI compute connection active.",
      maxOutputTokens: 20,
    });

    const creditCost = creditsForOperation(resolved.modelId, "writing");
    await recordAiUsage({
      userId: user.id,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: "connection_test",
      status: "completed",
      durationMs: Date.now() - started,
      creditCost,
    });

    await deductCreditsForAiOp({
      userId: user.id,
      modelId: resolved.modelId,
      purpose: "writing",
      operationLabel: "connection_test",
    });
  } catch (error) {
    await recordAiUsage({
      userId: user.id,
      provider: resolved.provider,
      model: resolved.modelId,
      operation: "connection_test",
      status: "failed",
      durationMs: Date.now() - started,
      errorCode: safeAiError(error),
    });
    redirect(`/app/settings/providers?error=${safeAiError(error)}`);
  }

  redirect("/app/settings/providers?tested=1");
}

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient(),
    {
      data: { user },
    } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: preference }, { data: userProfile }, { data: usage }] =
    await Promise.all([
      supabase
        .from("ai_preferences")
        .select("active_provider,chat_model,research_model,writing_model")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("users")
        .select("credits_remaining,plan")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("ai_usage_events")
        .select("provider,model,operation,status,created_at,credit_cost")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const query = await searchParams;
  const creditsRemaining = (userProfile?.credits_remaining as number) ?? 0;

  const selectedChat =
    preference?.chat_model ?? defaultAiModel("anthropic", "chat");
  const selectedResearch =
    preference?.research_model ?? defaultAiModel("anthropic", "research");
  const selectedWriting =
    preference?.writing_model ?? defaultAiModel("anthropic", "writing");

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              AI Models &amp; Credits
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Aravya manages all AI compute infrastructure. Choose the best
              model tier for each task and pay with credits.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 px-4 py-2 rounded-xl">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <div>
                <div className="text-xs text-zinc-400">Balance</div>
                <div className="text-sm font-semibold text-white">
                  {creditsRemaining.toLocaleString()} cr
                </div>
              </div>
            </div>
            <Link
              href="/app/settings/billing"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Top Up Credits <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </div>
        </header>

        {query.saved && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Model preferences saved successfully.
          </div>
        )}
        {query.tested && (
          <div className="flex items-center gap-2 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 text-sm">
            <Zap className="w-4 h-4 shrink-0" />
            AI test generation succeeded — platform compute is active and
            verified.
          </div>
        )}
        {query.error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
            Operation failed: {query.error.replaceAll("_", " ")}
          </div>
        )}

        {/* Model Selection Form */}
        <form action={savePreferences} className="space-y-6">
          {/* Section 1: Email & Copywriting */}
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white text-base">
                    Email &amp; Outreach Copywriting
                  </CardTitle>
                  <p className="text-xs text-zinc-400 mt-1">
                    Used for initial cold outreach drafts, follow-ups, reply
                    writing, and handoff summaries.
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Primary Quality Driver
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ModelOptionGroup
                purpose="writing"
                name="writing_model"
                selectedValue={selectedWriting}
              />
            </CardContent>
          </Card>

          {/* Section 2: Research & Classification */}
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white text-base">
                    Research &amp; Reply Classification
                  </CardTitle>
                  <p className="text-xs text-zinc-400 mt-1">
                    Used for scraping summarization, prospect company data
                    extraction, and incoming reply intent analysis.
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  High-Volume / Fast
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ModelOptionGroup
                purpose="research"
                name="research_model"
                selectedValue={selectedResearch}
              />
            </CardContent>
          </Card>

          {/* Section 3: Chat & Orchestration */}
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white text-base">
                    Chat &amp; Autonomous Orchestration
                  </CardTitle>
                  <p className="text-xs text-zinc-400 mt-1">
                    Used for interactive chat turns with the AI BDR team,
                    multi-step planning, and automated workflow runs.
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Multi-Turn
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ModelOptionGroup
                purpose="chat"
                name="chat_model"
                selectedValue={selectedChat}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="text-xs text-zinc-400">
              Credits are deducted automatically per operation. No separate
              OpenAI or Anthropic billing required.
            </p>
            <Button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
            >
              Save Model Preferences
            </Button>
          </div>
        </form>

        {/* Test AI & Usage Section */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-sm">
                Test AI Connectivity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-zinc-400">
                Execute a lightweight prompt through your selected writing model
                to verify instant compute readiness. Consumes 1 credit.
              </p>
              <form action={testAi}>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <Zap className="w-3.5 h-3.5 mr-2 text-indigo-400" />
                  Run Live Compute Test
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-sm">
                  Recent Compute Operations
                </CardTitle>
                <Link
                  href="/app/settings/usage"
                  className={buttonVariants({
                    variant: "ghost",
                    size: "sm",
                    className:
                      "text-xs h-7 text-indigo-400 hover:text-indigo-300",
                  })}
                >
                  Full Audit <ArrowRight className="w-3 h-3 ml-1" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {!usage?.length && (
                <p className="text-xs text-zinc-400">
                  No compute operations recorded yet.
                </p>
              )}
              {(usage ?? []).slice(0, 4).map((row, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs p-2 bg-zinc-800/60 rounded-lg border border-white/5"
                >
                  <span className="text-zinc-300 capitalize">
                    {String(row.operation).replace(/_/g, " ")}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 font-mono text-[11px]">
                      {String(row.model)}
                    </span>
                    <Badge
                      variant={
                        row.status === "completed" ? "default" : "destructive"
                      }
                      className="text-[10px] py-0"
                    >
                      {row.credit_cost
                        ? `${row.credit_cost} cr`
                        : String(row.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ModelOptionGroup({
  purpose,
  name,
  selectedValue,
}: {
  purpose: AiPurpose;
  name: string;
  selectedValue: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {AI_MODELS.map((model) => {
        const isSelected = selectedValue === model.id;
        const creditCost = MODEL_CREDIT_COSTS[model.id]?.[purpose] ?? 1;
        const tierBadgeColor =
          model.tier === "economy"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : model.tier === "standard"
              ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/20"
              : model.tier === "standard_plus"
                ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                : "bg-amber-500/10 text-amber-300 border-amber-500/20";

        return (
          <label
            key={model.id}
            className={`relative flex flex-col p-3.5 rounded-xl border cursor-pointer transition-all ${
              isSelected
                ? "bg-indigo-500/10 border-indigo-500/80 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                : "bg-zinc-800/40 border-white/10 hover:border-white/20 hover:bg-zinc-800/70"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={model.id}
                  defaultChecked={isSelected}
                  className="size-4 accent-indigo-500 mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-white flex items-center gap-2">
                    {model.label}
                    <span className="text-[10px] text-zinc-400 capitalize">
                      ({model.provider})
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {model.recommended_for}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold text-indigo-400">
                  {creditCost} {creditCost === 1 ? "credit" : "credits"}
                </div>
                <span
                  className={`inline-block px-1.5 py-0.5 text-[10px] rounded border capitalize mt-1 ${tierBadgeColor}`}
                >
                  {model.tier.replace("_", "+")}
                </span>
              </div>
            </div>

            {/* Why use this description */}
            <p className="text-[11px] text-zinc-400 mt-2.5 pt-2 border-t border-white/5 leading-relaxed">
              {model.why}
            </p>
          </label>
        );
      })}
    </div>
  );
}

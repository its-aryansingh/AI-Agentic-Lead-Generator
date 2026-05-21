"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { AnimatedCounter } from "@/components/ui/animated-counter"
import { Briefcase, Users, Coins, Zap, BarChart3 } from "lucide-react"

export interface AnalyticsData {
  monthlyJobs: number
  totalJobs: number
  monthlyProspects: number
  totalProspects: number
  creditsUsedThisMonth: number
  creditsRemaining: number
  enrolledCount: number
  sequenceCount: number
  topSources: Array<[string, number]>
  hasVoiceAnchor: boolean
  avgProspectsPerJob: number
}

export function AnalyticsClient({ data }: { data: AnalyticsData }) {
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-10">
      
      {/* Metric Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile 
          title="Jobs this month" 
          value={data.monthlyJobs} 
          sub={`${data.totalJobs} all-time`}
          icon={Briefcase}
          color="var(--chart-teal)"
          index={0}
        />
        <MetricTile 
          title="Prospects this month" 
          value={data.monthlyProspects} 
          sub={`${data.totalProspects} all-time`}
          icon={Users}
          color="var(--chart-violet)"
          index={1}
        />
        <MetricTile 
          title="Credits used" 
          value={data.creditsUsedThisMonth} 
          sub={`${data.creditsRemaining} remaining`}
          icon={Coins}
          color="var(--chart-amber)"
          index={2}
        />
        <MetricTile 
          title="Active enrollments" 
          value={data.enrolledCount} 
          sub={`${data.sequenceCount} sequence${data.sequenceCount === 1 ? "" : "s"}`}
          icon={Zap}
          color="var(--chart-rose)"
          index={3}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Discovery Sources Bar Chart */}
        <Card className="glass-card lg:col-span-2 animate-slide-in-up" style={{ animationDelay: '320ms' }}>
          <CardHeader className="px-6 py-5 border-b border-border/50">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
              Discovery sources (last 30 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {data.topSources.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="w-8 h-8" />}
                title="No data yet"
                description="Run a search or upload a CSV to see source metrics."
                className="py-12"
              />
            ) : (
              <div className="flex flex-col gap-5">
                {data.topSources.map(([source, count], i) => {
                  const total = data.topSources.reduce((s, [, c]) => s + c, 0)
                  const pct = total === 0 ? 0 : Math.round((count / total) * 100)
                  
                  // Pick a color from our palette based on index
                  const colors = [
                    "var(--chart-sky)", 
                    "var(--chart-violet)", 
                    "var(--chart-teal)", 
                    "var(--chart-amber)", 
                    "var(--chart-emerald)"
                  ]
                  const color = colors[i % colors.length]

                  return (
                    <div key={source} className="flex flex-col gap-2 relative group">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">{source}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          <AnimatedCounter value={count} /> · {pct}%
                        </span>
                      </div>
                      
                      <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full animate-bar-grow opacity-90 group-hover:opacity-100 transition-opacity"
                          style={{ 
                            width: `${pct}%`, 
                            backgroundColor: color,
                            animationDelay: `${400 + (i * 100)}ms` 
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quality Signals */}
        <Card className="glass-card lg:col-span-1 animate-slide-in-up" style={{ animationDelay: '400ms' }}>
          <CardHeader className="px-6 py-5 border-b border-border/50">
            <CardTitle>Quality signals</CardTitle>
          </CardHeader>
          <CardContent className="p-6 flex flex-col gap-8">
            
            {/* Voice Anchor Gauge */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-32 h-32 flex items-center justify-center">
                {/* Background Ring */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="currentColor" 
                    strokeWidth="8" 
                    className="text-muted" 
                  />
                  {/* Foreground Ring */}
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="var(--chart-emerald)" 
                    strokeWidth="8" 
                    strokeDasharray="251.2"
                    strokeDashoffset={data.hasVoiceAnchor ? "0" : "251.2"}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out delay-500"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold">
                    {data.hasVoiceAnchor ? "100%" : "0%"}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">
                    Matched
                  </span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-medium">Voice anchor</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {data.hasVoiceAnchor 
                    ? "Your AI writing matches your style." 
                    : "Not set. The AI is using default phrasing."}
                </div>
              </div>
            </div>

            <div className="h-px w-full bg-border" />

            <div className="flex flex-col items-center gap-2">
              <div className="text-3xl font-bold tracking-tight">
                <AnimatedCounter value={data.avgProspectsPerJob} />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium">Avg prospects / job</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Based on your last 30 days of activity.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-[11px] text-muted-foreground text-center border border-border/50">
              Reply-rate, open-rate, and per-sequence-step funnels land in v1.1 with the Gmail send integration.
            </div>

          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({
  title,
  value,
  sub,
  icon: Icon,
  color,
  index
}: {
  title: string
  value: number
  sub: string
  icon: React.ElementType
  color: string
  index: number
}) {
  return (
    <Card 
      className="glass-card animate-slide-in-up relative overflow-hidden group hover:border-border/50 transition-all"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div 
        className="absolute -right-4 -top-4 w-24 h-24 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ backgroundColor: color }}
      />
      <CardContent className="p-6 flex flex-col relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {title}
          </div>
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-background/50 border border-border/50 shadow-sm"
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight text-foreground">
          <AnimatedCounter value={value} />
        </div>
        <div className="text-xs text-muted-foreground mt-2 font-medium">
          {sub}
        </div>
      </CardContent>
    </Card>
  )
}

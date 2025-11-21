import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TradingModeSelector } from "@/components/trading-mode-selector";
import { ControlPanel } from "@/components/control-panel";
import { LiveTradeMonitor } from "@/components/live-trade-monitor";
import { MarketAnalysis } from "@/components/market-analysis";
import { PerformanceStats } from "@/components/performance-stats";
import { TrendingUp, TrendingDown, Activity, Target } from "lucide-react";
import type { Settings, Analysis, Trade, DailyPerformance } from "@shared/schema";

export default function Dashboard() {
  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ['/api/settings'],
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery<Analysis>({
    queryKey: ['/api/analysis'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: activeTrades, isLoading: tradesLoading } = useQuery<Trade[]>({
    queryKey: ['/api/trades/active'],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const { data: performance, isLoading: performanceLoading } = useQuery<DailyPerformance>({
    queryKey: ['/api/performance'],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (settingsLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const totalPnl = performance?.totalPnl ? parseFloat(performance.totalPnl.toString()) : 0;
  const winRate = performance?.winRate ? parseFloat(performance.winRate.toString()) : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dashboard-title">Trading Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor and control your autonomous trading system</p>
        </div>
        <Badge variant={settings?.autoTradingEnabled ? "default" : "secondary"} className="px-3 py-1" data-testid="badge-auto-trading-status">
          <Activity className="mr-1 h-3 w-3" />
          {settings?.autoTradingEnabled ? "Auto-Trading Active" : "Manual Mode"}
        </Badge>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's PnL</CardTitle>
            {totalPnl >= 0 ? (
              <TrendingUp className="h-4 w-4 text-chart-2" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold font-mono ${totalPnl >= 0 ? 'text-chart-2' : 'text-destructive'}`} data-testid="text-pnl">
              {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} INR
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {performance?.totalTrades || 0} trades executed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold font-mono" data-testid="text-win-rate">{winRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {performance?.winningTrades || 0}W / {performance?.losingTrades || 0}L
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trades</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold font-mono" data-testid="text-active-trades">{activeTrades?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              of {settings?.concurrentTrades || 1} max
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Best Asset</CardTitle>
            <TrendingUp className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="text-best-asset">{performance?.bestAsset || 'N/A'}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Top performer today
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trading Mode Selector */}
      <TradingModeSelector currentMode={(settings?.tradingMode as any) || 'scalping'} />

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Control Panel */}
        <ControlPanel settings={settings} />

        {/* Market Analysis */}
        <MarketAnalysis analysis={analysis} isLoading={analysisLoading} />
      </div>

      {/* Live Trade Monitor */}
      <LiveTradeMonitor trades={activeTrades || []} isLoading={tradesLoading} />

      {/* Performance Stats */}
      <PerformanceStats performance={performance} isLoading={performanceLoading} />
    </div>
  );
}

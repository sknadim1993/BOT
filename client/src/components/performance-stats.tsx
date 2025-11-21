import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, TrendingDown } from "lucide-react";
import type { DailyPerformance } from "@shared/schema";

interface PerformanceStatsProps {
  performance?: DailyPerformance;
  isLoading: boolean;
}

export function PerformanceStats({ performance, isLoading }: PerformanceStatsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Summary</CardTitle>
          <CardDescription>Today's trading statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!performance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Summary</CardTitle>
          <CardDescription>Today's trading statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Trophy className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No performance data yet</p>
            <p className="text-xs text-muted-foreground mt-1">Statistics will appear after trades are executed</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalPnl = parseFloat(performance.totalPnl?.toString() || '0');
  const winRate = parseFloat(performance.winRate?.toString() || '0');
  const largestWin = parseFloat(performance.largestWin?.toString() || '0');
  const largestLoss = parseFloat(performance.largestLoss?.toString() || '0');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Summary</CardTitle>
        <CardDescription>Today's trading statistics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total PnL</p>
            <p className={`text-2xl font-semibold font-mono ${totalPnl >= 0 ? 'text-chart-2' : 'text-destructive'}`} data-testid="text-total-pnl">
              {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USDT
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Win Rate</p>
            <p className="text-2xl font-semibold font-mono" data-testid="text-performance-win-rate">{winRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{performance.winningTrades}W / {performance.losingTrades}L</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Largest Win</p>
            <p className="text-2xl font-semibold font-mono text-chart-2" data-testid="text-largest-win">
              +{largestWin.toFixed(2)} USDT
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Largest Loss</p>
            <p className="text-2xl font-semibold font-mono text-destructive" data-testid="text-largest-loss">
              {largestLoss.toFixed(2)} USDT
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-chart-2" />
              <p className="text-sm font-medium">Best Performer</p>
            </div>
            <p className="text-lg font-semibold" data-testid="text-performance-best">{performance.bestAsset || 'N/A'}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              <p className="text-sm font-medium">Worst Performer</p>
            </div>
            <p className="text-lg font-semibold" data-testid="text-performance-worst">{performance.worstAsset || 'N/A'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

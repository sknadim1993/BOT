import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Brain, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Analysis } from "@shared/schema";

interface MarketAnalysisProps {
  analysis?: Analysis;
  isLoading: boolean;
}

export function MarketAnalysis({ analysis, isLoading }: MarketAnalysisProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Analysis</CardTitle>
          <CardDescription>AI-powered insights from Groq</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!analysis || !analysis.recommendedAsset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Analysis</CardTitle>
          <CardDescription>AI-powered insights from Groq</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Brain className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No analysis available yet</p>
            <p className="text-xs text-muted-foreground mt-1">Waiting for market data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Analysis</CardTitle>
        <CardDescription>AI-powered insights from Groq</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recommended Trade */}
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold" data-testid="text-recommended-asset">{analysis.recommendedAsset}</span>
              <Badge variant={analysis.direction === 'long' ? 'default' : 'destructive'} data-testid="badge-direction">
                {analysis.direction === 'long' ? (
                  <><ArrowUpRight className="mr-1 h-3 w-3" />LONG</>
                ) : (
                  <><ArrowDownRight className="mr-1 h-3 w-3" />SHORT</>
                )}
              </Badge>
            </div>
            <Badge variant="outline" className="font-mono" data-testid="badge-confidence">
              {analysis.confidence}% confidence
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Entry</p>
              <p className="font-mono font-semibold" data-testid="text-entry-price">
                ${analysis.entryPrice ? parseFloat(analysis.entryPrice.toString()).toFixed(2) : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stop Loss</p>
              <p className="font-mono font-semibold text-destructive" data-testid="text-stop-loss">
                ${analysis.stopLoss ? parseFloat(analysis.stopLoss.toString()).toFixed(2) : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Take Profit</p>
              <p className="font-mono font-semibold text-chart-2" data-testid="text-take-profit">
                ${analysis.takeProfit ? parseFloat(analysis.takeProfit.toString()).toFixed(2) : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Pattern Explanation */}
        {analysis.patternExplanation && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Pattern Analysis</h4>
            <p className="text-sm text-muted-foreground" data-testid="text-pattern-explanation">{analysis.patternExplanation}</p>
          </div>
        )}

        {/* Multi-timeframe Reasoning */}
        {analysis.multiTimeframeReasoning && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Multi-Timeframe Confluence</h4>
            <p className="text-sm text-muted-foreground" data-testid="text-timeframe-reasoning">{analysis.multiTimeframeReasoning}</p>
          </div>
        )}

        {/* Strongest/Weakest Assets */}
        <div className="grid grid-cols-2 gap-4">
          {analysis.strongestAssets && analysis.strongestAssets.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-chart-2" />
                <h4 className="text-sm font-medium">Strongest</h4>
              </div>
              <div className="flex flex-wrap gap-1">
                {analysis.strongestAssets.slice(0, 3).map((asset) => (
                  <Badge key={asset} variant="secondary" className="text-xs" data-testid={`badge-strong-${asset}`}>
                    {asset}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          
          {analysis.weakestAssets && analysis.weakestAssets.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-destructive" />
                <h4 className="text-sm font-medium">Weakest</h4>
              </div>
              <div className="flex flex-wrap gap-1">
                {analysis.weakestAssets.slice(0, 3).map((asset) => (
                  <Badge key={asset} variant="outline" className="text-xs" data-testid={`badge-weak-${asset}`}>
                    {asset}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

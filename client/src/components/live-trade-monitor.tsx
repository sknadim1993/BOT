import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Trade } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LiveTradeMonitorProps {
  trades: Trade[];
  isLoading: boolean;
}

export function LiveTradeMonitor({ trades, isLoading }: LiveTradeMonitorProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Trades</CardTitle>
          <CardDescription>Active positions being monitored</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (trades.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Trades</CardTitle>
          <CardDescription>Active positions being monitored</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No active trades</p>
            <p className="text-xs text-muted-foreground mt-1">Positions will appear here when trades are executed</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Trades</CardTitle>
        <CardDescription>Active positions being monitored</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>SL</TableHead>
              <TableHead>TP</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Leverage</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id} data-testid={`row-trade-${trade.symbol}`}>
                <TableCell className="font-semibold">{trade.symbol}</TableCell>
                <TableCell>
                  <Badge variant={trade.direction === 'long' ? 'default' : 'destructive'} className="font-mono">
                    {trade.direction === 'long' ? (
                      <><ArrowUpRight className="mr-1 h-3 w-3" />LONG</>
                    ) : (
                      <><ArrowDownRight className="mr-1 h-3 w-3" />SHORT</>
                    )}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">${parseFloat(trade.entryPrice.toString()).toFixed(2)}</TableCell>
                <TableCell className="font-mono text-destructive">${parseFloat(trade.stopLoss.toString()).toFixed(2)}</TableCell>
                <TableCell className="font-mono text-chart-2">${parseFloat(trade.takeProfit.toString()).toFixed(2)}</TableCell>
                <TableCell className="font-mono">{parseFloat(trade.quantity.toString()).toFixed(4)}</TableCell>
                <TableCell className="font-mono">{trade.leverage}x</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono">{trade.confidence}%</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
